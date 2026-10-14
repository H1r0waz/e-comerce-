-- The initial platform administrator is protected by the one-time bootstrap
-- token and a strong password. MFA can be enrolled later from account security.
DROP TRIGGER IF EXISTS enforce_super_admin_mfa_on_role ON platform_user_roles;
DROP TRIGGER IF EXISTS enforce_super_admin_mfa_on_user ON app_users;
DROP FUNCTION IF EXISTS enforce_super_admin_mfa();
