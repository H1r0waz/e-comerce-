/**
 * Minimal structural types compatible with `pg.Pool` / `pg.PoolClient`.
 * Keeping this port local means the API can inject node-postgres without
 * coupling domain modules to a driver or a concrete connection string.
 */
export interface PostgresQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresPoolClient extends PostgresQueryClient {
  release(): void;
}

export interface PostgresPool extends PostgresQueryClient {
  connect(): Promise<PostgresPoolClient>;
}

export async function withTransaction<T>(pool: PostgresPool, operation: (client: PostgresQueryClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error. A failed connection cannot be recovered here.
    }
    throw error;
  } finally {
    client.release();
  }
}
