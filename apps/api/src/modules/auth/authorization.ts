import type { AuthUser, OrganizationMembership, OrganizationRole } from "./types.js";

export class AuthenticationError extends Error {}
export class ForbiddenError extends Error {}
export class MfaRequiredError extends AuthenticationError {}

export function requireActiveUser(user: AuthUser | null): asserts user is AuthUser {
  if (!user || user.status !== "ACTIVE") throw new AuthenticationError("Authentication failed.");
}

export function requireTenantMembership(
  membership: OrganizationMembership | null,
  allowedRoles?: readonly OrganizationRole[]
): asserts membership is OrganizationMembership {
  if (!membership?.active) throw new ForbiddenError("No active membership for this organization.");
  if (allowedRoles && !allowedRoles.includes(membership.role)) throw new ForbiddenError("Insufficient role for this action.");
}

export function requiresMfa(user: AuthUser): boolean {
  return user.platformRoles.includes("SUPER_ADMIN") || user.mfa.required || user.mfa.enabled;
}

