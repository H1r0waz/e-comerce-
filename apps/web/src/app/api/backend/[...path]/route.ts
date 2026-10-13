import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE", "OPTIONS"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SAFE_RESPONSE_HEADERS = new Set(["cache-control", "content-type"]);

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) return errorResponse(405, "method_not_allowed");

  const { path } = await context.params;
  if (!isAllowedApiPath(path)) return errorResponse(404, "not_found");

  const targetOrigin = getBackendOrigin();
  if (!targetOrigin) return errorResponse(503, "service_unavailable");

  const target = new URL(`/v1/${path.slice(1).map(encodeURIComponent).join("/")}`, targetOrigin);
  target.search = request.nextUrl.search;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardRequestHeaders(request),
      body: hasRequestBody(request.method) ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
    if (upstream.status >= 500) return errorResponse(upstream.status === 503 ? 503 : 502, "service_unavailable");
    return forwardResponse(upstream);
  } catch {
    return errorResponse(502, "service_unavailable");
  }
}

function isAllowedApiPath(path: string[]): boolean {
  return path.length >= 2 && path[0] === "v1" && path.every((segment) => segment.length > 0 && !segment.includes("\\"));
}

function getBackendOrigin(): URL | null {
  const configured = process.env.COMMERCIAR_API_URL?.trim();
  if (!configured) return null;

  try {
    const origin = new URL(configured);
    const allowsHttpForLocalDevelopment = process.env.NODE_ENV === "development" && origin.protocol === "http:";
    if (
      (origin.protocol !== "https:" && !allowsHttpForLocalDevelopment)
      || origin.username
      || origin.password
      || (origin.pathname !== "/" && origin.pathname !== "")
      || origin.search
      || origin.hash
    ) return null;
    return origin;
  } catch {
    return null;
  }
}

function forwardRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");

  if (cookie) headers.set("cookie", cookie);
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  return headers;
}

function forwardResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    const normalized = name.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(normalized) && SAFE_RESPONSE_HEADERS.has(normalized)) headers.set(name, value);
  }

  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie?.call(upstream.headers) ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
  for (const cookie of cookies) headers.append("set-cookie", cookie);

  return new Response(upstream.body, { status: upstream.status, headers });
}

function hasRequestBody(method: string): boolean {
  return method !== "GET" && method !== "DELETE";
}

function errorResponse(status: number, code: "method_not_allowed" | "not_found" | "service_unavailable"): Response {
  return Response.json(
    { error: { code, message: code === "service_unavailable" ? "El servicio no está disponible en este momento." : "Solicitud no disponible." } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
