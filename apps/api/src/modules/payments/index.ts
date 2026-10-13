import type { ModuleDefinition } from "../shared.js";

export const paymentsModule: ModuleDefinition = {
  name: "payments",
  routePrefix: "/v1/payments",
  description: "Manual payment confirmation, partial payments, fees, and refunds."
};
