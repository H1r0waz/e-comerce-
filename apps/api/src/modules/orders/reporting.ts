import type { InventoryLevel } from "../inventory/index.js";
import type { Shipment } from "../shipments/index.js";
import type { Order } from "./index.js";

/** Framework-neutral inputs for the dashboard; adapters decide how to query them. */
export interface DashboardAttention {
  type: "pending_payment" | "reservation_expiring" | "low_stock" | "expiring_lot" | "overdue_shipment";
  count: number;
}

export interface DashboardReport {
  salesCollectedMinor: number;
  pendingPaymentOrders: number;
  ordersToPrepare: number;
  attention: DashboardAttention[];
}

export function buildDashboardReport(input: {
  orders: Order[];
  lowStock: InventoryLevel[];
  expiringLotCount: number;
  overdueShipments: Shipment[];
  now?: Date;
}): DashboardReport {
  const now = input.now ?? new Date();
  const pendingPaymentOrders = input.orders.filter((order) => order.status === "pending_payment").length;
  const reservationsExpiring = input.orders.filter((order) =>
    order.status === "pending_payment" && order.reservationExpiresAt !== undefined && Date.parse(order.reservationExpiresAt) <= now.getTime() + 60 * 60 * 1000
  ).length;
  return {
    salesCollectedMinor: input.orders.reduce((total, order) => total + order.paidAmountMinor, 0),
    pendingPaymentOrders,
    ordersToPrepare: input.orders.filter((order) => order.status === "confirmed" || order.status === "preparing").length,
    attention: ([
      { type: "pending_payment", count: pendingPaymentOrders },
      { type: "reservation_expiring", count: reservationsExpiring },
      { type: "low_stock", count: input.lowStock.length },
      { type: "expiring_lot", count: input.expiringLotCount },
      { type: "overdue_shipment", count: input.overdueShipments.length }
    ] satisfies DashboardAttention[])
      .filter((item) => item.count > 0)
  };
}
