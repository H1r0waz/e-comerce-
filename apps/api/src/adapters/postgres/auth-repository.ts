import type {
  AuthRepository,
  AuthUser,
  Invitation,
  MfaState,
  OrganizationMembership,
  OrganizationRole,
  PlatformRole,
  SessionRecord
} from "../../modules/auth/types.js";
import type { AuthSessionRepository, CommerceRole } from "../../routes/types.js";
import { withTransaction, type PostgresPool, type PostgresQueryClient } from "./types.js";

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string;
  status: AuthUser["status"];
  password_hash: string | null;
  password_changed_at: Date | string | null;
  must_change_password: boolean;
  two_factor_enabled: boolean;
  two_factor_secret_encrypted: Buffer | string | null;
  recovery_code_hashes: unknown;
  platform_roles: string[] | null;
}

interface MembershipRow extends Record<string, unknown> {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  active: boolean;
}

interface InvitationRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  token_hash: string;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
  created_by_user_id: string | null;
}

interface SessionRow extends Record<string, unknown> {
  id: string;
  token_hash: string;
  user_id: string;
  organization_id: string | null;
  expires_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  created_at: Date | string;
  user_agent_hash: string | null;
  ip_prefix: string | null;
  mfa_verified_at: Date | string | null;
}

const USER_SELECT = `
  SELECT
    u.id, u.email, u.display_name, u.status, u.password_hash, u.password_changed_at, u.must_change_password,
    u.two_factor_enabled, u.two_factor_secret_encrypted, u.recovery_code_hashes,
    COALESCE(array_agg(pr.role) FILTER (WHERE pr.role IS NOT NULL), ARRAY[]::text[]) AS platform_roles
  FROM app_users u
  LEFT JOIN platform_user_roles pr ON pr.user_id = u.id
`;

/** Concrete AuthRepository backed by node-postgres and Neon Postgres. */
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: PostgresPool) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(`${USER_SELECT} WHERE lower(u.email) = lower($1) GROUP BY u.id`, [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findUserById(userId: string): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [userId]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT organization_id, user_id, role, active
       FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    return result.rows[0] ? mapMembership(result.rows[0]) : null;
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const result = await this.pool.query<InvitationRow>(
      `SELECT id, organization_id, email, role, token_hash, expires_at, accepted_at, revoked_at, created_by_user_id
       FROM user_invitations
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] ? mapInvitation(result.rows[0]) : null;
  }

  async acceptInvitation(input: {
    invitationId: string;
    tokenHash: string;
    user: Pick<AuthUser, "id" | "email" | "displayName" | "passwordHash" | "passwordChangedAt" | "mustChangePassword" | "mfa">;
    membership: OrganizationMembership;
    acceptedAt: Date;
  }): Promise<AuthUser | null> {
    return withTransaction(this.pool, async (client) => {
      const invitation = await client.query<InvitationRow>(
        `SELECT id, organization_id, email, role, token_hash, expires_at, accepted_at, revoked_at, created_by_user_id
         FROM user_invitations
         WHERE id = $1 AND token_hash = $2
         FOR UPDATE`,
        [input.invitationId, input.tokenHash]
      );
      const current = invitation.rows[0];
      if (!current || current.accepted_at || current.revoked_at || asDate(current.expires_at) <= input.acceptedAt) return null;
      if (current.organization_id !== input.membership.organizationId || lower(current.email) !== lower(input.user.email)) return null;

      await client.query(
        `INSERT INTO app_users (
          id, email, display_name, password_hash, password_changed_at, must_change_password, status,
          two_factor_enabled, two_factor_secret_encrypted, recovery_code_hashes
        ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8, $9::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          password_changed_at = EXCLUDED.password_changed_at,
          must_change_password = EXCLUDED.must_change_password,
          status = 'ACTIVE',
          two_factor_enabled = EXCLUDED.two_factor_enabled,
          two_factor_secret_encrypted = EXCLUDED.two_factor_secret_encrypted,
          recovery_code_hashes = EXCLUDED.recovery_code_hashes`,
        [
          input.user.id,
          input.user.email,
          input.user.displayName,
          input.user.passwordHash ?? null,
          input.user.passwordChangedAt ?? null,
          input.user.mustChangePassword,
          input.user.mfa.enabled,
          input.user.mfa.encryptedTotpSecret ? Buffer.from(input.user.mfa.encryptedTotpSecret, "utf8") : null,
          JSON.stringify(input.user.mfa.recoveryCodeHashes)
        ]
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active`,
        [input.membership.organizationId, input.membership.userId, input.membership.role, input.membership.active]
      );
      const consumed = await client.query<{ id: string }>(
        `UPDATE user_invitations
         SET accepted_at = $3, accepted_by_user_id = $4
         WHERE id = $1 AND token_hash = $2 AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING id`,
        [input.invitationId, input.tokenHash, input.acceptedAt, input.user.id]
      );
      if (!consumed.rows[0]) return null;
      return this.findUserByIdWithClient(client, input.user.id);
    });
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (
        id, user_id, organization_id, token_hash, expires_at, last_seen_at, created_at,
        user_agent_hash, ip_prefix, mfa_verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        session.id,
        session.userId,
        session.organizationId ?? null,
        session.tokenHash,
        session.expiresAt,
        session.lastSeenAt,
        session.createdAt,
        session.userAgentHash ?? null,
        session.ipPrefix ?? null,
        session.mfaVerifiedAt ?? null
      ]
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, token_hash, user_id, organization_id, expires_at, last_seen_at, revoked_at, created_at,
              user_agent_hash, ip_prefix, mfa_verified_at
       FROM auth_sessions WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE auth_sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, at]);
  }

  async markSessionMfaVerified(sessionId: string, at: Date): Promise<void> {
    // mfa_verified_at is introduced by migration 0002; fail closed until it exists.
    await this.pool.query(`UPDATE auth_sessions SET mfa_verified_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, at]);
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, at]);
  }

  async updateMfa(userId: string, mfa: MfaState): Promise<void> {
    await this.pool.query(
      `UPDATE app_users
       SET two_factor_enabled = $2, two_factor_secret_encrypted = $3, recovery_code_hashes = $4::jsonb
       WHERE id = $1`,
      [userId, mfa.enabled, mfa.encryptedTotpSecret ? Buffer.from(mfa.encryptedTotpSecret, "utf8") : null, JSON.stringify(mfa.recoveryCodeHashes)]
    );
  }

  async consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE app_users
       SET recovery_code_hashes = (
         SELECT COALESCE(jsonb_agg(code), '[]'::jsonb)
         FROM jsonb_array_elements_text(recovery_code_hashes) AS code
         WHERE code <> $2
       )
       WHERE id = $1 AND recovery_code_hashes ? $2
       RETURNING id`,
      [userId, codeHash]
    );
    return Boolean(result.rows[0]);
  }

  async createInitialSuperAdmin(input: {
    user: Pick<AuthUser, "id" | "email" | "displayName" | "passwordHash" | "passwordChangedAt" | "mustChangePassword" | "mfa">;
    organizationName: string;
    createdAt: Date;
  }): Promise<AuthUser | null> {
    return withTransaction(this.pool, async (client) => {
      // Serialize bootstrap attempts even when platform_user_roles is still empty.
      await client.query("SELECT pg_advisory_xact_lock(741_928_115)");
      const existingAdmin = await client.query<{ user_id: string }>(
        "SELECT user_id FROM platform_user_roles WHERE role = 'SUPER_ADMIN' LIMIT 1"
      );
      if (existingAdmin.rows[0]) return null;

      const existingUser = await client.query<{ id: string }>(
        "SELECT id FROM app_users WHERE lower(email) = lower($1) FOR UPDATE",
        [input.user.email]
      );
      if (existingUser.rows[0]) return null;

      await client.query(
        `INSERT INTO app_users (
          id, email, display_name, password_hash, password_changed_at, must_change_password, status,
          two_factor_enabled, two_factor_secret_encrypted, recovery_code_hashes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8, $9::jsonb, $10)`,
        [
          input.user.id,
          input.user.email,
          input.user.displayName,
          input.user.passwordHash ?? null,
          input.user.passwordChangedAt ?? null,
          input.user.mustChangePassword,
          input.user.mfa.enabled,
          input.user.mfa.encryptedTotpSecret ? Buffer.from(input.user.mfa.encryptedTotpSecret, "utf8") : null,
          JSON.stringify(input.user.mfa.recoveryCodeHashes),
          input.createdAt
        ]
      );
      // The database trigger independently enforces that MFA is present.
      await client.query(
        "INSERT INTO platform_user_roles (user_id, role, created_at) VALUES ($1, 'SUPER_ADMIN', $2)",
        [input.user.id, input.createdAt]
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, contact_email, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         RETURNING id`,
        [input.organizationName, input.user.email, input.createdAt]
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, active, created_at, updated_at)
         VALUES ($1, $2, 'OWNER', true, $3, $3)`,
        [organization.rows[0].id, input.user.id, input.createdAt]
      );
      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_value, reason, occurred_at)
         VALUES (NULL, $1, 'platform.super_admin_bootstrapped', 'app_user', $1, jsonb_build_object('email', $2::text), 'initial secure bootstrap', $3)`,
        [input.user.id, input.user.email, input.createdAt]
      );
      return this.findUserByIdWithClient(client, input.user.id);
    });
  }

  private async findUserByIdWithClient(client: PostgresQueryClient, userId: string): Promise<AuthUser | null> {
    const result = await client.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [userId]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }
}

interface MembershipProjectionRow extends Record<string, unknown> {
  organization_id: string;
  organization_name: string;
  role: OrganizationRole;
}

/**
 * Read model used exclusively by HTTP routes after AuthService authenticates a
 * user. It never grants a membership for suspended organizations or members.
 */
export class PostgresAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly pool: PostgresPool) {}

  async findDefaultMembershipForUser(userId: string): Promise<MembershipProjection | null> {
    const result = await this.pool.query<MembershipProjectionRow>(
      `${MEMBERSHIP_PROJECTION}
       AND m.user_id = $1
       ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'SALES' THEN 1 WHEN 'INVENTORY_FULFILLMENT' THEN 2 ELSE 3 END, m.created_at ASC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] ? mapMembershipProjection(result.rows[0]) : null;
  }

  async findMembershipForUser(input: { userId: string; organizationId: string }): Promise<MembershipProjection | null> {
    const result = await this.pool.query<MembershipProjectionRow>(
      `${MEMBERSHIP_PROJECTION}
       AND m.user_id = $1 AND m.organization_id = $2
       LIMIT 1`,
      [input.userId, input.organizationId]
    );
    return result.rows[0] ? mapMembershipProjection(result.rows[0]) : null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, revokedAt]
    );
  }
}

type MembershipProjection = {
  organizationId: string;
  organizationName: string;
  role: Exclude<CommerceRole, "SUPER_ADMIN">;
};

const MEMBERSHIP_PROJECTION = `
  SELECT m.organization_id, o.name AS organization_name, m.role
  FROM organization_memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.active = true AND o.status = 'ACTIVE'
`;

function mapUser(row: UserRow): AuthUser {
  const platformRoles = (row.platform_roles ?? []).filter((role): role is PlatformRole => role === "SUPER_ADMIN");
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    passwordHash: row.password_hash ?? undefined,
    passwordChangedAt: row.password_changed_at ? asDate(row.password_changed_at) : undefined,
    mustChangePassword: row.must_change_password,
    platformRoles,
    mfa: {
      enabled: row.two_factor_enabled,
      encryptedTotpSecret: readSecret(row.two_factor_secret_encrypted),
      recoveryCodeHashes: readStringArray(row.recovery_code_hashes),
      required: platformRoles.includes("SUPER_ADMIN")
    }
  };
}

function mapMembership(row: MembershipRow): OrganizationMembership {
  return { organizationId: row.organization_id, userId: row.user_id, role: row.role, active: row.active };
}

function mapMembershipProjection(row: MembershipProjectionRow): MembershipProjection {
  // organization_role is an enum constrained to these non-platform roles.
  return { organizationId: row.organization_id, organizationName: row.organization_name, role: row.role };
}

function mapInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    expiresAt: asDate(row.expires_at),
    acceptedAt: row.accepted_at ? asDate(row.accepted_at) : undefined,
    revokedAt: row.revoked_at ? asDate(row.revoked_at) : undefined,
    createdByUserId: row.created_by_user_id ?? ""
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    userId: row.user_id,
    organizationId: row.organization_id ?? undefined,
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
    lastSeenAt: asDate(row.last_seen_at),
    revokedAt: row.revoked_at ? asDate(row.revoked_at) : undefined,
    userAgentHash: row.user_agent_hash ?? undefined,
    ipPrefix: row.ip_prefix ?? undefined,
    mfaVerifiedAt: row.mfa_verified_at ? asDate(row.mfa_verified_at) : undefined
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function lower(value: string): string {
  return value.toLowerCase();
}

function readSecret(value: Buffer | string | null): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.toString("utf8");
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) return [...value];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string") ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
