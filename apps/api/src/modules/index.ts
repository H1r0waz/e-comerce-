import { authModule } from "./auth/index.js";
import { catalogModule } from "./catalog/index.js";
import { inventoryModule } from "./inventory/index.js";
import { ordersModule } from "./orders/index.js";
import { organizationsModule } from "./organizations/index.js";
import { paymentsModule } from "./payments/index.js";
import { shipmentsModule } from "./shipments/index.js";
import type { ModuleDefinition } from "./shared.js";
import { usersModule } from "./users/index.js";

export const modules: readonly ModuleDefinition[] = [
  authModule,
  organizationsModule,
  usersModule,
  catalogModule,
  inventoryModule,
  ordersModule,
  paymentsModule,
  shipmentsModule
];
