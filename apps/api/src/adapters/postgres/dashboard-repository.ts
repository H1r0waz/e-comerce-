import type { PostgresPool } from "./types.js";
import type { DashboardRepository as RouteDashboardRepository, DashboardSnapshotResponse } from "../../routes/types.js";

export type DashboardAttentionType = "pending_payment" | "reservation_expiring" | "low_stock" | "expiring_lot" | "overdue_shipment";

export interface DashboardAttention {
  type: DashboardAttentionType;
  count: number;
}

export interface DashboardRecentOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  channel: string;
  totalMinor: number;
  createdAt: string;
}

export interface DashboardSnapshot {
  organizationId: string;
  generatedAt: string;
  metrics: {
    salesCollectedTodayMinor: number;
    pendingPaymentOrderCount: number;
    ordersToPrepareCount: number;
    lowStockVariantCount: number;
    grossProfitEstimateTodayMinor: number;
  };
  attention: DashboardAttention[];
  recentOrders: DashboardRecentOrder[];
}

interface MetricRow extends Record<string, unknown> {
  sales_collected_today_minor: string | number;
  pending_payment_order_count: string | number;
  orders_to_prepare_count: string | number;
  low_stock_variant_count: string | number;
  gross_profit_estimate_today_minor: string | number;
  reservation_expiring_count: string | number;
  expiring_lot_count: string | number;
  overdue_shipment_count: string | number;
}

interface RecentOrderRow extends Record<string, unknown> {
  id: string;
  order_number: string;
  customer_name: string;
  status: string;
  channel: string;
  total_minor: string | number;
  created_at: Date | string;
}

/** Read-only dashboard queries, each explicitly bounded by organization_id. */
export class PostgresDashboardRepository implements RouteDashboardRepository {
  constructor(private readonly pool: PostgresPool) {}

  async getSnapshot(organizationId: string, now = new Date()): Promise<DashboardSnapshot> {
    assertOrganizationId(organizationId);
    const [metricsResult, ordersResult] = await Promise.all([
      this.pool.query<MetricRow>(METRICS_QUERY, [organizationId, now]),
      this.pool.query<RecentOrderRow>(RECENT_ORDERS_QUERY, [organizationId])
    ]);
    const metrics = metricsResult.rows[0] ?? emptyMetrics();
    const pendingPayments = numberValue(metrics.pending_payment_order_count);
    const reservationExpiring = numberValue(metrics.reservation_expiring_count);
    const lowStock = numberValue(metrics.low_stock_variant_count);
    const expiringLot = numberValue(metrics.expiring_lot_count);
    const overdueShipment = numberValue(metrics.overdue_shipment_count);

    return {
      organizationId,
      generatedAt: now.toISOString(),
      metrics: {
        salesCollectedTodayMinor: numberValue(metrics.sales_collected_today_minor),
        pendingPaymentOrderCount: pendingPayments,
        ordersToPrepareCount: numberValue(metrics.orders_to_prepare_count),
        lowStockVariantCount: lowStock,
        grossProfitEstimateTodayMinor: numberValue(metrics.gross_profit_estimate_today_minor)
      },
      attention: ([
        { type: "pending_payment", count: pendingPayments },
        { type: "reservation_expiring", count: reservationExpiring },
        { type: "low_stock", count: lowStock },
        { type: "expiring_lot", count: expiringLot },
        { type: "overdue_shipment", count: overdueShipment }
      ] satisfies DashboardAttention[]).filter((item) => item.count > 0),
      recentOrders: ordersResult.rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_name,
        status: row.status,
        channel: row.channel,
        totalMinor: numberValue(row.total_minor),
        createdAt: asIsoDate(row.created_at)
      }))
    };
  }

  async getDashboard(input: { organizationId: string; actorUserId: string; now: Date }): Promise<DashboardSnapshotResponse> {
    // Authorization is resolved by the route's session/membership guard. This
    // repository still scopes every aggregate query to the verified tenant.
    void input.actorUserId;
    return mapSnapshotToRouteResponse(await this.getSnapshot(input.organizationId, input.now));
  }
}

const METRICS_QUERY = `
  WITH organization_clock AS (
    SELECT ((($2::timestamptz AT TIME ZONE o.time_zone)::date)::timestamp AT TIME ZONE o.time_zone) AS local_day_start
    FROM organizations o
    WHERE o.id = $1
  )
  SELECT
    COALESCE((
      SELECT SUM(p.amount_minor)
      FROM payments p, organization_clock c
      WHERE p.organization_id = $1
        AND p.status = 'CONFIRMED'
        AND p.confirmed_at >= c.local_day_start
        AND p.confirmed_at <= $2
    ), 0) AS sales_collected_today_minor,
    (SELECT COUNT(*) FROM orders o WHERE o.organization_id = $1 AND o.status = 'PENDING_PAYMENT') AS pending_payment_order_count,
    (SELECT COUNT(*) FROM orders o WHERE o.organization_id = $1 AND o.status IN ('CONFIRMED', 'PREPARING')) AS orders_to_prepare_count,
    (SELECT COUNT(*) FROM inventory_levels i WHERE i.organization_id = $1 AND i.low_stock_threshold IS NOT NULL AND i.available_quantity <= i.low_stock_threshold) AS low_stock_variant_count,
    COALESCE((
      SELECT SUM(ol.line_total_minor - COALESCE(ol.allocated_cost_minor, 0))
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id AND o.organization_id = ol.organization_id
      JOIN organization_clock c ON true
      WHERE ol.organization_id = $1
        AND o.status <> 'CANCELLED'
        AND o.created_at >= c.local_day_start
        AND o.created_at <= $2
    ), 0) AS gross_profit_estimate_today_minor,
    (SELECT COUNT(*) FROM orders o WHERE o.organization_id = $1 AND o.reservation_status = 'ACTIVE' AND o.reservation_expires_at > $2 AND o.reservation_expires_at <= $2 + interval '1 hour') AS reservation_expiring_count,
    (SELECT COUNT(*) FROM inventory_lots l WHERE l.organization_id = $1 AND l.available_quantity > 0 AND l.expires_at >= $2 AND l.expires_at <= $2 + interval '30 days') AS expiring_lot_count,
    (SELECT COUNT(*) FROM shipments s WHERE s.organization_id = $1 AND s.expected_at < $2 AND s.status IN ('PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'DISPATCHED')) AS overdue_shipment_count
`;

const RECENT_ORDERS_QUERY = `
  SELECT
    o.id,
    o.order_number,
    concat_ws(' ', c.first_name, c.last_name) AS customer_name,
    o.status,
    o.channel,
    o.total_minor,
    o.created_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
  WHERE o.organization_id = $1
  ORDER BY o.created_at DESC
  LIMIT 8
`;

function emptyMetrics(): MetricRow {
  return {
    sales_collected_today_minor: 0,
    pending_payment_order_count: 0,
    orders_to_prepare_count: 0,
    low_stock_variant_count: 0,
    gross_profit_estimate_today_minor: 0,
    reservation_expiring_count: 0,
    expiring_lot_count: 0,
    overdue_shipment_count: 0
  };
}

function assertOrganizationId(organizationId: string): void {
  if (!organizationId.trim()) throw new Error("A non-empty organizationId is required for dashboard queries.");
}

function numberValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Unexpected numeric value returned by PostgreSQL.");
  return parsed;
}

function asIsoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Maps stable database KPIs to the presentation contract consumed by the web app. */
export function mapSnapshotToRouteResponse(snapshot: DashboardSnapshot): DashboardSnapshotResponse {
  const attention = new Map(snapshot.attention.map((item) => [item.type, item.count]));
  return {
    generatedAt: snapshot.generatedAt,
    metrics: {
      revenue: {
        label: "Ventas cobradas hoy",
        value: formatArs(snapshot.metrics.salesCollectedTodayMinor),
        detail: "Cobrado hoy"
      },
      ordersToPrepare: {
        label: "Pedidos a preparar",
        value: String(snapshot.metrics.ordersToPrepareCount),
        detail: "Confirmados o en preparación"
      },
      lowStock: {
        label: "Stock bajo",
        value: String(snapshot.metrics.lowStockVariantCount),
        detail: "Variantes que requieren reposición"
      },
      pendingPayments: {
        label: "Pagos pendientes",
        value: String(snapshot.metrics.pendingPaymentOrderCount),
        detail: "Pedidos por confirmar"
      }
    },
    alerts: [
      alert("payments", "payment", attention.get("pending_payment") ?? 0, "pedido", "espera confirmación de pago"),
      alert("reservations", "reservation", attention.get("reservation_expiring") ?? 0, "reserva", "vence en menos de una hora"),
      alert("stock", "stock", attention.get("low_stock") ?? 0, "variante", "está bajo el mínimo"),
      alert("expiration", "expiration", attention.get("expiring_lot") ?? 0, "lote", "vence dentro de los próximos 30 días")
    ].filter((item): item is NonNullable<typeof item> => item !== null),
    orders: snapshot.recentOrders.map((order) => ({
      id: `#${order.orderNumber}`,
      customer: order.customerName,
      items: "Detalle disponible en el pedido",
      amount: formatArs(order.totalMinor),
      channel: channelLabel(order.channel),
      state: orderStateLabel(order.status),
      tone: orderTone(order.status),
      initials: initials(order.customerName)
    })),
    channelSales: {
      total: formatArs(snapshot.metrics.salesCollectedTodayMinor),
      trend: "—",
      values: [],
      distribution: []
    }
  };
}

function alert(
  id: string,
  kind: "payment" | "reservation" | "stock" | "expiration",
  count: number,
  noun: string,
  description: string
): DashboardSnapshotResponse["alerts"][number] | null {
  if (count === 0) return null;
  const plural = count === 1 ? noun : `${noun}s`;
  return { id, kind, title: `${count} ${plural} ${count === 1 ? description : description.replace("espera", "esperan").replace("vence", "vencen").replace("está", "están")}`, detail: "Revisalo para continuar la operación." };
}

function formatArs(minor: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(minor / 100);
}

function channelLabel(channel: string): string {
  return ({ WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", ONLINE_STORE: "Tienda online", MARKETPLACE: "Marketplace", OTHER: "Otro" } as Record<string, string>)[channel] ?? channel;
}

function orderStateLabel(status: string): string {
  return ({ PENDING_PAYMENT: "Pago pendiente", CONFIRMED: "Confirmado", PREPARING: "A preparar", READY_TO_SHIP: "Listo para despachar", COMPLETED: "Completado", CANCELLED: "Cancelado", DRAFT: "Borrador" } as Record<string, string>)[status] ?? status;
}

function orderTone(status: string): "violet" | "amber" | "blue" | "green" {
  if (status === "PENDING_PAYMENT") return "amber";
  if (status === "READY_TO_SHIP") return "blue";
  if (status === "COMPLETED") return "green";
  return "violet";
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
