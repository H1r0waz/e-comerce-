import type { ModuleDefinition } from "../shared.js";
import { assertSameTenant, DomainValidationError, requireMinorMoney, requirePositiveInteger, type TenantContext } from "../catalog/tenant.js";

export const inventoryModule: ModuleDefinition = {
  name: "inventory",
  routePrefix: "/v1/inventory",
  description: "Append-only stock movements, FIFO cost layers, lots, and reservations."
};

export interface CostLayer {
  id: string;
  organizationId: string;
  productVariantId: string;
  receivedAt: string;
  expiresAt?: string;
  lotCode?: string;
  unitCostMinor: number;
  currency: string;
  availableQuantity: number;
  reservedQuantity: number;
}

export interface StockReservationAllocation {
  costLayerId: string;
  quantity: number;
}

export interface StockReservation {
  id: string;
  organizationId: string;
  orderId: string;
  productVariantId: string;
  quantity: number;
  allocations: StockReservationAllocation[];
  status: "active" | "released" | "expired" | "consumed";
  expiresAt: string;
}

export interface InventoryLevel {
  organizationId: string;
  productVariantId: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold?: number;
}

export interface ReceiveStockCommand {
  productVariantId: string;
  quantity: number;
  unitCostMinor: number;
  currency?: string;
  lotCode?: string;
  expiresAt?: string;
  receivedAt?: string;
}

/** Transactional repository: layer allocation must not race with another order. */
export interface InventoryRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  addCostLayer(context: TenantContext, command: ReceiveStockCommand): Promise<CostLayer>;
  listAvailableLayersForUpdate(context: TenantContext, variantId: string): Promise<CostLayer[]>;
  saveLayers(context: TenantContext, layers: CostLayer[]): Promise<void>;
  createReservation(context: TenantContext, reservation: Omit<StockReservation, "id">): Promise<StockReservation>;
  findReservationForUpdate(context: TenantContext, reservationId: string): Promise<StockReservation | null>;
  saveReservation(context: TenantContext, reservation: StockReservation): Promise<void>;
  listActiveReservationsExpiredBefore(context: TenantContext, before: string): Promise<StockReservation[]>;
  getLevel(context: TenantContext, variantId: string): Promise<InventoryLevel | null>;
  listLowStock(context: TenantContext): Promise<InventoryLevel[]>;
  listExpiringLayers(context: TenantContext, before: string): Promise<CostLayer[]>;
}

export interface InventoryReservationPort {
  reserve(context: TenantContext, input: { orderId: string; productVariantId: string; quantity: number; expiresAt: string }): Promise<StockReservation>;
  release(context: TenantContext, reservationId: string, reason: "cancelled" | "expired" | "manual"): Promise<void>;
  consume(context: TenantContext, reservationId: string): Promise<void>;
}

export class InventoryService implements InventoryReservationPort {
  constructor(private readonly repository: InventoryRepository) {}

  async receive(context: TenantContext, command: ReceiveStockCommand): Promise<CostLayer> {
    requirePositiveInteger(command.quantity, "quantity");
    requireMinorMoney(command.unitCostMinor, "unitCostMinor");
    if (command.expiresAt && Date.parse(command.expiresAt) <= Date.parse(command.receivedAt ?? new Date().toISOString())) {
      throw new DomainValidationError("expiresAt must be later than receivedAt.");
    }
    return this.repository.addCostLayer(context, command);
  }

  async reserve(context: TenantContext, input: { orderId: string; productVariantId: string; quantity: number; expiresAt: string }): Promise<StockReservation> {
    requirePositiveInteger(input.quantity, "quantity");
    if (Date.parse(input.expiresAt) <= Date.now()) throw new DomainValidationError("Reservation expiry must be in the future.");
    return this.repository.transaction(async () => {
      const layers = await this.repository.listAvailableLayersForUpdate(context, input.productVariantId);
      layers.forEach((layer) => assertSameTenant(context, layer));
      let pending = input.quantity;
      const allocations: StockReservationAllocation[] = [];
      for (const layer of [...layers].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
        const available = layer.availableQuantity - layer.reservedQuantity;
        const allocation = Math.min(available, pending);
        if (allocation <= 0) continue;
        layer.reservedQuantity += allocation;
        pending -= allocation;
        allocations.push({ costLayerId: layer.id, quantity: allocation });
        if (!pending) break;
      }
      if (pending > 0) throw new DomainValidationError("Insufficient available stock for reservation.");
      await this.repository.saveLayers(context, layers);
      return this.repository.createReservation(context, {
        organizationId: context.organizationId,
        ...input,
        allocations,
        status: "active"
      });
    });
  }

  async release(context: TenantContext, reservationId: string, reason: "cancelled" | "expired" | "manual"): Promise<void> {
    return this.changeReservation(context, reservationId, reason === "expired" ? "expired" : "released", reason);
  }

  async consume(context: TenantContext, reservationId: string): Promise<void> {
    return this.changeReservation(context, reservationId, "consumed");
  }

  async getAlerts(context: TenantContext, now = new Date()): Promise<{ lowStock: InventoryLevel[]; expiringLots: CostLayer[] }> {
    const before = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const [lowStock, expiringLots] = await Promise.all([
      this.repository.listLowStock(context),
      this.repository.listExpiringLayers(context, before)
    ]);
    lowStock.forEach((item) => assertSameTenant(context, item));
    expiringLots.forEach((item) => assertSameTenant(context, item));
    return { lowStock, expiringLots };
  }

  /** Called by a scheduler; expiration always releases the exact FIFO allocations. */
  async expireDueReservations(context: TenantContext, now = new Date()): Promise<number> {
    const due = await this.repository.listActiveReservationsExpiredBefore(context, now.toISOString());
    due.forEach((reservation) => assertSameTenant(context, reservation));
    await Promise.all(due.map((reservation) => this.release(context, reservation.id, "expired")));
    return due.length;
  }

  private async changeReservation(context: TenantContext, reservationId: string, target: "released" | "expired" | "consumed", reason?: "cancelled" | "expired" | "manual"): Promise<void> {
    await this.repository.transaction(async () => {
      const reservation = await this.repository.findReservationForUpdate(context, reservationId);
      if (!reservation) throw new DomainValidationError("Stock reservation was not found.");
      assertSameTenant(context, reservation);
      if (reservation.status !== "active") return;
      const layers = await this.repository.listAvailableLayersForUpdate(context, reservation.productVariantId);
      const layerById = new Map(layers.map((layer) => [layer.id, layer]));
      for (const allocation of reservation.allocations) {
        const layer = layerById.get(allocation.costLayerId);
        if (!layer) throw new DomainValidationError("Reserved cost layer is no longer available.");
        layer.reservedQuantity -= allocation.quantity;
        if (target === "consumed") layer.availableQuantity -= allocation.quantity;
        if (layer.reservedQuantity < 0 || layer.availableQuantity < 0) throw new DomainValidationError("Inventory invariant violated.");
      }
      reservation.status = target;
      await this.repository.saveLayers(context, layers);
      await this.repository.saveReservation(context, reservation);
      void reason; // persistence/audit adapter records the business reason.
    });
  }
}
