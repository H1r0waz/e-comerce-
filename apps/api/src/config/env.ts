export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  /** Used by authentication/session adapters; never log its value. */
  sessionSecret: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const candidate = env.NODE_ENV ?? "development";
  if (candidate !== "development" && candidate !== "test" && candidate !== "production") {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  const sessionSecret = env.SESSION_SECRET;
  if (candidate === "production" && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error("SESSION_SECRET must have at least 32 characters in production.");
  }

  return {
    nodeEnv: candidate,
    port: positivePort(env.PORT),
    host: env.HOST ?? "127.0.0.1",
    // A harmless development default avoids blocking a fresh local checkout.
    sessionSecret: sessionSecret ?? "development-only-secret-change-before-production",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000"
  };
}
