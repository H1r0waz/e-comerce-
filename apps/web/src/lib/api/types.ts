export type UserRole = "OWNER" | "SALES" | "INVENTORY_FULFILLMENT" | "VIEWER" | "SUPER_ADMIN";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
}

export interface CommerceSession {
  user: SessionUser;
  expiresAt?: string;
}

export type AuthenticationResult =
  | { status: "authenticated"; session: CommerceSession }
  | { status: "session_ready" }
  | { status: "invitation_accepted" };

export type OrderTone = "violet" | "amber" | "blue" | "green";

export interface RecentOrder {
  id: string;
  customer: string;
  items: string;
  amount: string;
  channel: "WhatsApp" | "Instagram" | string;
  state: string;
  tone: OrderTone;
  initials: string;
}

export interface DashboardMetric {
  label: string;
  value: string;
  detail: string;
  trend?: string;
}

export interface DashboardAlert {
  id: string;
  kind: "payment" | "reservation" | "stock" | "expiration";
  title: string;
  detail: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  metrics: {
    revenue: DashboardMetric;
    ordersToPrepare: DashboardMetric;
    lowStock: DashboardMetric;
    pendingPayments: DashboardMetric;
  };
  alerts: DashboardAlert[];
  orders: RecentOrder[];
  channelSales: {
    total: string;
    trend: string;
    values: number[];
    distribution: { label: string; value: string; color: "purple" | "pink" }[];
  };
}

export interface CatalogProduct {
  id: string;
  variantId: string;
  name: string;
  variantName: string;
  categoryName: string;
  sku: string;
  retailPriceMinor: number;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold?: number;
}

export interface CreateProductInput {
  name: string;
  categoryName: string;
  variantName?: string;
  sku?: string;
  retailPriceMinor: number;
  lowStockThreshold?: number;
  initialQuantity?: number;
  unitCostMinor?: number;
  lotCode?: string;
  expiresAt?: string;
}

export interface ReceiveStockInput {
  variantId: string;
  quantity: number;
  unitCostMinor: number;
  lotCode?: string;
  expiresAt?: string;
}

export type OrderChannel = "WHATSAPP" | "INSTAGRAM" | "ONLINE_STORE" | "MARKETPLACE" | "OTHER";
export type PaymentMethod = "BANK_TRANSFER" | "MERCADO_PAGO" | "CASH_ON_DELIVERY" | "CARD" | "OTHER";
export type FulfillmentStatus = "PREPARING" | "READY_TO_SHIP" | "COMPLETED";

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  channel: OrderChannel;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "PREPARING" | "READY_TO_SHIP" | "COMPLETED" | "CANCELLED" | "DRAFT";
  totalMinor: number;
  reservationExpiresAt?: string;
  lineCount: number;
  createdAt: string;
}

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  channel: OrderChannel;
  lines: Array<{ variantId: string; quantity: number }>;
  shippingChargeMinor?: number;
}

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  customerType: "RETAIL" | "WHOLESALE";
  orderCount: number;
  totalSpentMinor: number;
  lastPurchaseAt?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AcceptInvitationInput {
  invitationToken: string;
  displayName: string;
  password: string;
}

export interface CommerceApi {
  getSession(): Promise<CommerceSession | null>;
  signIn(input: SignInInput): Promise<AuthenticationResult>;
  acceptInvitation(input: AcceptInvitationInput): Promise<AuthenticationResult>;
  signOut(): Promise<void>;
  getDashboard(): Promise<DashboardSnapshot>;
  listProducts(): Promise<CatalogProduct[]>;
  createProduct(input: CreateProductInput): Promise<CatalogProduct>;
  receiveStock(input: ReceiveStockInput): Promise<CatalogProduct>;
  listOrders(): Promise<OrderListItem[]>;
  listCustomers(): Promise<CustomerListItem[]>;
  createOrder(input: CreateOrderInput): Promise<OrderListItem>;
  confirmPayment(input: { orderId: string; method: PaymentMethod }): Promise<OrderListItem>;
  transitionFulfillment(input: { orderId: string; status: FulfillmentStatus }): Promise<OrderListItem>;
}
