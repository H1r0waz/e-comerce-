import type { ModuleDefinition } from "../shared.js";

export const inventoryModule: ModuleDefinition = {
  name: "inventory",
  routePrefix: "/v1/inventory",
  description: "Append-only stock movements, lots, expiry dates, reservations, and cost layers."
};
