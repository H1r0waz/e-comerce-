import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import type { AppConfig } from "./config/env.js";
import { PostgresAuthRepository, PostgresAuthSessionRepository, PostgresDashboardRepository, type PostgresPool } from "./adapters/postgres/index.js";
import { createAesGcmSecretProtector } from "./lib/auth/totp.js";
import { AuthService } from "./modules/auth/service.js";
import { createApiRouteHandler, type ApiRouteHandler } from "./routes/index.js";

/**
 * Wires the HTTP API to Neon only when its required secrets are supplied.
 * This keeps health checks available in a fresh checkout without silently
 * falling back to an in-memory authentication or data store.
 */
export function createDatabaseRouteHandler(config: AppConfig): ApiRouteHandler | undefined {
  if (!config.databaseUrl) return undefined;
  if (!config.mfaEncryptionKey) {
    throw new Error("MFA_ENCRYPTION_KEY is required whenever DATABASE_URL is configured.");
  }

  const nodePool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000
  });
  // Lets Vercel drain pooled connections when Fluid Compute suspends an instance.
  attachDatabasePool(nodePool);

  const pool = nodePool as unknown as PostgresPool;
  const authRepository = new PostgresAuthRepository(pool);
  const auth = new AuthService({
    repository: authRepository,
    mfaSecretProtector: createAesGcmSecretProtector(config.mfaEncryptionKey),
    superuserBootstrapTokenHash: config.superuserBootstrapTokenHash
  });

  return createApiRouteHandler({
    auth,
    authRepository: new PostgresAuthSessionRepository(pool),
    dashboardRepository: new PostgresDashboardRepository(pool),
    nodeEnv: config.nodeEnv,
    corsOrigin: config.corsOrigin
  });
}
