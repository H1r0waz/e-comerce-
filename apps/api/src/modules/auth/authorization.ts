import type { AuthUser, OrganizationMembership, OrganizationRole } from "./types.js";

export class AuthenticationError extends Error {}
export class ForbiddenError extends Error {}
export class MfaRequiredError extends AuthenticationError {}
/** Deliberately indistinguishable from a missing route at the HTTP boundary. */
export class BootstrapUnavailableError extends Error {}

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
  // La instalación actual no ofrece segundo factor: todos los accesos usan
  // correo y contraseña. Se conserva el parámetro para no romper el contrato
  // de dominio mientras esa funcionalidad se rediseña en el futuro.
  void user;
  return false;
}

