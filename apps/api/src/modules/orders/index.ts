import type { ModuleDefinition } from "../shared.js";

export const ordersModule: ModuleDefinition = {
  name: "orders",
  routePrefix: "/v1/orders",
  description: "Digital-channel orders, state transitions, stock reservations, and line items."
};
