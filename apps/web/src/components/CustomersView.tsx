"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomerListItem } from "../lib/api/types";
import { useCommerceSession } from "./SessionGate";

export function CustomersView() {
  const { api } = useCommerceSession();
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api.listCustomers()
      .then((items) => { if (active) setCustomers(items); })
      .catch(() => { if (active) setError("No pudimos cargar los clientes. Probá recargar la página."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const visible = useMemo(() => customers.filter((customer) =>
    `${customer.name} ${customer.phone} ${customer.email ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  ), [customers, query]);

  return <section className="module-page">
    <header className="module-heading"><div><span className="eyebrow">RELACIÓN CON CLIENTES</span><h2>Clientes</h2><p>Consultá sus datos y el historial de ventas cobradas de tu comercio.</p></div></header>
    <div className="module-toolbar"><label className="search-input">Buscar cliente<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, teléfono o correo" /></label><button className="secondary-button" onClick={() => setQuery("")}>Limpiar filtro</button></div>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    <article className="panel customers-panel"><div className="customers-head"><span>CLIENTE</span><span>CONTACTO</span><span>COMPRAS</span><span>TOTAL COMPRADO</span><span>ÚLTIMA COMPRA</span></div>
      {visible.map((customer) => <div className="customers-row" key={customer.id}><span><strong>{customer.name}</strong><small>{customer.customerType === "WHOLESALE" ? "Mayorista" : "Minorista"}</small></span><span><strong>{customer.phone}</strong><small>{customer.email ?? "Sin correo"}</small></span><b>{customer.orderCount} {customer.orderCount === 1 ? "pedido" : "pedidos"}</b><strong>{formatMoney(customer.totalSpentMinor)}</strong><span>{customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : "Sin compras cobradas"}</span></div>)}
      {loading && <p className="empty-state">Cargando clientes…</p>}
      {!loading && visible.length === 0 && <p className="empty-state">Todavía no hay clientes que coincidan con la búsqueda. Se crean automáticamente al registrar un pedido.</p>}
    </article>
  </section>;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
