import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken } from "./tokens.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;

export class MfaConfigurationError extends Error {}

export interface TotpVerificationOptions {
  now?: Date;
  /** Allows one prior/next period for normal clock drift. */
  window?: number;
}

export interface MfaSecretProtector {
  seal(plaintext: string): string;
  open(ciphertext: string): string;
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new MfaConfigurationError("Invalid TOTP secret.");

  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function hotp(secret: string, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function createTotpCode(secret: string, now = new Date()): string {
  return hotp(secret, BigInt(Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS)));
}

export function verifyTotpCode(secret: string, submittedCode: string, options: TotpVerificationOptions = {}): boolean {
  if (!/^\d{6}$/.test(submittedCode)) return false;
  const now = options.now ?? new Date();
  const window = options.window ?? 1;
  if (!Number.isInteger(window) || window < 0 || window > 2) throw new MfaConfigurationError("Invalid TOTP verification window.");
  const counter = BigInt(Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
  const submitted = Buffer.from(submittedCode, "utf8");
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = counter + BigInt(offset);
    if (candidateCounter < 0n) continue;
    const candidate = Buffer.from(hotp(secret, candidateCounter), "utf8");
    if (timingSafeEqual(candidate, submitted)) return true;
  }
  return false;
}

/** Uses AES-256-GCM; persist the output, never the source TOTP secret. */
export function createAesGcmSecretProtector(key: Buffer): MfaSecretProtector {
  if (key.length !== 32) throw new MfaConfigurationError("MFA encryption key must be exactly 32 bytes.");
  return {
    seal(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64url")].join(".");
    },
    open(payload: string): string {
      const [version, ivValue, ciphertextValue, ...extra] = payload.split(".");
      if (version !== "v1" || !ivValue || !ciphertextValue || extra.length !== 0) throw new MfaConfigurationError("Invalid encrypted MFA secret.");
      const iv = Buffer.from(ivValue, "base64url");
      const combined = Buffer.from(ciphertextValue, "base64url");
      if (iv.length !== 12 || combined.length <= 16) throw new MfaConfigurationError("Invalid encrypted MFA secret.");
      const ciphertext = combined.subarray(0, -16);
      const tag = combined.subarray(-16);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }
  };
}

export interface RecoveryCodeBundle {
  codes: string[];
  hashes: string[];
}

/** Display each recovery code once. Persist only its hash. */
export function createRecoveryCodes(quantity = 10): RecoveryCodeBundle {
  if (!Number.isInteger(quantity) || quantity < 5 || quantity > 20) throw new MfaConfigurationError("Invalid recovery-code quantity.");
  const codes = Array.from({ length: quantity }, () => createOpaqueToken().slice(0, 10).toUpperCase());
  return { codes, hashes: codes.map(hashOpaqueToken) };
}

