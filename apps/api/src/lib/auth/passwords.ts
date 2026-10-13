import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const MAX_PASSWORD_LENGTH = 1_024;

export class PasswordPolicyError extends Error {}

function deriveScryptKey(password: string, salt: Buffer, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(Buffer.from(derivedKey));
    });
  });
}

/**
 * Passwords are normalized to avoid visually-identical Unicode values producing
 * surprising credentials. The resulting value must only live for the duration
 * of a request; callers must never log it.
 */
function normalizePassword(password: string): string {
  if (typeof password !== "string") throw new PasswordPolicyError("A password is required.");
  const normalized = password.normalize("NFKC");
  if (normalized.length < 12) throw new PasswordPolicyError("Password must contain at least 12 characters.");
  if (normalized.length > MAX_PASSWORD_LENGTH) throw new PasswordPolicyError("Password is too long.");
  return normalized;
}

/**
 * Create an encoded, parameterized scrypt hash. The format is deliberately
 * self-contained so its parameters can be upgraded without breaking existing
 * accounts: scrypt$N$r$p$salt$derivedKey.
 */
export async function hashPassword(password: string): Promise<string> {
  const normalized = normalizePassword(password);
  const salt = randomBytes(16);
  const derivedKey = await deriveScryptKey(normalized, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derivedKey.toString("base64url")].join("$");
}

/** Return false for malformed or non-matching hashes without exposing why. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const [algorithm, n, r, p, saltValue, hashValue, ...extra] = encodedHash.split("$");
    if (
      algorithm !== "scrypt" ||
      extra.length !== 0 ||
      !saltValue ||
      !hashValue ||
      Number(n) !== SCRYPT_N ||
      Number(r) !== SCRYPT_R ||
      Number(p) !== SCRYPT_P
    ) {
      return false;
    }

    const normalized = normalizePassword(password);
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;

    const actual = await deriveScryptKey(normalized, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

