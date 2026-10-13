import type { ModuleDefinition } from "../shared.js";

export const usersModule: ModuleDefinition = {
  name: "users",
  routePrefix: "/v1/users",
  description: "Invitations, roles, password-change enforcement, sessions, and MFA enrollment."
};
