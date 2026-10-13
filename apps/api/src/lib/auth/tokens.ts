import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

/** Opaque credentials are only persisted as SHA-256 hashes. */
export function createOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

/**
 * Use only for comparing user-supplied values that are already hashes. Session
 * lookup should be indexed by hash, not by a raw token scan.
 */
export function hashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

