import type { ModuleDefinition } from "../shared.js";
import type { CatalogReader } from "../catalog/index.js";
import { assertSameTenant, DomainValidationError, requireMinorMoney, requirePositiveInteger, type TenantContext } from "../catalog/tenant.js";
import type { InventoryReservationPort } from "../inventory/index.js";

export const ordersModule: ModuleDefinition = {
  name: "orders",
  routePrefix: "/v1/orders",
  description: "Digital-channel orders with independent fulfillment, payment, and shipping axes."
};

export type OrderStatus = "draft" | "pending_payment" | "confirmed" | "preparing" | "ready_to_ship" | "completed" | "cancelled";
export type PaymentAxis = "pending" | "partial" | "paid" | "rejected" | "refunded";
export type ShipmentAxis = "not_required" | "pending" | "preparing" | "ready_for_pickup" | "dispatched" | "delivered" | "returned";

export interface OrderLine {
  id: string;
  productVariantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  reservationId?: string;
}

export interface Order {
  id: string;
  organizationId: string;
  orderNumber: string;
  customerId: string;
  channel: "whatsapp" | "instagram" | "online_store" | "marketplace" | "other";
  status: OrderStatus;
  paymentStatus: PaymentAxis;
  shipmentStatus: ShipmentAxis;
  currency: string;
  lines: OrderLine[];
  subtotalMinor: number;
  orderDiscountMinor: number;
  shippingChargeMinor: number;
  totalMinor: number;
  paidAmountMinor: number;
  outstandingAmountMinor: number;
  reservationExpiresAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
}

export interface CreateOrderLineCommand {
  productVariantId: string;
  quantity: number;
  unitPriceOverrideMinor?: number;
  discountMinor?: number;
}

export interface CreateOrderCommand {
  customerId: string;
  channel: Order["channel"];
  lines: CreateOrderLineCommand[];
  shippingChargeMinor?: number;
  currency?: string;
  reservationDurationMinutes: number;
  shipmentRequired?: boolean;
}

export interface OrderRepository {
  nextOrderNumber(context: TenantContext): Promise<string>;
  create(context: TenantContext, order: Omit<Order, "id">): Promise<Order>;
  find(context: TenantContext, orderId: string): Promise<Order | null>;
  save(context: TenantContext, order: Order): Promise<void>;
  listForReport(context: TenantContext, range: { from: string; to: string }): Promise<Order[]>;
}

/** Port implemented by OrdersService and used by manual payment confirmation. */
export interface OrderPaymentPort {
  getForPayment(context: TenantContext, orderId: string): Promise<Order>;
  recordConfirmedPayment(context: TenantContext, orderId: string, amountMinor: number): Promise<Order>;
  recordRejectedPayment(context: TenantContext, orderId: string): Promise<Order>;
}

/** Port consumed by the shipment module; the order remains the aggregate owner. */
export interface OrderShipmentPort {
  findOrderForShipment(context: TenantContext, orderId: string): Promise<Order>;
  recordShipmentStatus(context: TenantContext, orderId: string, status: ShipmentAxis): Promise<void>;
}

export class OrdersService implements OrderPaymentPort, OrderShipmentPort {
  constructor(
    private readonly repository: OrderRepository,
    private readonly catalogue: CatalogReader,
    private readonly inventory: InventoryReservationPort
  ) {}

  async createPendingPayment(context: TenantContext, command: CreateOrderCommand, now = new Date()): Promise<Order> {
    if (!command.customerId.trim() || command.lines.length === 0) throw new DomainValidationError("An order needs a customer and at least one line.");
    requirePositiveInteger(command.reservationDurationMinutes, "reservationDurationMinutes");
    const shippingChargeMinor = command.shippingChargeMinor ?? 0;
    requireMinorMoney(shippingChargeMinor, "shippingChargeMinor");
    const expiresAt = new Date(now.getTime() + command.reservationDurationMinutes * 60_000).toISOString();
    const currency = command.currency ?? "ARS";
    const lines: OrderLine[] = [];
    let subtotalMinor = 0;
    for (const line of command.lines) {
      requirePositiveInteger(line.quantity, "line.quantity");
      const variant = await this.catalogue.getActiveVariant(context, line.productVariantId);
      assertSameTenant(context, variant);
      const price = line.unitPriceOverrideMinor ?? variant.retailPriceMinor;
      const discount = line.discountMinor ?? 0;
      requireMinorMoney(price, "line.unitPriceOverrideMinor");
      requireMinorMoney(discount, "line.discountMinor");
      const gross = price * line.quantity;
      if (discount > gross) throw new DomainValidationError("Line discount cannot exceed line value.");
      subtotalMinor += gross - discount;
      lines.push({
        id: crypto.randomUUID(),
        productVariantId: variant.id,
        productNameSnapshot: variant.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
        quantity: line.quantity,
        unitPriceMinor: price,
        discountMinor: discount,
        lineTotalMinor: gross - discount
      });
    }
    const orderNumber = await this.repository.nextOrderNumber(context);
    const totalMinor = subtotalMinor + shippingChargeMinor;
    const draft = await this.repository.create(context, {
      organizationId: context.organizationId,
      orderNumber,
      customerId: command.customerId,
      channel: command.channel,
      status: "pending_payment",
      paymentStatus: "pending",
      shipmentStatus: command.shipmentRequired === false ? "not_required" : "pending",
      currency,
      lines,
      subtotalMinor,
      orderDiscountMinor: 0,
      shippingChargeMinor,
      totalMinor,
      paidAmountMinor: 0,
      outstandingAmountMinor: totalMinor,
      reservationExpiresAt: expiresAt,
      createdAt: now.toISOString()
    });
    assertSameTenant(context, draft);
    try {
      for (const line of draft.lines) {
        const reservation = await this.inventory.reserve(context, {
          orderId: draft.id,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          expiresAt
        });
        line.reservationId = reservation.id;
      }
      await this.repository.save(context, draft);
      return draft;
    } catch (error) {
      await Promise.all(draft.lines.filter((line) => line.reservationId).map((line) => this.inventory.release(context, line.reservationId!, "manual")));
      throw error;
    }
  }

  async getForPayment(context: TenantContext, orderId: string): Promise<Order> {
    return this.getRequired(context, orderId);
  }

  async findOrderForShipment(context: TenantContext, orderId: string): Promise<Order> {
    return this.getRequired(context, orderId);
  }

  async recordShipmentStatus(context: TenantContext, orderId: string, status: ShipmentAxis): Promise<void> {
    const order = await this.getRequired(context, orderId);
    if (order.status === "cancelled") throw new DomainValidationError("A cancelled order cannot update shipment status.");
    order.shipmentStatus = status;
    await this.repository.save(context, order);
  }

  async recordConfirmedPayment(context: TenantContext, orderId: string, amountMinor: number): Promise<Order> {
    requireMinorMoney(amountMinor, "amountMinor");
    const order = await this.getRequired(context, orderId);
    if (order.status === "cancelled") throw new DomainValidationError("A cancelled order cannot receive payments.");
    const nextPaid = order.paidAmountMinor + amountMinor;
    if (nextPaid > order.totalMinor) throw new DomainValidationError("Confirmed payments cannot exceed the order total.");
    order.paidAmountMinor = nextPaid;
    order.outstandingAmountMinor = order.totalMinor - nextPaid;
    order.paymentStatus = order.outstandingAmountMinor === 0 ? "paid" : "partial";
    if (order.paymentStatus === "paid" && order.status === "pending_payment") {
      order.status = "confirmed";
      await Promise.all(order.lines.filter((line) => line.reservationId).map((line) => this.inventory.consume(context, line.reservationId!)));
    }
    await this.repository.save(context, order);
    return order;
  }

  async recordRejectedPayment(context: TenantContext, orderId: string): Promise<Order> {
    const order = await this.getRequired(context, orderId);
    if (order.paidAmountMinor !== 0) throw new DomainValidationError("A partially paid order cannot be marked rejected.");
    order.paymentStatus = "rejected";
    await this.repository.save(context, order);
    return order;
  }

  async transitionFulfillment(context: TenantContext, orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.getRequired(context, orderId);
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      draft: ["pending_payment", "cancelled"],
      pending_payment: ["confirmed", "cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["ready_to_ship", "completed", "cancelled"],
      ready_to_ship: ["completed", "cancelled"],
      completed: [],
      cancelled: []
    };
    if (!transitions[order.status].includes(status)) throw new DomainValidationError("Invalid order status transition.");
    if (status === "confirmed" && order.paymentStatus !== "paid") throw new DomainValidationError("Only fully paid orders can be confirmed.");
    order.status = status;
    if (status === "cancelled") {
      order.cancelledAt = new Date().toISOString();
      await Promise.all(order.lines.filter((line) => line.reservationId).map((line) => this.inventory.release(context, line.reservationId!, "cancelled")));
    }
    await this.repository.save(context, order);
    return order;
  }

  async salesSummary(context: TenantContext, range: { from: string; to: string }): Promise<{ orderCount: number; collectedMinor: number; pendingMinor: number }> {
    const orders = await this.repository.listForReport(context, range);
    orders.forEach((order) => assertSameTenant(context, order));
    return orders.reduce(
      (summary, order) => ({
        orderCount: summary.orderCount + 1,
        collectedMinor: summary.collectedMinor + order.paidAmountMinor,
        pendingMinor: summary.pendingMinor + order.outstandingAmountMinor
      }),
      { orderCount: 0, collectedMinor: 0, pendingMinor: 0 }
    );
  }

  private async getRequired(context: TenantContext, orderId: string): Promise<Order> {
    const order = await this.repository.find(context, orderId);
    if (!order) throw new DomainValidationError("Order was not found.");
    assertSameTenant(context, order);
    return order;
  }
}
