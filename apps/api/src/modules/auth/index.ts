import type { ModuleDefinition } from "../shared.js";

export const authModule: ModuleDefinition = {
  name: "auth",
  routePrefix: "/v1/auth",
  description: "Invitation activation, secure password sessions, tenant-bound RBAC, and MFA."
};

export * from "./authorization.js";
export * from "./service.js";
export * from "./types.js";
