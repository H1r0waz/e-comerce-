import type { ModuleDefinition } from "../shared.js";
import { assertSameTenant, DomainValidationError, requireMinorMoney, type TenantContext } from "../catalog/tenant.js";
import type { Order } from "../orders/index.js";

export const shipmentsModule: ModuleDefinition = {
  name: "shipments",
  routePrefix: "/v1/shipments",
  description: "Manual shipment, collection, tracking, delivery, and return workflows."
};

export type ShipmentStatus = "not_required" | "pending" | "preparing" | "ready_for_pickup" | "dispatched" | "delivered" | "returned";
export type DeliveryMode = "pickup" | "postal_carrier" | "courier" | "own_delivery" | "other";

export interface Shipment {
  id: string;
  organizationId: string;
  orderId: string;
  mode: DeliveryMode;
  status: ShipmentStatus;
  recipientAddress?: string;
  carrierName?: string;
  trackingCode?: string;
  chargedAmountMinor: number;
  businessCostMinor?: number;
  currency: string;
  expectedAt?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  notes?: string;
}

export interface UpsertShipmentCommand {
  orderId: string;
  mode?: DeliveryMode;
  status?: ShipmentStatus;
  recipientAddress?: string;
  carrierName?: string;
  trackingCode?: string;
  chargedAmountMinor?: number;
  businessCostMinor?: number;
  currency?: string;
  expectedAt?: string;
  notes?: string;
}

export interface ShipmentRepository {
  findByOrder(context: TenantContext, orderId: string): Promise<Shipment | null>;
  create(context: TenantContext, shipment: Omit<Shipment, "id">): Promise<Shipment>;
  save(context: TenantContext, shipment: Shipment): Promise<void>;
  listOverdue(context: TenantContext, before: string): Promise<Shipment[]>;
}

export interface ShipmentOrderReader {
  findOrderForShipment(context: TenantContext, orderId: string): Promise<Order>;
  recordShipmentStatus(context: TenantContext, orderId: string, status: ShipmentStatus): Promise<void>;
}

export class ShipmentsService {
  constructor(private readonly repository: ShipmentRepository, private readonly orders: ShipmentOrderReader) {}

  async upsert(context: TenantContext, command: UpsertShipmentCommand, now = new Date()): Promise<Shipment> {
    const order = await this.orders.findOrderForShipment(context, command.orderId);
    assertSameTenant(context, order);
    if (order.status === "cancelled") throw new DomainValidationError("A cancelled order cannot be shipped.");
    const existing = await this.repository.findByOrder(context, command.orderId);
    if (existing) {
      assertSameTenant(context, existing);
      this.applyUpdate(existing, command, now);
      await this.repository.save(context, existing);
      await this.orders.recordShipmentStatus(context, command.orderId, existing.status);
      return existing;
    }
    const status = command.status ?? "pending";
    if (!command.mode) throw new DomainValidationError("Shipment mode is required for a new shipment.");
    const shipment: Omit<Shipment, "id"> = {
      organizationId: context.organizationId,
      orderId: command.orderId,
      mode: command.mode,
      status,
      recipientAddress: command.recipientAddress,
      carrierName: command.carrierName,
      trackingCode: command.trackingCode,
      chargedAmountMinor: command.chargedAmountMinor ?? 0,
      businessCostMinor: command.businessCostMinor,
      currency: command.currency ?? order.currency,
      expectedAt: command.expectedAt,
      notes: command.notes,
      dispatchedAt: status === "dispatched" ? now.toISOString() : undefined,
      deliveredAt: status === "delivered" ? now.toISOString() : undefined
    };
    this.validateMoney(shipment);
    const created = await this.repository.create(context, shipment);
    await this.orders.recordShipmentStatus(context, command.orderId, status);
    return created;
  }

  async overdue(context: TenantContext, now = new Date()): Promise<Shipment[]> {
    const shipments = await this.repository.listOverdue(context, now.toISOString());
    shipments.forEach((shipment) => assertSameTenant(context, shipment));
    return shipments.filter((shipment) => ["pending", "preparing", "ready_for_pickup", "dispatched"].includes(shipment.status));
  }

  private applyUpdate(shipment: Shipment, command: UpsertShipmentCommand, now: Date): void {
    if (command.mode) shipment.mode = command.mode;
    if (command.status) {
      this.assertTransition(shipment.status, command.status);
      shipment.status = command.status;
      if (command.status === "dispatched") shipment.dispatchedAt = now.toISOString();
      if (command.status === "delivered") shipment.deliveredAt = now.toISOString();
    }
    if (command.recipientAddress !== undefined) shipment.recipientAddress = command.recipientAddress;
    if (command.carrierName !== undefined) shipment.carrierName = command.carrierName;
    if (command.trackingCode !== undefined) shipment.trackingCode = command.trackingCode;
    if (command.chargedAmountMinor !== undefined) shipment.chargedAmountMinor = command.chargedAmountMinor;
    if (command.businessCostMinor !== undefined) shipment.businessCostMinor = command.businessCostMinor;
    if (command.expectedAt !== undefined) shipment.expectedAt = command.expectedAt;
    if (command.notes !== undefined) shipment.notes = command.notes;
    this.validateMoney(shipment);
  }

  private assertTransition(current: ShipmentStatus, target: ShipmentStatus): void {
    const transitions: Record<ShipmentStatus, ShipmentStatus[]> = {
      not_required: [],
      pending: ["preparing", "ready_for_pickup", "dispatched", "not_required"],
      preparing: ["ready_for_pickup", "dispatched", "returned"],
      ready_for_pickup: ["dispatched", "delivered", "returned"],
      dispatched: ["delivered", "returned"],
      delivered: ["returned"],
      returned: []
    };
    if (current !== target && !transitions[current].includes(target)) throw new DomainValidationError("Invalid shipment status transition.");
  }

  private validateMoney(shipment: Pick<Shipment, "chargedAmountMinor" | "businessCostMinor">): void {
    requireMinorMoney(shipment.chargedAmountMinor, "chargedAmountMinor");
    if (shipment.businessCostMinor !== undefined) requireMinorMoney(shipment.businessCostMinor, "businessCostMinor");
  }
}
