import type { ModuleDefinition } from "../shared.js";

export const productsModule: ModuleDefinition = {
  name: "products",
  routePrefix: "/v1/products",
  description: "Tenant catalogue, categories, configurable attributes, variants, and prices."
};
