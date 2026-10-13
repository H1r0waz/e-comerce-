"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrdersView } from "../components/OrdersView";
import { ProductsView } from "../components/ProductsView";
import { SessionGate, useCommerceSession } from "../components/SessionGate";
import type { DashboardAlert, DashboardSnapshot } from "../lib/api/types";

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

function MiniBar({ height, accent = false }: { height: number; accent?: boolean }) {
  return <span className={`mini-bar ${accent ? "accent" : ""}`} style={{ height: `${height}%` }} />;
}

function MetricCard({
  tone, icon, metric, onClick, decoration,
}: {
  tone: "peach" | "lilac" | "sky";
  icon: IconName;
  metric: DashboardSnapshot["metrics"]["ordersToPrepare"] | undefined;
  onClick: () => void;
  decoration: "orders" | "stock" | "payments";
}) {
  return <article className="kpi-card"><div className={`kpi-icon ${tone}`}><Icon name={icon} size={20} /></div><div className="kpi-label">{metric?.label ?? "Actualizando"}<button onClick={onClick} aria-label={`Ver ${metric?.label ?? "detalle"}`}><Icon name="arrow" size={16} /></button></div><strong>{metric?.value ?? "—"}</strong><small>{metric?.detail ?? "Sin datos aún"}</small>{decoration === "orders" && <div className="order-dots"><i/><i/><i/><i/><i/><i/><i/><i/></div>}{decoration === "stock" && <div className="stock-line"><span/><span/><span className="warning"/><span className="warning"/></div>}{decoration === "payments" && <div className="payment-progress"><span/></div>}</article>;
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const presentation = {
    payment: { tone: "amber", icon: "bag" as const },
    reservation: { tone: "coral", icon: "layers" as const },
    stock: { tone: "peach", icon: "box" as const },
    expiration: { tone: "lilac", icon: "sparkles" as const },
  }[alert.kind];
  return <button className="alert-row"><span className={`alert-icon ${presentation.tone}`}><Icon name={presentation.icon} size={18} /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><Icon name="arrow" size={17} /></button>;
}

export default function Home() {
  return <SessionGate><Dashboard /></SessionGate>;
}

function Dashboard() {
  const { api, session, signOut, usingMockApi } = useCommerceSession();
  const [active, setActive] = useState("Inicio");
  const [toast, setToast] = useState("");
  const [range, setRange] = useState("7 días");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 2500);
  }, []);
  const refreshDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    setDashboardError(false);
    try {
      setSnapshot(await api.getDashboard());
    } catch {
      setDashboardError(true);
    } finally {
      setLoadingDashboard(false);
    }
  }, [api]);
  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);
  const userFirstName = session.user.displayName.split(" ")[0] || "";
  const initials = session.user.displayName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">b</span><span>bruma</span></div>
        <div className="business-switcher"><span className="business-icon">{session.user.organizationName[0]}</span><span><strong>{session.user.organizationName}</strong><small>Comercio de belleza</small></span><Icon name="chevron" size={16} /></div>
        <nav aria-label="Navegación principal">
          {navItems.map((item) => <button key={item.label} className={`nav-link ${active === item.label ? "active" : ""}`} onClick={() => setActive(item.label)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.label === "Pedidos" && <b>5</b>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button className="nav-link" onClick={() => setActive("Configuración")}><Icon name="settings" size={19} /><span>Configuración</span></button><div className="profile"><span className="avatar owner">{initials}</span><span><strong>{session.user.displayName}</strong><small>{session.user.role === "OWNER" ? "Propietaria" : session.user.role}</small></span><button className="profile-menu" onClick={() => { void signOut().catch(() => showToast("No pudimos cerrar la sesión. Probá nuevamente.")); }} aria-label="Cerrar sesión"><Icon name="dots" size={18} /></button></div></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
          <div className="welcome"><p>Martes, 13 de octubre</p><h1>Buen día, {userFirstName} <span>✦</span></h1></div>
          <div className="top-actions"><button className="icon-button notification" aria-label="Notificaciones" onClick={() => showToast(`Tenés ${snapshot?.alerts.length ?? 0} alertas para revisar.`)}><Icon name="bell" /><i>{snapshot?.alerts.length ?? 0}</i></button><button className="new-order" onClick={() => setActive("Pedidos")}><Icon name="plus" size={18} />Nuevo pedido</button></div>
        </header>

        <div className="mobile-nav">{navItems.slice(0, 5).map((item) => <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => setActive(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}</div>

        {active === "Productos" ? <ProductsView /> : active === "Pedidos" ? <OrdersView /> : <>
        <div className="page-heading"><div><h2>Resumen de hoy</h2><p>Todo lo importante de tu negocio, en un solo lugar.</p></div><button className="date-filter" onClick={() => setRange(range === "7 días" ? "30 días" : "7 días")}>Últimos {range}<Icon name="chevron" size={16} /></button></div>
        {usingMockApi && <p className="integration-notice">Vista de demostración local: no persiste datos y solo se habilita durante el desarrollo.</p>}
        {dashboardError && <p className="dashboard-error" role="status">No pudimos actualizar el resumen. <button type="button" onClick={() => void refreshDashboard()}>Reintentar</button></p>}

        <section className="kpi-grid">
          <article className="kpi-card revenue"><div className="kpi-icon"><Icon name="chart" size={20} /></div><div className="kpi-label">{snapshot?.metrics.revenue.label ?? "Ventas cobradas hoy"} <span className="trend">{snapshot?.metrics.revenue.trend ?? "—"}</span></div><strong>{snapshot?.metrics.revenue.value ?? "—"}</strong><small>{snapshot?.metrics.revenue.detail ?? "Actualizando datos…"}</small><div className="sparkline"><svg viewBox="0 0 260 54" preserveAspectRatio="none"><path d="M0 45 C18 46 20 33 38 37 S58 21 73 31 S103 32 112 23 S133 33 149 18 S176 23 187 12 S217 23 229 8 S244 10 260 1" /></svg></div></article>
          <MetricCard tone="peach" icon="bag" metric={snapshot?.metrics.ordersToPrepare} onClick={() => showToast("Filtrando pedidos a preparar.")} decoration="orders" />
          <MetricCard tone="lilac" icon="layers" metric={snapshot?.metrics.lowStock} onClick={() => showToast("Mostrando productos con stock bajo.")} decoration="stock" />
          <MetricCard tone="sky" icon="package" metric={snapshot?.metrics.pendingPayments} onClick={() => showToast("Filtrando pagos pendientes.")} decoration="payments" />
        </section>

        <section className="dashboard-grid">
          <article className="panel attention-panel"><div className="panel-head"><div><span className="eyebrow">PARA REVISAR</span><h3>Atención requerida <em>{snapshot?.alerts.length ?? 0}</em></h3></div><button className="text-link" onClick={() => showToast("Todas las alertas están disponibles.")}>Ver todas <Icon name="arrow" size={15} /></button></div><div className="alerts">{snapshot?.alerts.map((alert) => <AlertRow alert={alert} key={alert.id} />)}{!snapshot && <p className="empty-state">{loadingDashboard ? "Actualizando alertas…" : "No hay alertas para mostrar."}</p>}</div></article>

          <article className="panel channels-panel"><div className="panel-head"><div><span className="eyebrow">ÚLTIMOS 7 DÍAS</span><h3>Ventas por canal</h3></div><button className="more" aria-label="Más opciones"><Icon name="dots" size={19} /></button></div><div className="channel-total"><strong>{snapshot?.channelSales.total ?? "—"}</strong><span className="trend">{snapshot?.channelSales.trend ?? "—"}</span></div><div className="bar-chart" aria-label="Gráfico de ventas por día"><div className="bar-set">{(snapshot?.channelSales.values ?? [0, 0, 0, 0, 0, 0, 0]).map((value, index) => <MiniBar key={index} height={value} accent={index === 3 || index === 5}/>)}</div><div className="days"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div></div><div className="channel-legend">{snapshot?.channelSales.distribution.map((channel) => <span key={channel.label}><i className={`dot ${channel.color}`}/>{channel.label} <b>{channel.value}</b></span>)}</div></article>
        </section>

        <section className="lower-grid">
          <article className="panel orders-panel"><div className="panel-head"><div><span className="eyebrow">OPERACIÓN</span><h3>Pedidos recientes</h3></div><button className="text-link" onClick={() => setActive("Pedidos")}>Ver pedidos <Icon name="arrow" size={15} /></button></div><div className="orders-table"><div className="table-head"><span>CLIENTE</span><span>CANAL</span><span>ESTADO</span><span>TOTAL</span><span/></div>{snapshot?.orders.map((order) => <div className="order-row" key={order.id}><div className="customer"><span className="avatar small">{order.initials}</span><span><strong>{order.customer}</strong><small>{order.id} · {order.items}</small></span></div><span className="channel-pill">{order.channel}</span><span className={`status ${order.tone}`}>{order.state}</span><strong className="amount">{order.amount}</strong><button className="row-more" aria-label={`Opciones de ${order.id}`}><Icon name="dots" size={18}/></button></div>)}{!snapshot && <p className="empty-state">{loadingDashboard ? "Cargando pedidos…" : "No hay pedidos recientes."}</p>}</div></article>
          <aside className="quick-column"><article className="panel quick-panel"><div className="panel-head"><div><span className="eyebrow">ACCESOS RÁPIDOS</span><h3>¿Qué querés hacer?</h3></div></div><div className="quick-actions"><button onClick={() => setActive("Pedidos")}><span className="quick-icon lavender"><Icon name="plus" size={19}/></span><span><strong>Nuevo pedido</strong><small>Creá una venta manual</small></span><Icon name="arrow" size={16}/></button><button onClick={() => setActive("Productos")}><span className="quick-icon peach"><Icon name="box" size={19}/></span><span><strong>Agregar producto</strong><small>Sumalo a tu catálogo</small></span><Icon name="arrow" size={16}/></button><button onClick={() => showToast("El ingreso de stock será el próximo flujo.")}><span className="quick-icon mint"><Icon name="truck" size={19}/></span><span><strong>Ingresar stock</strong><small>Registrá una recepción</small></span><Icon name="arrow" size={16}/></button></div></article><article className="tip-card"><span>✦</span><div><strong>Tip de Bruma</strong><p>El sábado fue tu mejor día de ventas esta semana.</p><button onClick={() => showToast("Abrimos el reporte semanal.")}>Ver reporte semanal</button></div></article></aside>
        </section>
        </>}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
