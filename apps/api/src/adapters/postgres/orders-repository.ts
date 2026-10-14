import { withTransaction, type PostgresPool, type PostgresQueryClient } from "./types.js";
import type { FulfillmentStatus, OrderChannel, OrderListItemResponse, PaymentMethod } from "../../routes/types.js";

export interface CreatePendingPaymentOrderInput {
  organizationId: string;
  actorUserId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  channel: OrderChannel;
  lines: Array<{ variantId: string; quantity: number }>;
  shippingChargeMinor?: number;
}

interface IdRow extends Record<string, unknown> { id: string }
interface CustomerRow extends IdRow { first_name: string; last_name: string | null; phone: string }
interface VariantRow extends Record<string, unknown> {
  id: string; product_name: string; variant_name: string; sku: string; retail_price_minor: string | number;
  on_hand_quantity: string | number | null; reserved_quantity: string | number | null;
}
interface LotRow extends Record<string, unknown> { id: string; available_quantity: string | number; reserved_quantity: string | number; unit_cost_minor: string | number }
interface OrderRow extends Record<string, unknown> {
  id: string; order_number: string; customer_name: string; customer_phone: string; channel: OrderChannel;
  status: OrderListItemResponse["status"]; total_minor: string | number; reservation_expires_at: Date | string | null;
  line_count: string | number; created_at: Date | string;
}
interface PaymentOrderRow extends Record<string, unknown> { id: string; total_minor: string | number; paid_amount_minor: string | number; status: string; reservation_expires_at: Date | string | null }
interface ReservationRow extends Record<string, unknown> { id: string; product_variant_id: string; inventory_lot_id: string; quantity: string | number; unit_cost_minor: string | number }

/**
 * First production order flow. It locks each inventory level and its FIFO lots
 * inside one transaction, so two sales cannot reserve the same unit.
 */
export class PostgresOrdersRepository {
  constructor(private readonly pool: PostgresPool) {}

  async listOrders(organizationId: string): Promise<OrderListItemResponse[]> {
    const result = await this.pool.query<OrderRow>(ORDER_LIST_QUERY, [organizationId]);
    return result.rows.map(mapOrder);
  }

  async createPendingPaymentOrder(input: CreatePendingPaymentOrderInput): Promise<OrderListItemResponse> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.organizationId]);
      const customer = await this.findOrCreateCustomer(client, input);
      const reservationMinutes = await this.reservationDuration(client, input.organizationId);
      const reservationExpiresAt = new Date(Date.now() + reservationMinutes * 60_000);
      const normalizedLines = aggregateLines(input.lines);
      const preparedLines = [] as Array<{
        variant: VariantRow; quantity: number; lineTotalMinor: number; allocatedCostMinor: number;
        allocations: Array<{ lotId: string; quantity: number; unitCostMinor: number }>;
      }>;

      for (const line of normalizedLines) {
        const variant = await this.lockVariant(client, input.organizationId, line.variantId);
        const available = numberValue(variant.on_hand_quantity) - numberValue(variant.reserved_quantity);
        if (available < line.quantity) throw new OrderValidationError(`No hay stock disponible para ${variant.product_name}.`);
        const allocations = await this.reserveLots(client, input.organizationId, variant.id, line.quantity);
        preparedLines.push({
          variant, quantity: line.quantity,
          lineTotalMinor: numberValue(variant.retail_price_minor) * line.quantity,
          allocatedCostMinor: allocations.reduce((total, item) => total + item.quantity * item.unitCostMinor, 0),
          allocations
        });
      }

      const subtotalMinor = preparedLines.reduce((total, line) => total + line.lineTotalMinor, 0);
      const shippingChargeMinor = input.shippingChargeMinor ?? 0;
      const totalMinor = subtotalMinor + shippingChargeMinor;
      const orderNumber = await this.nextOrderNumber(client, input.organizationId);
      const order = await client.query<IdRow>(
        `INSERT INTO orders (
          organization_id, customer_id, order_number, channel, status, reservation_status, reservation_expires_at,
          subtotal_minor, shipping_charge_minor, total_minor, outstanding_amount_minor, created_by_user_id
        ) VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 'ACTIVE', $5, $6, $7, $8, $8, $9)
        RETURNING id`,
        [input.organizationId, customer.id, orderNumber, input.channel, reservationExpiresAt, subtotalMinor, shippingChargeMinor, totalMinor, input.actorUserId]
      );
      const orderId = order.rows[0]?.id;
      if (!orderId) throw new Error("Order creation did not return an id.");

      for (const line of preparedLines) {
        const insertedLine = await client.query<IdRow>(
          `INSERT INTO order_lines (
            organization_id, order_id, product_variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot,
            quantity, unit_price_minor, line_total_minor, allocated_cost_minor
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [input.organizationId, orderId, line.variant.id, line.variant.product_name, line.variant.variant_name, line.variant.sku,
            line.quantity, numberValue(line.variant.retail_price_minor), line.lineTotalMinor, line.allocatedCostMinor]
        );
        const orderLineId = insertedLine.rows[0]?.id;
        if (!orderLineId) throw new Error("Order line creation did not return an id.");
        for (const allocation of line.allocations) {
          await client.query(
            `INSERT INTO stock_reservations (organization_id, order_id, order_line_id, product_variant_id, inventory_lot_id, quantity, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [input.organizationId, orderId, orderLineId, line.variant.id, allocation.lotId, allocation.quantity, reservationExpiresAt]
          );
          await client.query(
            `INSERT INTO stock_movements (
              organization_id, product_variant_id, inventory_lot_id, movement_type, reserved_quantity_delta,
              unit_cost_minor, reference_type, reference_id, reason, created_by_user_id
            ) VALUES ($1, $2, $3, 'RESERVATION_CREATED', $4, $5, 'ORDER', $6, 'Reserva por pedido pendiente de pago', $7)`,
            [input.organizationId, line.variant.id, allocation.lotId, allocation.quantity, allocation.unitCostMinor, orderId, input.actorUserId]
          );
        }
        await client.query(
          `UPDATE inventory_levels SET reserved_quantity = reserved_quantity + $3
           WHERE organization_id = $1 AND product_variant_id = $2`,
          [input.organizationId, line.variant.id, line.quantity]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'order.created_pending_payment', 'order', $3, $4::jsonb)`,
        [input.organizationId, input.actorUserId, orderId, JSON.stringify({ orderNumber, customerId: customer.id, totalMinor, channel: input.channel })]
      );
      return this.findOrderWithClient(client, input.organizationId, orderId);
    });
  }

  async confirmPayment(input: { organizationId: string; actorUserId: string; orderId: string; method: PaymentMethod }): Promise<OrderListItemResponse> {
    return withTransaction(this.pool, async (client) => {
      const lockedOrder = await client.query<PaymentOrderRow>(
        `SELECT id, total_minor, paid_amount_minor, status, reservation_expires_at
         FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [input.orderId, input.organizationId]
      );
      const order = lockedOrder.rows[0];
      if (!order) throw new OrderValidationError("No encontramos ese pedido.");
      if (order.status !== "PENDING_PAYMENT") throw new OrderValidationError("Este pedido ya no está esperando la confirmación de pago.");
      if (order.reservation_expires_at && new Date(order.reservation_expires_at).getTime() <= Date.now()) {
        throw new OrderValidationError("La reserva de este pedido venció. Revisá el stock antes de confirmar el pago.");
      }
      const totalMinor = numberValue(order.total_minor);
      const paidAmountMinor = numberValue(order.paid_amount_minor);
      const remainingMinor = totalMinor - paidAmountMinor;
      if (remainingMinor <= 0) throw new OrderValidationError("El pedido ya está pagado.");

      const reservations = await client.query<ReservationRow>(
        `SELECT sr.id, sr.product_variant_id, sr.inventory_lot_id, sr.quantity, l.unit_cost_minor
         FROM stock_reservations sr
         JOIN inventory_lots l ON l.id = sr.inventory_lot_id AND l.organization_id = sr.organization_id
         WHERE sr.organization_id = $1 AND sr.order_id = $2 AND sr.status = 'ACTIVE'
         FOR UPDATE OF sr, l`, [input.organizationId, input.orderId]
      );
      if (!reservations.rows.length) throw new OrderValidationError("El pedido no tiene una reserva activa para confirmar.");

      for (const reservation of reservations.rows) {
        const quantity = numberValue(reservation.quantity);
        const unitCostMinor = numberValue(reservation.unit_cost_minor);
        await client.query(
          `UPDATE inventory_lots
           SET available_quantity = available_quantity - $3, reserved_quantity = reserved_quantity - $3
           WHERE organization_id = $1 AND id = $2`, [input.organizationId, reservation.inventory_lot_id, quantity]
        );
        await client.query(
          `UPDATE inventory_levels
           SET on_hand_quantity = on_hand_quantity - $3, reserved_quantity = reserved_quantity - $3
           WHERE organization_id = $1 AND product_variant_id = $2`, [input.organizationId, reservation.product_variant_id, quantity]
        );
        await client.query(`UPDATE stock_reservations SET status = 'CONSUMED' WHERE organization_id = $1 AND id = $2`, [input.organizationId, reservation.id]);
        await client.query(
          `INSERT INTO stock_movements (
            organization_id, product_variant_id, inventory_lot_id, movement_type, quantity_delta, reserved_quantity_delta,
            unit_cost_minor, reference_type, reference_id, reason, created_by_user_id
          ) VALUES ($1, $2, $3, 'SALE_COMMITTED', -$4, -$4, $5, 'ORDER', $6, 'Pago confirmado y stock descontado', $7)`,
          [input.organizationId, reservation.product_variant_id, reservation.inventory_lot_id, quantity, unitCostMinor, input.orderId, input.actorUserId]
        );
      }
      await client.query(
        `INSERT INTO payments (organization_id, order_id, method, status, amount_minor, paid_at, confirmed_at, confirmed_by_user_id)
         VALUES ($1, $2, $3, 'CONFIRMED', $4, now(), now(), $5)`,
        [input.organizationId, input.orderId, input.method, remainingMinor, input.actorUserId]
      );
      await client.query(
        `UPDATE orders
         SET status = 'CONFIRMED', reservation_status = 'CONSUMED', paid_amount_minor = paid_amount_minor + $3,
             outstanding_amount_minor = 0
         WHERE organization_id = $1 AND id = $2`, [input.organizationId, input.orderId, remainingMinor]
      );
      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'payment.confirmed', 'order', $3, $4::jsonb)`,
        [input.organizationId, input.actorUserId, input.orderId, JSON.stringify({ method: input.method, amountMinor: remainingMinor })]
      );
      return this.findOrderWithClient(client, input.organizationId, input.orderId);
    });
  }

  async transitionFulfillment(input: { organizationId: string; actorUserId: string; orderId: string; status: FulfillmentStatus }): Promise<OrderListItemResponse> {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [input.orderId, input.organizationId]
      );
      const order = locked.rows[0];
      if (!order) throw new OrderValidationError("No encontramos ese pedido.");
      if (!isAllowedFulfillmentTransition(order.status, input.status)) {
        throw new OrderValidationError("Ese pedido no puede avanzar a ese estado todavía.");
      }
      await client.query(
        "UPDATE orders SET status = $3 WHERE organization_id = $1 AND id = $2",
        [input.organizationId, input.orderId, input.status]
      );
      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'order.fulfillment_transitioned', 'order', $3, $4::jsonb)`,
        [input.organizationId, input.actorUserId, input.orderId, JSON.stringify({ from: order.status, to: input.status })]
      );
      return this.findOrderWithClient(client, input.organizationId, input.orderId);
    });
  }

  private async findOrCreateCustomer(client: PostgresQueryClient, input: CreatePendingPaymentOrderInput): Promise<CustomerRow> {
    const existing = await client.query<CustomerRow>(
      `SELECT id, first_name, last_name, phone FROM customers WHERE organization_id = $1 AND phone = $2 ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [input.organizationId, input.customerPhone]
    );
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await client.query<CustomerRow>(
      `INSERT INTO customers (organization_id, first_name, phone, email, acquisition_channel)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, first_name, last_name, phone`,
      [input.organizationId, input.customerName, input.customerPhone, input.customerEmail ?? null, input.channel]
    );
    const customer = inserted.rows[0];
    if (!customer) throw new Error("Customer creation did not return an id.");
    return customer;
  }

  private async reservationDuration(client: PostgresQueryClient, organizationId: string): Promise<number> {
    const result = await client.query<{ minutes: string | number }>(
      `SELECT COALESCE(NULLIF(settings ->> 'defaultReservationDurationMinutes', '')::integer, 60) AS minutes
       FROM organizations WHERE id = $1`, [organizationId]
    );
    const minutes = numberValue(result.rows[0]?.minutes ?? 60);
    return minutes > 0 && minutes <= 24 * 60 ? minutes : 60;
  }

  private async lockVariant(client: PostgresQueryClient, organizationId: string, variantId: string): Promise<VariantRow> {
    const result = await client.query<VariantRow>(
      `SELECT v.id, p.name AS product_name, v.name AS variant_name, v.sku, v.retail_price_minor,
              l.on_hand_quantity, l.reserved_quantity
       FROM product_variants v
       JOIN products p ON p.id = v.product_id AND p.organization_id = v.organization_id AND p.status = 'ACTIVE'
       JOIN inventory_levels l ON l.product_variant_id = v.id AND l.organization_id = v.organization_id
       WHERE v.id = $1 AND v.organization_id = $2 AND v.active = true
       FOR UPDATE OF v, l`, [variantId, organizationId]
    );
    const variant = result.rows[0];
    if (!variant) throw new OrderValidationError("Uno de los productos ya no está disponible.");
    return variant;
  }

  private async reserveLots(client: PostgresQueryClient, organizationId: string, variantId: string, requested: number): Promise<Array<{ lotId: string; quantity: number; unitCostMinor: number }>> {
    const lots = await client.query<LotRow>(
      `SELECT id, available_quantity, reserved_quantity, unit_cost_minor
       FROM inventory_lots
       WHERE organization_id = $1 AND product_variant_id = $2 AND available_quantity > reserved_quantity
       ORDER BY received_at ASC, created_at ASC FOR UPDATE`, [organizationId, variantId]
    );
    let remaining = requested;
    const allocations: Array<{ lotId: string; quantity: number; unitCostMinor: number }> = [];
    for (const lot of lots.rows) {
      const quantity = Math.min(remaining, numberValue(lot.available_quantity) - numberValue(lot.reserved_quantity));
      if (quantity <= 0) continue;
      await client.query(`UPDATE inventory_lots SET reserved_quantity = reserved_quantity + $3 WHERE organization_id = $1 AND id = $2`, [organizationId, lot.id, quantity]);
      allocations.push({ lotId: lot.id, quantity, unitCostMinor: numberValue(lot.unit_cost_minor) });
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining > 0) throw new OrderValidationError("No hay suficiente stock para completar el pedido.");
    return allocations;
  }

  private async nextOrderNumber(client: PostgresQueryClient, organizationId: string): Promise<string> {
    const result = await client.query<{ next_number: string | number }>(
      `SELECT COUNT(*)::integer + 1 AS next_number FROM orders WHERE organization_id = $1`, [organizationId]
    );
    return String(numberValue(result.rows[0]?.next_number ?? 1)).padStart(6, "0");
  }

  private async findOrderWithClient(client: PostgresQueryClient, organizationId: string, orderId: string): Promise<OrderListItemResponse> {
    const result = await client.query<OrderRow>(ORDER_BY_ID_QUERY, [organizationId, orderId]);
    const order = result.rows[0];
    if (!order) throw new Error("Created order could not be read.");
    return mapOrder(order);
  }
}

export class OrderValidationError extends Error {}

const ORDER_LIST_QUERY = `
  SELECT o.id, o.order_number, concat_ws(' ', c.first_name, c.last_name) AS customer_name, c.phone AS customer_phone,
         o.channel, o.status, o.total_minor, o.reservation_expires_at, o.created_at, COUNT(ol.id)::integer AS line_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
  LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.organization_id = o.organization_id
  WHERE o.organization_id = $1
  GROUP BY o.id, c.id
  ORDER BY o.created_at DESC
`;

const ORDER_BY_ID_QUERY = `
  SELECT o.id, o.order_number, concat_ws(' ', c.first_name, c.last_name) AS customer_name, c.phone AS customer_phone,
         o.channel, o.status, o.total_minor, o.reservation_expires_at, o.created_at, COUNT(ol.id)::integer AS line_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
  LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.organization_id = o.organization_id
  WHERE o.organization_id = $1 AND o.id = $2
  GROUP BY o.id, c.id
`;

function aggregateLines(lines: CreatePendingPaymentOrderInput["lines"]): Array<{ variantId: string; quantity: number }> {
  const quantities = new Map<string, number>();
  for (const line of lines) quantities.set(line.variantId, (quantities.get(line.variantId) ?? 0) + line.quantity);
  return [...quantities].map(([variantId, quantity]) => ({ variantId, quantity }));
}

function mapOrder(row: OrderRow): OrderListItemResponse {
  return {
    id: row.id, orderNumber: row.order_number, customerName: row.customer_name, customerPhone: row.customer_phone,
    channel: row.channel, status: row.status, totalMinor: numberValue(row.total_minor), lineCount: numberValue(row.line_count),
    reservationExpiresAt: row.reservation_expires_at ? asIso(row.reservation_expires_at) : undefined, createdAt: asIso(row.created_at)
  };
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error("Unexpected numeric value returned by PostgreSQL.");
  return parsed;
}

function asIso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

function isAllowedFulfillmentTransition(current: string, next: FulfillmentStatus): boolean {
  return (current === "CONFIRMED" && next === "PREPARING")
    || (current === "PREPARING" && next === "READY_TO_SHIP")
    || (current === "READY_TO_SHIP" && next === "COMPLETED");
}
