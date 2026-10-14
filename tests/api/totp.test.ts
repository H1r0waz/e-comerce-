import assert from "node:assert/strict";
import test from "node:test";
import { createTotpCode, verifyTotpCode } from "../../apps/api/src/lib/auth/totp.ts";

test("TOTP uses the standard SHA-1, 6-digit, 30-second profile", () => {
  // RFC 6238 test secret (ASCII "12345678901234567890") encoded as Base32.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const timestamp = new Date(59_000);

  assert.equal(createTotpCode(secret, timestamp), "287082");
  assert.equal(verifyTotpCode(secret, "287082", { now: timestamp, window: 0 }), true);
  assert.equal(verifyTotpCode(secret, "287083", { now: timestamp, window: 0 }), false);
});
