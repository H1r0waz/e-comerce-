"use client";

import { FormEvent, useMemo, useState } from "react";

type OrderStatus = "Pendiente de pago" | "Confirmado" | "Preparando" | "Despachado";
type Order = { id: number; customer: string; channel: string; total: string; status: OrderStatus; };

const initialOrders: Order[] = [
  { id: 1048, customer: "Sofía Martínez", channel: "WhatsApp", total: "$ 45.800", status: "Preparando" },
  { id: 1047, customer: "Camila Ruiz", channel: "Instagram", total: "$ 28.500", status: "Pendiente de pago" },
  { id: 1046, customer: "Valentina Torres", channel: "WhatsApp", total: "$ 36.900", status: "Despachado" },
];

const nextStatus: Record<OrderStatus, OrderStatus> = {
  "Pendiente de pago": "Confirmado",
  Confirmado: "Preparando",
  Preparando: "Despachado",
  Despachado: "Despachado",
};

export function OrdersView() {
  const [orders, setOrders] = useState(initialOrders);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"Todos" | OrderStatus>("Todos");

  const visibleOrders = useMemo(() => filter === "Todos" ? orders : orders.filter((order) => order.status === filter), [filter, orders]);
  const advanceOrder = (id: number) => setOrders((current) => current.map((order) => order.id === id ? { ...order, status: nextStatus[order.status] } : order));
  const addOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const customer = String(values.get("customer") || "").trim();
    const total = String(values.get("total") || "").trim();
    const channel = String(values.get("channel") || "WhatsApp");
    if (!customer || !total) return;
    setOrders((current) => [{ id: Math.max(...current.map((item) => item.id), 1048) + 1, customer, total: `$ ${total}`, channel, status: "Pendiente de pago" }, ...current]);
    setShowForm(false);
  };

  return (
    <section className="module-page">
      <header className="module-heading"><div><span className="eyebrow">OPERACIÓN</span><h2>Pedidos</h2><p>Registrá las ventas que llegan desde WhatsApp e Instagram.</p></div><button className="new-order" onClick={() => setShowForm(true)}>+ Nuevo pedido</button></header>
      <div className="order-stats">{(["Todos", "Pendiente de pago", "Confirmado", "Preparando", "Despachado"] as const).map((status) => <button className={filter === status ? "active" : ""} key={status} onClick={() => setFilter(status)}><strong>{status === "Todos" ? orders.length : orders.filter((order) => order.status === status).length}</strong>{status}</button>)}</div>
      <article className="panel orders-worklist">{visibleOrders.map((order) => <div className="worklist-row" key={order.id}><div><span className="channel-pill">{order.channel}</span><h3>Pedido #{order.id} · {order.customer}</h3><p>Reserva de stock activa · Total {order.total}</p></div><span className={`status ${order.status === "Pendiente de pago" ? "amber" : order.status === "Despachado" ? "blue" : "violet"}`}>{order.status}</span><button className="secondary-button" disabled={order.status === "Despachado"} onClick={() => advanceOrder(order.id)}>{order.status === "Despachado" ? "Despachado" : "Avanzar estado"}</button></div>)}{visibleOrders.length === 0 && <p className="empty-state">No hay pedidos con este estado.</p>}</article>
      {showForm && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={addOrder}><button type="button" className="close-button" onClick={() => setShowForm(false)} aria-label="Cerrar">×</button><span className="eyebrow">NUEVO PEDIDO</span><h3>Registrar venta digital</h3><label>Cliente<input name="customer" required autoFocus placeholder="Nombre del cliente" /></label><label>Canal<select name="channel"><option>WhatsApp</option><option>Instagram</option></select></label><label>Total<input name="total" required inputMode="numeric" placeholder="35000" /></label><p>El pedido quedará pendiente de pago y podrá reservar stock al agregar sus productos.</p><button className="new-order" type="submit">Crear pedido</button></form></div>}
    </section>
  );
}
