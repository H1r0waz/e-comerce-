import type { IncomingMessage, ServerResponse } from "node:http";

export interface RequestContext {
  requestId: string;
  method: string;
  pathname: string;
  organizationId?: string;
  actorUserId?: string;
  ipAddress?: string;
}

export function createRequestContext(request: IncomingMessage, requestId: string): RequestContext {
  const url = new URL(request.url ?? "/", "http://localhost");
  return {
    requestId,
    method: request.method ?? "GET",
    pathname: url.pathname,
    ipAddress: request.socket.remoteAddress
  };
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

export function sendNotFound(response: ServerResponse, requestId: string): void {
  sendJson(response, 404, { error: { code: "not_found", message: "Route not found." }, requestId });
}
