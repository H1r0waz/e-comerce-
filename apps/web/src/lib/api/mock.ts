import type { AcceptInvitationInput, AuthenticationResult, CatalogProduct, CommerceApi, CommerceSession, CreateProductInput, DashboardSnapshot, ReceiveStockInput, SignInInput } from "./types";

const dashboard: DashboardSnapshot = {
  generatedAt: "2026-10-13T12:00:00.000Z",
  metrics: {
    revenue: { label: "Ventas cobradas hoy", value: "$ 184.250", detail: "vs. $ 163.720 ayer", trend: "↗ 12,5%" },
    ordersToPrepare: { label: "Pedidos a preparar", value: "8", detail: "3 listos para despachar" },
    lowStock: { label: "Stock bajo", value: "12", detail: "productos necesitan reposición" },
    pendingPayments: { label: "Pagos pendientes", value: "$ 76.500", detail: "en 5 pedidos por confirmar" },
  },
  alerts: [
    { id: "payments", kind: "payment", title: "3 pedidos esperan confirmación de pago", detail: "Revisalos para seguir preparando." },
    { id: "reservations", kind: "reservation", title: "2 reservas vencen en menos de 2 horas", detail: "Se liberará el stock automáticamente." },
    { id: "stock", kind: "stock", title: "4 productos están bajo el mínimo", detail: "Creá una lista de reposición." },
    { id: "expiration", kind: "expiration", title: "1 lote vence en los próximos 20 días", detail: "Protector Solar FPS 50 · 6 unidades." },
  ],
  orders: [
    { id: "#1048", customer: "Sofía Martínez", items: "Sérum + protector solar", amount: "$ 45.800", channel: "WhatsApp", state: "A preparar", tone: "violet", initials: "SM" },
    { id: "#1047", customer: "Camila Ruiz", items: "Kit reparación capilar", amount: "$ 28.500", channel: "Instagram", state: "Pago pendiente", tone: "amber", initials: "CR" },
    { id: "#1046", customer: "Valentina Torres", items: "Perfume Floral 50 ml", amount: "$ 36.900", channel: "WhatsApp", state: "Despachado", tone: "blue", initials: "VT" },
    { id: "#1045", customer: "Micaela Luna", items: "Base fluida tono 03", amount: "$ 18.750", channel: "Instagram", state: "Entregado", tone: "green", initials: "ML" },
  ],
  channelSales: {
    total: "$ 1.248.600",
    trend: "↗ 18,2%",
    values: [38, 54, 45, 72, 58, 86, 64],
    distribution: [{ label: "WhatsApp", value: "68%", color: "purple" }, { label: "Instagram", value: "32%", color: "pink" }],
  },
};

/**
 * Demo-only adapter. It never stores a password, token, or session in browser
 * storage. Production must select the HTTP adapter by defining NEXT_PUBLIC_API_URL.
 */
export class MockCommerceApi implements CommerceApi {
  private session: CommerceSession | null = null;
  private products: CatalogProduct[] = [];

  async getSession(): Promise<CommerceSession | null> {
    return this.session;
  }

  async signIn(input: SignInInput): Promise<AuthenticationResult> {
    if (!input.email.trim() || !input.password) throw new Error("Ingresá tu correo y contraseña.");
    this.session = this.createSession(input.email, "Agustina M.");
    return { status: "authenticated", session: this.session };
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<AuthenticationResult> {
    if (!input.invitationToken.trim() || !input.displayName.trim() || input.password.length < 12) {
      throw new Error("Completá los datos y elegí una contraseña de al menos 12 caracteres.");
    }
    this.session = this.createSession("nuevo.usuario@bruma.demo", input.displayName);
    return { status: "authenticated", session: this.session };
  }

  async signOut(): Promise<void> {
    this.session = null;
  }

  async getDashboard(): Promise<DashboardSnapshot> {
    return dashboard;
  }

  async listProducts(): Promise<CatalogProduct[]> {
    return this.products;
  }

  async createProduct(input: CreateProductInput): Promise<CatalogProduct> {
    const product: CatalogProduct = {
      id: `demo-${Date.now()}`, variantId: `demo-variant-${Date.now()}`, name: input.name,
      variantName: input.variantName || "Única", categoryName: input.categoryName, sku: input.sku || "SIN-SKU",
      retailPriceMinor: input.retailPriceMinor, onHandQuantity: input.initialQuantity || 0,
      reservedQuantity: 0, availableQuantity: input.initialQuantity || 0, lowStockThreshold: input.lowStockThreshold
    };
    this.products = [product, ...this.products];
    return product;
  }

  async receiveStock(input: ReceiveStockInput): Promise<CatalogProduct> {
    const product = this.products.find((item) => item.variantId === input.variantId);
    if (!product) throw new Error("No encontramos el producto.");
    product.onHandQuantity += input.quantity;
    product.availableQuantity += input.quantity;
    return product;
  }

  private createSession(email: string, displayName: string): CommerceSession {
    return {
      user: { id: "demo-user", email, displayName, role: "OWNER", organizationId: "demo-bruma", organizationName: "La Maison" },
      expiresAt: "2026-10-13T20:00:00.000Z",
    };
  }
}
