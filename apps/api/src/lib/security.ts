import type { IncomingMessage } from "node:http";
import type { RequestContext } from "./http.js";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export class AuthorizationError extends Error {}

/**
 * Temporary boundary until session authentication is implemented. All tenant
 * routes obtain the organization from trusted authentication claims in the
 * future; they must never trust a body-level organizationId.
 */
export function requireTenantContext(request: IncomingMessage, context: RequestContext): RequestContext {
  const organizationId = request.headers["x-organization-id"];
  const actorUserId = request.headers["x-user-id"];
  if (typeof organizationId !== "string" || !ID_PATTERN.test(organizationId)) {
    throw new AuthorizationError("A valid organization context is required.");
  }
  if (typeof actorUserId !== "string" || !ID_PATTERN.test(actorUserId)) {
    throw new AuthorizationError("An authenticated user context is required.");
  }
  return { ...context, organizationId, actorUserId };
}

export function securityHeaders(request: IncomingMessage): Record<string, string> {
  const isSecure = request.headers["x-forwarded-proto"] === "https";
  return {
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-resource-policy": "same-site",
    ...(isSecure ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {})
  };
}
