import type { RequestContext } from "../lib/http.js";

export interface TenantEntity {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

/** Contract every repository must satisfy to prevent cross-tenant access. */
export interface TenantRepository<T extends TenantEntity> {
  list(context: Required<Pick<RequestContext, "organizationId">>): Promise<T[]>;
  findById(context: Required<Pick<RequestContext, "organizationId">>, id: string): Promise<T | null>;
  create(context: Required<Pick<RequestContext, "organizationId">>, entity: Omit<T, keyof TenantEntity>): Promise<T>;
}

export interface ModuleDefinition {
  name: string;
  routePrefix: string;
  description: string;
}
