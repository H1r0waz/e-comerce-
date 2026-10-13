import { inventoryModule } from "./inventory/index.js";
import { ordersModule } from "./orders/index.js";
import { organizationsModule } from "./organizations/index.js";
import { paymentsModule } from "./payments/index.js";
import { productsModule } from "./products/index.js";
import { shipmentsModule } from "./shipments/index.js";
import type { ModuleDefinition } from "./shared.js";
import { usersModule } from "./users/index.js";

export const modules: readonly ModuleDefinition[] = [
  organizationsModule,
  usersModule,
  productsModule,
  inventoryModule,
  ordersModule,
  paymentsModule,
  shipmentsModule
];
