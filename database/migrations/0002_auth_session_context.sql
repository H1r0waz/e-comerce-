-- Align persistent auth state with the API session model.
-- Apply on a direct (non-pooler) connection after 0001_initial.sql.

BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_agent_hash text,
  ADD COLUMN IF NOT EXISTS ip_prefix text;

CREATE INDEX IF NOT EXISTS auth_sessions_active_tenant_idx
  ON auth_sessions (organization_id, expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN auth_sessions.user_agent_hash IS
  'SHA-256 hash of the user-agent family; do not persist raw user-agent for session binding.';
COMMENT ON COLUMN auth_sessions.ip_prefix IS
  'Coarse client-network prefix used for anomaly detection, never the full source address.';

COMMIT;
