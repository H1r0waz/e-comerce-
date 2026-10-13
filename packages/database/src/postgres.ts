/**
 * Small driver-neutral port for Postgres adapters. The API supplies a
 * node-postgres/Neon implementation; this package owns the tenancy contract.
 */
export type SqlValue = string | number | boolean | Date | null | undefined | readonly SqlValue[];

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[]
  ): Promise<QueryResult<Row>>;
}

export interface TransactionExecutor extends SqlExecutor {
  transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface TenantContext {
  readonly organizationId: string;
  readonly actorUserId?: string;
}

/**
 * Creates parameter lists that always begin with the tenant boundary. Query
 * builders must use it instead of interpolating values into SQL strings.
 */
export function tenantParameters(
  context: TenantContext,
  ...values: readonly SqlValue[]
): readonly SqlValue[] {
  return [context.organizationId, ...values];
}

/**
 * Guards against accidental use of a missing tenant in repository code.
 * Database foreign keys then enforce that tenant on all related records.
 */
export function requireTenant(context: TenantContext): TenantContext {
  if (!context.organizationId || context.organizationId.trim().length === 0) {
    throw new Error("A non-empty organizationId is required for database access.");
  }
  return context;
}
