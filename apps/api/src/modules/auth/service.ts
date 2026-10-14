import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../../lib/auth/passwords.js";
import { hashOpaqueToken, createOpaqueToken, hashesEqual } from "../../lib/auth/tokens.js";
import { createRecoveryCodes, createTotpSecret, type MfaSecretProtector, verifyTotpCode } from "../../lib/auth/totp.js";
import { AuthenticationError, BootstrapUnavailableError, MfaRequiredError, requireActiveUser, requireTenantMembership, requiresMfa } from "./authorization.js";
import type { AuthClock, AuthRepository, AuthUser, MfaState, OrganizationMembership, OrganizationRole, SessionRecord } from "./types.js";
import { systemClock } from "./types.js";

const DEFAULT_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthServiceOptions {
  repository: AuthRepository;
  mfaSecretProtector: MfaSecretProtector;
  clock?: AuthClock;
  invitationTtlMs?: number;
  sessionTtlMs?: number;
  /** Hash only. The raw bootstrap token must never be persisted or logged. */
  superuserBootstrapTokenHash?: string;
}

export interface SessionContext {
  session: SessionRecord;
  user: AuthUser;
  membership?: OrganizationMembership;
}

export interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  requiresMfa: boolean;
}

export class AuthService {
  private readonly clock: AuthClock;
  private readonly invitationTtlMs: number;
  private readonly sessionTtlMs: number;

  constructor(private readonly options: AuthServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.invitationTtlMs = options.invitationTtlMs ?? DEFAULT_INVITATION_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    if (this.invitationTtlMs < 60_000 || this.sessionTtlMs < 60_000) throw new Error("Auth token lifetimes are too short.");
  }

  /** Raw invitation token is returned only to the delivery layer, never persisted. */
  issueInvitationToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = createOpaqueToken();
    return { token, tokenHash: hashOpaqueToken(token), expiresAt: new Date(this.clock.now().getTime() + this.invitationTtlMs) };
  }

  async acceptInvitation(input: {
    token: string;
    displayName: string;
    password: string;
    userId?: string;
  }): Promise<AuthUser> {
    const now = this.clock.now();
    const invitation = await this.options.repository.findInvitationByTokenHash(hashOpaqueToken(input.token));
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) {
      throw new AuthenticationError("Invitation is invalid or has expired.");
    }
    const passwordHash = await hashPassword(input.password);
    const email = normalizeEmail(invitation.email);
    const existing = await this.options.repository.findUserByEmail(email);
    if (existing && existing.status !== "INVITED") throw new AuthenticationError("Invitation is invalid or has expired.");

    const user: Pick<AuthUser, "id" | "email" | "displayName" | "passwordHash" | "passwordChangedAt" | "mustChangePassword" | "mfa"> = {
      id: existing?.id ?? input.userId ?? randomUUID(),
      email,
      displayName: input.displayName.trim(),
      passwordHash,
      passwordChangedAt: now,
      // Invitation activation establishes a password chosen by the recipient.
      mustChangePassword: false,
      mfa: existing?.mfa ?? emptyMfaState()
    };
    if (!user.displayName || user.displayName.length > 120) throw new AuthenticationError("A valid display name is required.");
    const membership: OrganizationMembership = {
      organizationId: invitation.organizationId,
      userId: user.id,
      role: invitation.role,
      active: true
    };
    const accepted = await this.options.repository.acceptInvitation({
      invitationId: invitation.id,
      tokenHash: hashOpaqueToken(input.token),
      user,
      membership,
      acceptedAt: now
    });
    if (!accepted) throw new AuthenticationError("Invitation is invalid or has expired.");
    return accepted;
  }

  async beginPasswordLogin(input: { email: string; password: string; organizationId?: string; userAgentHash?: string; ipPrefix?: string }): Promise<LoginResult> {
    const now = this.clock.now();
    const user = await this.options.repository.findUserByEmail(normalizeEmail(input.email));
    requireActiveUser(user);
    if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new AuthenticationError("Authentication failed.");

    if (input.organizationId) {
      const membership = await this.options.repository.findMembership(input.organizationId, user.id);
      requireTenantMembership(membership);
    }
    const sessionToken = createOpaqueToken();
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: hashOpaqueToken(sessionToken),
      userId: user.id,
      organizationId: input.organizationId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.sessionTtlMs),
      lastSeenAt: now,
      userAgentHash: input.userAgentHash,
      ipPrefix: input.ipPrefix
    };
    await this.options.repository.createSession(session);
    return { sessionToken, expiresAt: session.expiresAt, requiresMfa: requiresMfa(user) };
  }

  async requireSession(token: string, organizationId?: string): Promise<SessionContext> {
    const now = this.clock.now();
    const session = await this.options.repository.findSessionByTokenHash(hashOpaqueToken(token));
    if (!session || session.revokedAt || session.expiresAt <= now) throw new AuthenticationError("Authentication failed.");
    const user = await this.options.repository.findUserById(session.userId);
    requireActiveUser(user);
    if (requiresMfa(user) && (!session.mfaVerifiedAt || session.mfaVerifiedAt < session.createdAt)) throw new MfaRequiredError("Multi-factor authentication is required.");

    const tenantId = organizationId ?? session.organizationId;
    let membership: OrganizationMembership | undefined;
    if (tenantId) {
      const foundMembership = await this.options.repository.findMembership(tenantId, user.id);
      requireTenantMembership(foundMembership);
      membership = foundMembership;
    }
    await this.options.repository.touchSession(session.id, now);
    return { session, user, membership };
  }

  async verifyMfaForSession(input: { sessionToken: string; code: string; recoveryCode?: boolean }): Promise<void> {
    const now = this.clock.now();
    const session = await this.options.repository.findSessionByTokenHash(hashOpaqueToken(input.sessionToken));
    if (!session || session.revokedAt || session.expiresAt <= now) throw new AuthenticationError("Authentication failed.");
    const user = await this.options.repository.findUserById(session.userId);
    requireActiveUser(user);

    let verified = false;
    if (input.recoveryCode) {
      verified = await this.options.repository.consumeRecoveryCode(user.id, hashOpaqueToken(input.code.toUpperCase()));
    } else if (user.mfa.enabled && user.mfa.encryptedTotpSecret) {
      const secret = this.options.mfaSecretProtector.open(user.mfa.encryptedTotpSecret);
      verified = verifyTotpCode(secret, input.code);
    }
    if (!verified) throw new AuthenticationError("Authentication failed.");
    await this.options.repository.markSessionMfaVerified(session.id, now);
  }

  /** Return the secret only for a pending enrollment screen over TLS; do not persist it in the client. */
  beginMfaEnrollment(): { secret: string; otpauthUri: string } {
    const secret = createTotpSecret();
    return { secret, otpauthUri: `otpauth://totp/Comerciar?secret=${secret}&issuer=Comerciar&algorithm=SHA1&digits=6&period=30` };
  }

  async confirmMfaEnrollment(userId: string, secret: string, code: string): Promise<{ recoveryCodes: string[] }> {
    if (!verifyTotpCode(secret, code)) throw new AuthenticationError("Authentication failed.");
    const recovery = createRecoveryCodes();
    const current = await this.options.repository.findUserById(userId);
    requireActiveUser(current);
    const mfa: MfaState = {
      enabled: true,
      required: current.mfa.required || current.platformRoles.includes("SUPER_ADMIN"),
      encryptedTotpSecret: this.options.mfaSecretProtector.seal(secret),
      recoveryCodeHashes: recovery.hashes
    };
    await this.options.repository.updateMfa(userId, mfa);
    return { recoveryCodes: recovery.codes };
  }

  /**
   * Starts the one-time initial superuser ceremony. The caller keeps the
   * temporary secret only long enough to scan it and submit its TOTP code.
   */
  beginInitialSuperAdminBootstrap(bootstrapToken: string): { secret: string; otpauthUri: string } {
    this.requireBootstrapToken(bootstrapToken);
    return this.beginMfaEnrollment();
  }

  /**
   * Creates the first SUPER_ADMIN with MFA already enrolled. The repository
   * performs the final one-time check transactionally, so leaving the token
   * hash configured cannot create a second platform administrator.
   */
  async completeInitialSuperAdminBootstrap(input: {
    bootstrapToken: string;
    email: string;
    displayName: string;
    password: string;
    totpSecret: string;
    totpCode: string;
  }): Promise<{ user: AuthUser; recoveryCodes: string[] }> {
    this.requireBootstrapToken(input.bootstrapToken);
    if (!verifyTotpCode(input.totpSecret, input.totpCode)) throw new AuthenticationError("Authentication failed.");

    const now = this.clock.now();
    const recovery = createRecoveryCodes();
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) throw new AuthenticationError("Authentication failed.");
    const user: Pick<AuthUser, "id" | "email" | "displayName" | "passwordHash" | "passwordChangedAt" | "mustChangePassword" | "mfa"> = {
      id: randomUUID(),
      email: normalizeEmail(input.email),
      displayName,
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: now,
      mustChangePassword: false,
      mfa: {
        enabled: true,
        required: true,
        encryptedTotpSecret: this.options.mfaSecretProtector.seal(input.totpSecret),
        recoveryCodeHashes: recovery.hashes
      }
    };
    const created = await this.options.repository.createInitialSuperAdmin({ user, createdAt: now });
    if (!created) throw new BootstrapUnavailableError("Initial bootstrap is unavailable.");
    return { user: created, recoveryCodes: recovery.codes };
  }

  private requireBootstrapToken(token: string): void {
    const configuredHash = this.options.superuserBootstrapTokenHash;
    if (!configuredHash || !token || !hashesEqual(hashOpaqueToken(token), configuredHash)) {
      throw new BootstrapUnavailableError("Initial bootstrap is unavailable.");
    }
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AuthenticationError("Authentication failed.");
  return email;
}

function emptyMfaState(): MfaState {
  return { enabled: false, required: false, recoveryCodeHashes: [] };
}

