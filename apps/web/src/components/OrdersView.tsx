"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api/client";
import type {
  CatalogProduct,
  CreateOrderInput,
  OrderListItem,
} from "../lib/api/types";
import { useCommerceSession } from "./SessionGate";

type Filter = "Todos" | OrderListItem["status"];
type DraftLine = { variantId: string; quantity: number };

const filters: Array<{ value: Filter; label: string }> = [
  { value: "Todos", label: "Todos" },
  { value: "PENDING_PAYMENT", label: "Pago pendiente" },
  { value: "CONFIRMED", label: "Confirmados" },
  { value: "PREPARING", label: "Preparando" },
  { value: "READY_TO_SHIP", label: "Listos para enviar" },
];

export function OrdersView() {
  const { api } = useCommerceSession();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [filter, setFilter] = useState<Filter>("Todos");
  const [showForm, setShowForm] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([api.listOrders(), api.listProducts()])
      .then(([storedOrders, catalog]) => {
        if (active) {
          setOrders(storedOrders);
          setProducts(catalog);
        }
      })
      .catch(() => {
        if (active)
          setError("No pudimos cargar los pedidos. Probá recargar la página.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const visibleOrders = useMemo(
    () =>
      filter === "Todos"
        ? orders
        : orders.filter((order) => order.status === filter),
    [filter, orders],
  );
  const total = lines.reduce(
    (sum, line) =>
      sum +
      (products.find((product) => product.variantId === line.variantId)
        ?.retailPriceMinor ?? 0) *
        line.quantity,
    0,
  );
  const addLine = () => {
    const firstAvailable = products.find(
      (product) => product.availableQuantity > 0,
    );
    if (!firstAvailable) {
      setError(
        "Primero ingresá stock a un producto para poder crear un pedido.",
      );
      return;
    }
    setLines((current) => [
      ...current,
      { variantId: firstAvailable.variantId, quantity: 1 },
    ]);
  };
  const close = () => {
    if (!saving) {
      setShowForm(false);
      setLines([]);
      setError("");
    }
  };
  const open = () => {
    setError("");
    setNotice("");
    setShowForm(true);
    if (!lines.length) addLine();
  };
  const updateLine = (index: number, change: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...change } : line,
      ),
    );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const customerName = value(values, "customerName");
    const customerPhone = value(values, "customerPhone");
    if (
      !customerName ||
      !customerPhone ||
      lines.length === 0 ||
      lines.some(
        (line) =>
          !line.variantId ||
          !Number.isInteger(line.quantity) ||
          line.quantity < 1,
      )
    ) {
      setError("Completá los datos del cliente y agregá al menos un producto.");
      return;
    }
    const input: CreateOrderInput = {
      customerName,
      customerPhone,
      customerEmail: value(values, "customerEmail") || undefined,
      channel: value(values, "channel") as CreateOrderInput["channel"],
      lines,
      shippingChargeMinor: moneyToMinor(value(values, "shipping")) ?? 0,
    };
    setSaving(true);
    setError("");
    try {
      const order = await api.createOrder(input);
      setOrders((current) => [order, ...current]);
      setShowForm(false);
      setLines([]);
      setNotice(
        `Pedido #${order.orderNumber} creado y reservado hasta ${formatTime(order.reservationExpiresAt)}.`,
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : "No pudimos crear el pedido.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="module-page">
      <header className="module-heading">
        <div>
          <span className="eyebrow">OPERACIÓN</span>
          <h2>Pedidos</h2>
          <p>
            Registrá ventas de WhatsApp e Instagram y reservá stock
            automáticamente.
          </p>
        </div>
        <button className="new-order" onClick={open}>
          + Nuevo pedido
        </button>
      </header>
      {error && !showForm && (
        <p className="dashboard-error" role="alert">
          {error}
        </p>
      )}
      <div className="order-stats">
        {filters.map(({ value: status, label }) => (
          <button
            className={filter === status ? "active" : ""}
            key={status}
            onClick={() => setFilter(status)}
          >
            <strong>
              {status === "Todos"
                ? orders.length
                : orders.filter((order) => order.status === status).length}
            </strong>
            {label}
          </button>
        ))}
      </div>
      <article className="panel orders-worklist">
        {visibleOrders.map((order) => (
          <div className="worklist-row" key={order.id}>
            <div>
              <span className="channel-pill">
                {channelLabel(order.channel)}
              </span>
              <h3>
                Pedido #{order.orderNumber} · {order.customerName}
              </h3>
              <p>
                {order.lineCount}{" "}
                {order.lineCount === 1 ? "producto" : "productos"} ·{" "}
                {order.customerPhone} · Total {formatMoney(order.totalMinor)}
              </p>
            </div>
            <span className={`status ${tone(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            <small className="reservation-copy">
              {order.status === "PENDING_PAYMENT"
                ? `Reserva hasta ${formatTime(order.reservationExpiresAt)}`
                : ""}
            </small>
          </div>
        ))}
        {loading && <p className="empty-state">Cargando pedidos…</p>}
        {!loading && visibleOrders.length === 0 && (
          <p className="empty-state">No hay pedidos con este estado.</p>
        )}
      </article>

      {showForm && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card wide-modal" onSubmit={submit}>
            <button
              type="button"
              className="close-button"
              onClick={close}
              aria-label="Cerrar"
            >
              ×
            </button>
            <span className="eyebrow">NUEVO PEDIDO</span>
            <h3>Registrar venta digital</h3>
            <div className="form-grid">
              <label>
                Nombre del cliente
                <input
                  name="customerName"
                  required
                  autoFocus
                  placeholder="Ej. Sofía Martínez"
                />
              </label>
              <label>
                WhatsApp o teléfono
                <input
                  name="customerPhone"
                  required
                  inputMode="tel"
                  placeholder="Ej. +54 9 11…"
                />
              </label>
              <label>
                Correo <small>opcional</small>
                <input
                  name="customerEmail"
                  type="email"
                  placeholder="cliente@email.com"
                />
              </label>
              <label>
                Canal
                <select name="channel" defaultValue="WHATSAPP">
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="ONLINE_STORE">Tienda online</option>
                  <option value="MARKETPLACE">Marketplace</option>
                  <option value="OTHER">Otro</option>
                </select>
              </label>
            </div>
            <div className="form-divider">
              <span>Productos</span>
              <small>
                El stock se reserva por el tiempo configurado en tu comercio.
              </small>
            </div>
            <div className="order-lines">
              {lines.map((line, index) => (
                <div className="order-line" key={`${line.variantId}-${index}`}>
                  <select
                    value={line.variantId}
                    onChange={(event) =>
                      updateLine(index, { variantId: event.target.value })
                    }
                  >
                    {products
                      .filter(
                        (product) =>
                          product.availableQuantity > 0 ||
                          product.variantId === line.variantId,
                      )
                      .map((product) => (
                        <option
                          value={product.variantId}
                          key={product.variantId}
                        >
                          {product.name} · {product.variantName} ·{" "}
                          {product.availableQuantity} disponibles
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(index, {
                        quantity: Number(event.target.value),
                      })
                    }
                    aria-label="Cantidad"
                  />
                  <strong>
                    {formatMoney(
                      (products.find(
                        (product) => product.variantId === line.variantId,
                      )?.retailPriceMinor ?? 0) * line.quantity,
                    )}
                  </strong>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={addLine}
            >
              + Agregar producto
            </button>
            <label className="shipping-charge">
              Costo de envío <small>opcional, lo paga el cliente</small>
              <input name="shipping" inputMode="decimal" placeholder="0" />
            </label>
            <div className="order-total">
          <span>Subtotal de productos</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="new-order"
              type="submit"
              disabled={saving || !products.length}
            >
              {saving ? "Creando pedido…" : "Crear pedido y reservar stock"}
            </button>
            {!products.length && (
              <p className="empty-state">
                No hay productos con stock para vender.
              </p>
            )}
          </form>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}

function value(values: FormData, key: string): string {
  return String(values.get(key) ?? "").trim();
}
function moneyToMinor(raw: string): number | null {
  if (!raw) return 0;
  const amount = Number(raw.replace(",", "."));
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
}
function formatMoney(minor: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
function formatTime(value?: string): string {
  return value
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "";
}
function channelLabel(channel: OrderListItem["channel"]): string {
  return {
    WHATSAPP: "WhatsApp",
    INSTAGRAM: "Instagram",
    ONLINE_STORE: "Tienda online",
    MARKETPLACE: "Marketplace",
    OTHER: "Otro",
  }[channel];
}
function statusLabel(status: OrderListItem["status"]): string {
  return {
    PENDING_PAYMENT: "Pago pendiente",
    CONFIRMED: "Confirmado",
    PREPARING: "Preparando",
    READY_TO_SHIP: "Listo para enviar",
    COMPLETED: "Completado",
    CANCELLED: "Cancelado",
    DRAFT: "Borrador",
  }[status];
}
function tone(status: OrderListItem["status"]): string {
  return status === "PENDING_PAYMENT"
    ? "amber"
    : status === "COMPLETED"
      ? "green"
      : status === "CANCELLED"
        ? "blue"
        : "violet";
}
