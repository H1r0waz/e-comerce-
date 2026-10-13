export const OrganizationRole = {
  OWNER: "OWNER",
  SALES: "SALES",
  INVENTORY_FULFILLMENT: "INVENTORY_FULFILLMENT",
  VIEWER: "VIEWER"
} as const;
export type OrganizationRole = (typeof OrganizationRole)[keyof typeof OrganizationRole];

export const PlatformRole = { SUPER_ADMIN: "SUPER_ADMIN" } as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  platformRoles: PlatformRole[];
  passwordHash?: string;
  passwordChangedAt?: Date;
  mustChangePassword: boolean;
  mfa: MfaState;
}

export interface MfaState {
  enabled: boolean;
  encryptedTotpSecret?: string;
  recoveryCodeHashes: string[];
  required: boolean;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  active: boolean;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  createdByUserId: string;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  organizationId?: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date;
  /** Bind a session to the user-agent family without storing its raw value. */
  userAgentHash?: string;
  ipPrefix?: string;
  mfaVerifiedAt?: Date;
}

/**
 * Each state-changing method must be implemented as a transaction/conditional
 * update by the database adapter to prevent races between token reuse/revocation.
 */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(userId: string): Promise<AuthUser | null>;
  findMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  findInvitationByTokenHash(tokenHash: string): Promise<Invitation | null>;
  acceptInvitation(input: {
    invitationId: string;
    tokenHash: string;
    user: Pick<AuthUser, "id" | "email" | "displayName" | "passwordHash" | "passwordChangedAt" | "mustChangePassword" | "mfa">;
    membership: OrganizationMembership;
    acceptedAt: Date;
  }): Promise<AuthUser | null>;
  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  markSessionMfaVerified(sessionId: string, at: Date): Promise<void>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  updateMfa(userId: string, mfa: MfaState): Promise<void>;
  consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean>;
}

export interface AuthClock {
  now(): Date;
}

export const systemClock: AuthClock = { now: () => new Date() };

