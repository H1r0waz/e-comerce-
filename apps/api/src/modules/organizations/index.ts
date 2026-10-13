import type { ModuleDefinition } from "../shared.js";

export const organizationsModule: ModuleDefinition = {
  name: "organizations",
  routePrefix: "/v1/organizations",
  description: "Platform-managed commerce organizations and tenant configuration."
};
