/** Minimal context required by every tenant-scoped use case. */
export interface TenantContext {
  organizationId: string;
  actorUserId: string;
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export class TenantBoundaryError extends Error {
  constructor() {
    super("The requested resource does not belong to the current organization.");
    this.name = "TenantBoundaryError";
  }
}

export function requireTenantId(organizationId: string): void {
  if (!organizationId.trim()) throw new DomainValidationError("organizationId is required.");
}

/**
 * Defense in depth: repositories must filter by organizationId and services
 * still verify returned entities before using them.
 */
export function assertSameTenant(context: TenantContext, entity: { organizationId: string }): void {
  requireTenantId(context.organizationId);
  if (entity.organizationId !== context.organizationId) throw new TenantBoundaryError();
}

export function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new DomainValidationError(`${field} must be a positive integer.`);
}

export function requireMinorMoney(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(`${field} must be a non-negative integer in minor units.`);
  }
}
