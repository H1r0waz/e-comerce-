import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppConfig } from "./config/env.js";
import { createRequestContext, sendJson, sendNotFound } from "./lib/http.js";
import { AuthorizationError, requireTenantContext, securityHeaders } from "./lib/security.js";
import { modules } from "./modules/index.js";
import type { ApiRouteHandler } from "./routes/index.js";

export interface AppDependencies {
  apiRouteHandler?: ApiRouteHandler;
}

function applySecurityHeaders(request: IncomingMessage, response: ServerResponse): void {
  for (const [name, value] of Object.entries(securityHeaders(request))) response.setHeader(name, value);
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const startedAt = new Date().toISOString();
  return createServer((request, response) => {
    void dispatch(request, response).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: { code: "internal_error", message: "No pudimos completar la solicitud." }, requestId: randomUUID() });
      } else {
        response.destroy();
      }
    });
  });

  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const context = createRequestContext(request, requestId);
    applySecurityHeaders(request, response);

    if (context.method === "GET" && context.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "commerce-api",
        environment: config.nodeEnv,
        startedAt,
        requestId
      });
      return;
    }

    if (dependencies.apiRouteHandler && await dependencies.apiRouteHandler(request, response, requestId)) return;

    if (context.method === "GET" && context.pathname === "/v1/modules") {
      try {
        requireTenantContext(request, context);
        sendJson(response, 200, { data: modules, requestId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unauthorized";
        sendJson(response, error instanceof AuthorizationError ? 401 : 500, { error: { code: "unauthorized", message }, requestId });
      }
      return;
    }

    sendNotFound(response, requestId);
  }
}
