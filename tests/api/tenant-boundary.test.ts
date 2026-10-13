import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../../apps/api/src/app.ts";

const server = createApp({
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  sessionSecret: "test-session-secret-that-is-not-used-in-production",
  corsOrigin: "http://localhost:3000"
});

let origin = "";

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

async function get(path: string, headers?: Record<string, string>) {
  const response = await fetch(`${origin}${path}`, { headers });
  return { response, body: await response.json() as Record<string, unknown> };
}

test("tenant routes reject absent organization or actor context", async () => {
  const noContext = await get("/v1/modules");
  assert.equal(noContext.response.status, 401);

  const missingActor = await get("/v1/modules", { "x-organization-id": "org_alpha" });
  assert.equal(missingActor.response.status, 401);

  const missingOrganization = await get("/v1/modules", { "x-user-id": "user_alpha" });
  assert.equal(missingOrganization.response.status, 401);
});

test("tenant routes reject malformed tenant identifiers", async () => {
  const result = await get("/v1/modules", {
    "x-organization-id": "org alpha", // whitespace must not be accepted in a tenant claim
    "x-user-id": "user_alpha"
  });

  assert.equal(result.response.status, 401);
  assert.equal((result.body.error as { code: string }).code, "unauthorized");
});

test("protected responses have baseline anti-caching and browser security headers", async () => {
  const { response } = await get("/v1/modules", {
    "x-organization-id": "org_alpha",
    "x-user-id": "user_alpha"
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
