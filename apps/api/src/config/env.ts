export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  /** Used by authentication/session adapters; never log its value. */
  sessionSecret: string;
  /** Pooled Neon connection URL for normal application traffic. */
  databaseUrl?: string;
  /** 32-byte AES key used only to encrypt stored TOTP secrets. */
  mfaEncryptionKey?: Buffer;
  /** SHA-256/base64url hash of the one-time initial-superuser bootstrap token. */
  superuserBootstrapTokenHash?: string;
  corsOrigin: string;
}

function positivePort(value: string | undefined): number {
  if (value === undefined) return 3001;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function decodeMfaKey(value: string | undefined, required: boolean): Buffer | undefined {
  if (!value) {
    if (required) throw new Error("MFA_ENCRYPTION_KEY is required in production.");
    return undefined;
  }
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  return key;
}

function validateBootstrapTokenHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("SUPERUSER_BOOTSTRAP_TOKEN_HASH must be a SHA-256 base64url hash.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    throw new Error("SUPERUSER_BOOTSTRAP_TOKEN_HASH must be a SHA-256 base64url hash.");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const candidate = env.NODE_ENV ?? "development";
  if (candidate !== "development" && candidate !== "test" && candidate !== "production") {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  const sessionSecret = env.SESSION_SECRET;
  if (candidate === "production" && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error("SESSION_SECRET must have at least 32 characters in production.");
  }
  const databaseUrl = env.DATABASE_URL;
  if (candidate === "production" && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production.");
  }

  return {
    nodeEnv: candidate,
    port: positivePort(env.PORT),
    host: env.HOST ?? "127.0.0.1",
    // A harmless development default avoids blocking a fresh local checkout.
    sessionSecret: sessionSecret ?? "development-only-secret-change-before-production",
    databaseUrl,
    mfaEncryptionKey: decodeMfaKey(env.MFA_ENCRYPTION_KEY, candidate === "production"),
    superuserBootstrapTokenHash: validateBootstrapTokenHash(env.SUPERUSER_BOOTSTRAP_TOKEN_HASH),
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000"
  };
}
