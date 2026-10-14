import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hashOpaqueToken } from "../lib/auth/tokens.js";
import { AuthenticationError, BootstrapUnavailableError, ForbiddenError, MfaRequiredError } from "../modules/auth/authorization.js";
import type {
  ApiRouteDependencies,
  ApiRouteHandler,
  AuthenticatedSession,
  CommerceRole,
  CommerceSessionResponse,
  MfaChallengeResponse,
  SessionUserResponse
} from "./types.js";

export * from "./types.js";

const SESSION_COOKIE = "commerce_session";
const MAX_JSON_BYTES = 16 * 1024;

class HttpRouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Handles only the public API routes. It is intentionally independent from
 * createApp so that transport and database wiring can be composed at startup.
 */
export function createApiRouteHandler(dependencies: ApiRouteDependencies): ApiRouteHandler {
  return async (request, response, requestId) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const pathname = url.pathname;
    if (!isKnownRoute(method, pathname)) return false;

    try {
      if (method === "OPTIONS") {
        applyCors(request, response, dependencies, true);
        response.writeHead(204);
        response.end();
        return true;
      }

      applyCors(request, response, dependencies, false);
      if (isStateChanging(method)) requireTrustedOrigin(request, dependencies);

      if (method === "GET" && pathname === "/v1/auth/session") {
        const session = await requireCommerceSession(request, dependencies);
        sendData(response, 200, session, requestId);
        return true;
      }

      if (method === "DELETE" && pathname === "/v1/auth/session") {
        const token = requireSessionToken(request);
        await dependencies.authRepository.revokeSessionByTokenHash(hashOpaqueToken(token), new Date());
        clearSessionCookie(response, dependencies);
        sendData(response, 200, null, requestId);
        return true;
      }

      if (method === "POST" && pathname === "/v1/auth/login") {
        const body = await readJsonObject(request);
        const email = requiredString(body, "email", 254);
        const password = requiredString(body, "password", 1024);
        const organizationId = optionalString(body, "organizationId", 128);
        const login = await dependencies.auth.beginPasswordLogin({
          email,
          password,
          organizationId,
          userAgentHash: hashUserAgent(request),
          ipPrefix: requestIpPrefix(request)
        });
        setSessionCookie(response, login.sessionToken, login.expiresAt, dependencies);
        if (login.requiresMfa) {
          sendData<MfaChallengeResponse>(response, 200, { requiresMfa: true }, requestId);
          return true;
        }
        const session = await requireCommerceSession(request, dependencies, login.sessionToken, organizationId);
        sendData(response, 200, session, requestId);
        return true;
      }

      if (method === "POST" && pathname === "/v1/auth/invitations/accept") {
        const body = await readJsonObject(request);
        const accepted = await dependencies.auth.acceptInvitation({
          token: requiredString(body, "invitationToken", 512),
          displayName: requiredString(body, "displayName", 120),
          password: requiredString(body, "password", 1024)
        });
        const membership = await requireMembership(dependencies, accepted.id);
        const login = await dependencies.auth.beginPasswordLogin({
          email: accepted.email,
          password: requiredString(body, "password", 1024),
          organizationId: membership.organizationId,
          userAgentHash: hashUserAgent(request),
          ipPrefix: requestIpPrefix(request)
        });
        setSessionCookie(response, login.sessionToken, login.expiresAt, dependencies);
        if (login.requiresMfa) {
          sendData<MfaChallengeResponse>(response, 200, { requiresMfa: true }, requestId);
          return true;
        }
        const session = await requireCommerceSession(request, dependencies, login.sessionToken, membership.organizationId);
        sendData(response, 201, session, requestId);
        return true;
      }

      if (method === "POST" && pathname === "/v1/auth/mfa/verify") {
        const body = await readJsonObject(request);
        const token = requireSessionToken(request);
        await dependencies.auth.verifyMfaForSession({
          sessionToken: token,
          code: requiredString(body, "code", 32),
          recoveryCode: optionalBoolean(body, "recoveryCode")
        });
        const session = await requireCommerceSession(request, dependencies, token);
        sendData(response, 200, session, requestId);
        return true;
      }

      if (method === "POST" && pathname === "/v1/bootstrap/super-admin/complete") {
        const body = await readJsonObject(request);
        const completed = await dependencies.auth.completeInitialSuperAdminBootstrap({
          bootstrapToken: requiredString(body, "bootstrapToken", 512),
          email: requiredString(body, "email", 254),
          displayName: requiredString(body, "displayName", 120),
          organizationName: requiredString(body, "organizationName", 120),
          password: requiredString(body, "password", 1024)
        });
        sendData(response, 201, null, requestId);
        return true;
      }

      if (method === "GET" && pathname === "/v1/dashboard") {
        const session = await requireCommerceSession(request, dependencies, undefined, optionalQueryString(url, "organizationId", 128));
        const data = await dependencies.dashboardRepository.getDashboard({
          organizationId: session.user.organizationId,
          actorUserId: session.user.id,
          now: new Date()
        });
        sendData(response, 200, data, requestId);
        return true;
      }

      return false;
    } catch (error) {
      logUnexpectedRouteError(error, requestId, pathname);
      sendRouteError(response, error, requestId);
      return true;
    }
  };
}

async function requireCommerceSession(
  request: IncomingMessage,
  dependencies: ApiRouteDependencies,
  providedToken?: string,
  requestedOrganizationId?: string
): Promise<CommerceSessionResponse> {
  const token = providedToken ?? requireSessionToken(request);
  const provisional = await dependencies.auth.requireSession(token, requestedOrganizationId);
  const membership = requestedOrganizationId && provisional.session.organizationId === requestedOrganizationId
    ? await requireMembership(dependencies, provisional.user.id, requestedOrganizationId)
    : await requireMembership(dependencies, provisional.user.id);
  const verified = await dependencies.auth.requireSession(token, membership.organizationId);
  return {
    user: toSessionUser(verified, membership),
    expiresAt: verified.session.expiresAt.toISOString()
  };
}

async function requireMembership(
  dependencies: ApiRouteDependencies,
  userId: string,
  organizationId?: string
): Promise<{ organizationId: string; organizationName: string; role: Exclude<CommerceRole, "SUPER_ADMIN"> }> {
  const membership = organizationId
    ? await dependencies.authRepository.findMembershipForUser({ userId, organizationId })
    : await dependencies.authRepository.findDefaultMembershipForUser(userId);
  if (!membership) {
    throw new HttpRouteError(403, "organization_access_denied", "No tenés acceso a ese comercio.");
  }
  return membership;
}

function toSessionUser(
  context: AuthenticatedSession,
  membership: { organizationId: string; organizationName: string; role: Exclude<CommerceRole, "SUPER_ADMIN"> }
): SessionUserResponse {
  const role: CommerceRole = context.user.platformRoles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : membership.role;
  return {
    id: context.user.id,
    email: context.user.email,
    displayName: context.user.displayName,
    role,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName
  };
}

function isKnownRoute(method: string, pathname: string): boolean {
  const routes = [
    "/v1/auth/session", "/v1/auth/login", "/v1/auth/invitations/accept", "/v1/auth/mfa/verify", "/v1/dashboard",
    "/v1/bootstrap/super-admin/complete"
  ];
  return (method === "OPTIONS" && routes.includes(pathname))
    || (method === "GET" && ["/v1/auth/session", "/v1/dashboard"].includes(pathname))
    || (method === "DELETE" && pathname === "/v1/auth/session")
    || (method === "POST" && ["/v1/auth/login", "/v1/auth/invitations/accept", "/v1/auth/mfa/verify", "/v1/bootstrap/super-admin/complete"].includes(pathname));
}

function isStateChanging(method: string): boolean {
  return method === "POST" || method === "DELETE";
}

function applyCors(request: IncomingMessage, response: ServerResponse, dependencies: ApiRouteDependencies, preflight: boolean): void {
  const origin = request.headers.origin;
  if (!origin) return;
  if (origin !== dependencies.corsOrigin) throw new HttpRouteError(403, "origin_not_allowed", "Origen no permitido.");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("vary", "Origin");
  if (preflight) {
    response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-max-age", "600");
  }
}

function requireTrustedOrigin(request: IncomingMessage, dependencies: ApiRouteDependencies): void {
  const origin = request.headers.origin;
  // Browser requests that can carry the session cookie must be same trusted origin.
  if (origin && origin !== dependencies.corsOrigin) throw new HttpRouteError(403, "origin_not_allowed", "Origen no permitido.");
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"];
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    throw new HttpRouteError(415, "unsupported_media_type", "Se requiere contenido JSON.");
  }
  let byteCount = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += buffer.length;
    if (byteCount > MAX_JSON_BYTES) {
      throw new HttpRouteError(413, "payload_too_large", "La solicitud excede el tamaño permitido.");
    }
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRouteError(400, "invalid_json", "El cuerpo JSON no es válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpRouteError(400, "invalid_request", "El cuerpo de la solicitud debe ser un objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new HttpRouteError(400, "invalid_request", "La solicitud contiene campos inválidos.");
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string, maximumLength: number): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  return requiredString(body, key, maximumLength);
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new HttpRouteError(400, "invalid_request", "La solicitud contiene campos inválidos.");
  return value;
}

function optionalQueryString(url: URL, key: string, maximumLength: number): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (!value.trim() || value.length > maximumLength) throw new HttpRouteError(400, "invalid_request", "La consulta contiene valores inválidos.");
  return value.trim();
}

function requireSessionToken(request: IncomingMessage): string {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) throw new HttpRouteError(401, "unauthenticated", "Necesitás iniciar sesión.");
  return token;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const values: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key || !value || values[key] !== undefined) continue;
    try {
      values[key] = decodeURIComponent(value);
    } catch {
      // Invalid cookie encoding is treated as a missing credential.
    }
  }
  return values;
}

function setSessionCookie(response: ServerResponse, token: string, expiresAt: Date, dependencies: ApiRouteDependencies): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.setHeader("set-cookie", serializeSessionCookie(token, maxAge, dependencies));
}

function clearSessionCookie(response: ServerResponse, dependencies: ApiRouteDependencies): void {
  response.setHeader("set-cookie", serializeSessionCookie("", 0, dependencies));
}

function serializeSessionCookie(token: string, maxAge: number, dependencies: ApiRouteDependencies): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (dependencies.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function hashUserAgent(request: IncomingMessage): string | undefined {
  const userAgent = request.headers["user-agent"];
  return typeof userAgent === "string" && userAgent ? createHash("sha256").update(userAgent, "utf8").digest("base64url") : undefined;
}

function requestIpPrefix(request: IncomingMessage): string | undefined {
  const address = request.socket?.remoteAddress;
  if (!address) return undefined;
  const ipv4 = address.match(/^(?:.*:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4) return ipv4[1];
  return address.split(":").filter(Boolean).slice(0, 4).join(":") || undefined;
}

function sendData<T>(response: ServerResponse, status: number, data: T, requestId: string): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify({ data, requestId }));
}

function sendRouteError(response: ServerResponse, error: unknown, requestId: string): void {
  const routeError = toRouteError(error);
  response.writeHead(routeError.status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify({ error: { code: routeError.code, message: routeError.message }, requestId }));
}

/** Log only route metadata and a redacted error summary; request bodies hold credentials. */
function logUnexpectedRouteError(error: unknown, requestId: string, pathname: string): void {
  const routeError = toRouteError(error);
  if (routeError.status < 500) return;
  const source = error instanceof Error ? error : undefined;
  const driverCode = source && "code" in source && typeof source.code === "string" ? source.code : undefined;
  const message = source?.message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
    .slice(0, 500);
  console.error(JSON.stringify({ event: "api_route_failure", requestId, pathname, errorName: source?.name, driverCode, message }));
}

function toRouteError(error: unknown): HttpRouteError {
  if (error instanceof HttpRouteError) return error;
  if (error instanceof MfaRequiredError) return new HttpRouteError(403, "mfa_required", "Necesitás verificar tu segundo factor.");
  if (error instanceof BootstrapUnavailableError) return new HttpRouteError(404, "not_found", "No encontramos el recurso solicitado.");
  if (error instanceof AuthenticationError) return new HttpRouteError(401, "unauthenticated", "Las credenciales no son válidas.");
  if (error instanceof ForbiddenError) return new HttpRouteError(403, "forbidden", "No tenés permisos para realizar esta acción.");
  return new HttpRouteError(500, "internal_error", "No pudimos completar la solicitud.");
}
