import assert from "node:assert/strict";
import test from "node:test";
import {
  OrderStatus,
  OrganizationRole,
  PaymentStatus,
  ReservationStatus,
  ShipmentStatus,
  StockMovementType
} from "../../packages/contracts/src/index.ts";

/**
 * Executable business-policy specification. When the domain services are
 * implemented, move these transition tables into the services and keep these
 * tests as black-box API/service tests instead of duplicating the rules here.
 */
const orderTransitions: Record<string, readonly string[]> = {
  [OrderStatus.DRAFT]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  [OrderStatus.READY_TO_SHIP]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: []
};

const shipmentTransitions: Record<string, readonly string[]> = {
  [ShipmentStatus.NOT_REQUIRED]: [],
  [ShipmentStatus.PENDING]: [ShipmentStatus.PREPARING, ShipmentStatus.READY_FOR_PICKUP],
  [ShipmentStatus.PREPARING]: [ShipmentStatus.READY_FOR_PICKUP, ShipmentStatus.DISPATCHED],
  [ShipmentStatus.READY_FOR_PICKUP]: [ShipmentStatus.DISPATCHED],
  [ShipmentStatus.DISPATCHED]: [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED],
  [ShipmentStatus.DELIVERED]: [],
  [ShipmentStatus.RETURNED]: []
};

function canTransition(transitions: Record<string, readonly string[]>, from: string, to: string): boolean {
  return transitions[from]?.includes(to) ?? false;
}

function canConfirmPayment(current: string, cumulativePaid: number, total: number): boolean {
  return current === PaymentStatus.PENDING && cumulativePaid >= total && total > 0;
}

test("the role model does not grant stock or payment operations to a viewer", () => {
  const permissions: Record<string, readonly string[]> = {
    [OrganizationRole.OWNER]: ["inventory.adjust", "payment.confirm", "order.transition", "user.invite"],
    [OrganizationRole.SALES]: ["order.create", "order.transition", "payment.register"],
    [OrganizationRole.INVENTORY_FULFILLMENT]: ["inventory.receive", "inventory.adjust", "shipment.update"],
    [OrganizationRole.VIEWER]: ["dashboard.read"]
  };

  assert.equal(permissions[OrganizationRole.VIEWER].includes("inventory.adjust"), false);
  assert.equal(permissions[OrganizationRole.VIEWER].includes("payment.confirm"), false);
  assert.equal(permissions[OrganizationRole.OWNER].includes("user.invite"), true);
});

test("order and shipment transitions are forward-only except cancellation/return", () => {
  assert.equal(canTransition(orderTransitions, OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED), true);
  assert.equal(canTransition(orderTransitions, OrderStatus.PENDING_PAYMENT, OrderStatus.COMPLETED), false);
  assert.equal(canTransition(orderTransitions, OrderStatus.COMPLETED, OrderStatus.PREPARING), false);
  assert.equal(canTransition(orderTransitions, OrderStatus.CONFIRMED, OrderStatus.CANCELLED), true);

  assert.equal(canTransition(shipmentTransitions, ShipmentStatus.DISPATCHED, ShipmentStatus.DELIVERED), true);
  assert.equal(canTransition(shipmentTransitions, ShipmentStatus.DELIVERED, ShipmentStatus.DISPATCHED), false);
});

test("a payment confirmation requires a pending payment that covers the full order", () => {
  assert.equal(canConfirmPayment(PaymentStatus.PENDING, 5_000, 5_000), true);
  assert.equal(canConfirmPayment(PaymentStatus.PENDING, 4_999, 5_000), false);
  assert.equal(canConfirmPayment(PaymentStatus.REJECTED, 5_000, 5_000), false);
});

test("reservation and inventory events preserve the intended lifecycle vocabulary", () => {
  assert.deepEqual(
    [ReservationStatus.ACTIVE, ReservationStatus.RELEASED, ReservationStatus.EXPIRED, ReservationStatus.CONSUMED],
    ["ACTIVE", "RELEASED", "EXPIRED", "CONSUMED"]
  );
  assert.equal(StockMovementType.RESERVATION_CREATED, "RESERVATION_CREATED");
  assert.equal(StockMovementType.RESERVATION_RELEASED, "RESERVATION_RELEASED");
  assert.equal(StockMovementType.SALE_COMMITTED, "SALE_COMMITTED");
});
