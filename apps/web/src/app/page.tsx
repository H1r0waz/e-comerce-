"use client";

import { useState } from "react";
import { OrdersView } from "../components/OrdersView";
import { ProductsView } from "../components/ProductsView";

type IconName =
  | "grid"
  | "bag"
  | "box"
  | "layers"
  | "users"
  | "truck"
  | "sparkles"
  | "chart"
  | "settings"
  | "plus"
  | "bell"
  | "arrow"
  | "dots"
  | "search"
  | "chevron"
  | "package";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    bag: <><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>,
    box: <><path d="m21 8-9 5-9-5 9-5 9 5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    users: <><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20" /><circle cx="9.5" cy="7" r="3.5" /><path d="M17 3.5a3.5 3.5 0 0 1 0 6.8M21 20v-1.5a4.5 4.5 0 0 0-3-4.25" /></>,
    truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    sparkles: <><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3Z" /><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16Z" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.2 2.2-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V20.4h-3.12v-.1a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06-2.2-2.2.06-.06A1.7 1.7 0 0 0 6.8 15a1.7 1.7 0 0 0-1.56-1H5.1v-3.12h.14a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.34-1.87L6.4 7.95l2.2-2.2.06.06a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1-1.56V4.5h3.12v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.2 2.2-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1h.14V14h-.14a1.7 1.7 0 0 0-1.56 1Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    dots: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    package: <><path d="m21 8-9 5-9-5 9-5 9 5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9" /><path d="m7.5 5.5 9 5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const navItems: { label: string; icon: IconName }[] = [
  { label: "Inicio", icon: "grid" }, { label: "Pedidos", icon: "bag" }, { label: "Productos", icon: "box" },
  { label: "Inventario", icon: "layers" }, { label: "Clientes", icon: "users" }, { label: "Proveedores", icon: "truck" },
  { label: "Promociones", icon: "sparkles" }, { label: "Reportes", icon: "chart" },
];

const orders = [
  { id: "#1048", customer: "Sofía Martínez", items: "Sérum + protector solar", amount: "$ 45.800", channel: "WhatsApp", state: "A preparar", tone: "violet", initials: "SM" },
  { id: "#1047", customer: "Camila Ruiz", items: "Kit reparación capilar", amount: "$ 28.500", channel: "Instagram", state: "Pago pendiente", tone: "amber", initials: "CR" },
  { id: "#1046", customer: "Valentina Torres", items: "Perfume Floral 50 ml", amount: "$ 36.900", channel: "WhatsApp", state: "Despachado", tone: "blue", initials: "VT" },
  { id: "#1045", customer: "Micaela Luna", items: "Base fluida tono 03", amount: "$ 18.750", channel: "Instagram", state: "Entregado", tone: "green", initials: "ML" },
];

function MiniBar({ height, accent = false }: { height: number; accent?: boolean }) {
  return <span className={`mini-bar ${accent ? "accent" : ""}`} style={{ height: `${height}%` }} />;
}

export default function Home() {
  const [active, setActive] = useState("Inicio");
  const [toast, setToast] = useState("");
  const [range, setRange] = useState("7 días");
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">b</span><span>bruma</span></div>
        <div className="business-switcher"><span className="business-icon">L</span><span><strong>La Maison</strong><small>Comercio de belleza</small></span><Icon name="chevron" size={16} /></div>
        <nav aria-label="Navegación principal">
          {navItems.map((item) => <button key={item.label} className={`nav-link ${active === item.label ? "active" : ""}`} onClick={() => setActive(item.label)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.label === "Pedidos" && <b>5</b>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button className="nav-link" onClick={() => setActive("Configuración")}><Icon name="settings" size={19} /><span>Configuración</span></button><div className="profile"><span className="avatar owner">AM</span><span><strong>Agustina M.</strong><small>Administradora</small></span><Icon name="dots" size={18} /></div></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
          <div className="welcome"><p>Martes, 13 de octubre</p><h1>Buen día, Agustina <span>✦</span></h1></div>
          <div className="top-actions"><button className="icon-button notification" aria-label="Notificaciones" onClick={() => showToast("Tenés 4 alertas para revisar.")}><Icon name="bell" /><i>4</i></button><button className="new-order" onClick={() => setActive("Pedidos")}><Icon name="plus" size={18} />Nuevo pedido</button></div>
        </header>

        <div className="mobile-nav">{navItems.slice(0, 5).map((item) => <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => setActive(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}</div>

        {active === "Productos" ? <ProductsView /> : active === "Pedidos" ? <OrdersView /> : <>
        <div className="page-heading"><div><h2>Resumen de hoy</h2><p>Todo lo importante de tu negocio, en un solo lugar.</p></div><button className="date-filter" onClick={() => setRange(range === "7 días" ? "30 días" : "7 días")}>Últimos {range}<Icon name="chevron" size={16} /></button></div>

        <section className="kpi-grid">
          <article className="kpi-card revenue"><div className="kpi-icon"><Icon name="chart" size={20} /></div><div className="kpi-label">Ventas cobradas hoy <span className="trend">↗ 12,5%</span></div><strong>$ 184.250</strong><small>vs. $ 163.720 ayer</small><div className="sparkline"><svg viewBox="0 0 260 54" preserveAspectRatio="none"><path d="M0 45 C18 46 20 33 38 37 S58 21 73 31 S103 32 112 23 S133 33 149 18 S176 23 187 12 S217 23 229 8 S244 10 260 1" /></svg></div></article>
          <article className="kpi-card"><div className="kpi-icon peach"><Icon name="bag" size={20} /></div><div className="kpi-label">Pedidos a preparar <button onClick={() => showToast("Filtrando pedidos a preparar.")}><Icon name="arrow" size={16} /></button></div><strong>8</strong><small>3 listos para despachar</small><div className="order-dots"><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
          <article className="kpi-card"><div className="kpi-icon lilac"><Icon name="layers" size={20} /></div><div className="kpi-label">Stock bajo <button onClick={() => showToast("Mostrando productos con stock bajo.")}><Icon name="arrow" size={16} /></button></div><strong>12</strong><small>productos necesitan reposición</small><div className="stock-line"><span/><span/><span className="warning"/><span className="warning"/></div></article>
          <article className="kpi-card"><div className="kpi-icon sky"><Icon name="package" size={20} /></div><div className="kpi-label">Pagos pendientes <button onClick={() => showToast("Filtrando pagos pendientes.")}><Icon name="arrow" size={16} /></button></div><strong>$ 76.500</strong><small>en 5 pedidos por confirmar</small><div className="payment-progress"><span/></div></article>
        </section>

        <section className="dashboard-grid">
          <article className="panel attention-panel"><div className="panel-head"><div><span className="eyebrow">PARA REVISAR</span><h3>Atención requerida <em>4</em></h3></div><button className="text-link" onClick={() => showToast("Todas las alertas están disponibles.")}>Ver todas <Icon name="arrow" size={15} /></button></div><div className="alerts">
            <button className="alert-row"><span className="alert-icon amber"><Icon name="bag" size={18} /></span><span><strong>3 pedidos esperan confirmación de pago</strong><small>Revisalos para seguir preparando.</small></span><Icon name="arrow" size={17} /></button>
            <button className="alert-row"><span className="alert-icon coral"><Icon name="layers" size={18} /></span><span><strong>2 reservas vencen en menos de 2 horas</strong><small>Se liberará el stock automáticamente.</small></span><Icon name="arrow" size={17} /></button>
            <button className="alert-row"><span className="alert-icon peach"><Icon name="box" size={18} /></span><span><strong>4 productos están bajo el mínimo</strong><small>Creá una lista de reposición.</small></span><Icon name="arrow" size={17} /></button>
            <button className="alert-row"><span className="alert-icon lilac"><Icon name="sparkles" size={18} /></span><span><strong>1 lote vence en los próximos 20 días</strong><small>Protector Solar FPS 50 · 6 unidades.</small></span><Icon name="arrow" size={17} /></button>
          </div></article>

          <article className="panel channels-panel"><div className="panel-head"><div><span className="eyebrow">ÚLTIMOS 7 DÍAS</span><h3>Ventas por canal</h3></div><button className="more" aria-label="Más opciones"><Icon name="dots" size={19} /></button></div><div className="channel-total"><strong>$ 1.248.600</strong><span className="trend">↗ 18,2%</span></div><div className="bar-chart" aria-label="Gráfico de ventas por día"><div className="bar-set"><MiniBar height={38}/><MiniBar height={54}/><MiniBar height={45}/><MiniBar height={72} accent/><MiniBar height={58}/><MiniBar height={86} accent/><MiniBar height={64}/></div><div className="days"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div></div><div className="channel-legend"><span><i className="dot purple"/>WhatsApp <b>68%</b></span><span><i className="dot pink"/>Instagram <b>32%</b></span></div></article>
        </section>

        <section className="lower-grid">
          <article className="panel orders-panel"><div className="panel-head"><div><span className="eyebrow">OPERACIÓN</span><h3>Pedidos recientes</h3></div><button className="text-link" onClick={() => setActive("Pedidos")}>Ver pedidos <Icon name="arrow" size={15} /></button></div><div className="orders-table"><div className="table-head"><span>CLIENTE</span><span>CANAL</span><span>ESTADO</span><span>TOTAL</span><span/></div>{orders.map((order) => <div className="order-row" key={order.id}><div className="customer"><span className="avatar small">{order.initials}</span><span><strong>{order.customer}</strong><small>{order.id} · {order.items}</small></span></div><span className="channel-pill">{order.channel}</span><span className={`status ${order.tone}`}>{order.state}</span><strong className="amount">{order.amount}</strong><button className="row-more" aria-label={`Opciones de ${order.id}`}><Icon name="dots" size={18}/></button></div>)}</div></article>
          <aside className="quick-column"><article className="panel quick-panel"><div className="panel-head"><div><span className="eyebrow">ACCESOS RÁPIDOS</span><h3>¿Qué querés hacer?</h3></div></div><div className="quick-actions"><button onClick={() => setActive("Pedidos")}><span className="quick-icon lavender"><Icon name="plus" size={19}/></span><span><strong>Nuevo pedido</strong><small>Creá una venta manual</small></span><Icon name="arrow" size={16}/></button><button onClick={() => setActive("Productos")}><span className="quick-icon peach"><Icon name="box" size={19}/></span><span><strong>Agregar producto</strong><small>Sumalo a tu catálogo</small></span><Icon name="arrow" size={16}/></button><button onClick={() => showToast("El ingreso de stock será el próximo flujo.")}><span className="quick-icon mint"><Icon name="truck" size={19}/></span><span><strong>Ingresar stock</strong><small>Registrá una recepción</small></span><Icon name="arrow" size={16}/></button></div></article><article className="tip-card"><span>✦</span><div><strong>Tip de Bruma</strong><p>El sábado fue tu mejor día de ventas esta semana.</p><button onClick={() => showToast("Abrimos el reporte semanal.")}>Ver reporte semanal</button></div></article></aside>
        </section>
        </>}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
