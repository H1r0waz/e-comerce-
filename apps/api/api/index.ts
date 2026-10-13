import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app.js";
import { createDatabaseRouteHandler } from "../src/composition.js";
import { loadConfig } from "../src/config/env.js";

// Kept at module scope so Fluid Compute can reuse the Neon pool between calls.
const config = loadConfig();
const app = createApp(config, { apiRouteHandler: createDatabaseRouteHandler(config) });

/** Vercel Node.js Function entry point. The API never calls app.listen(). */
export default function handler(request: IncomingMessage, response: ServerResponse): void {
  app.emit("request", request, response);
}
