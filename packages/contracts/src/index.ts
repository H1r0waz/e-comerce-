/**
 * Shared, transport-friendly contracts. All dates are ISO 8601 strings and
 * money is represented in minor units to avoid floating point rounding.
 */

export type Id = string;
export type ISODateString = string;
export type CurrencyCode = "ARS" | (string & {});
export type TimeZone = "America/Argentina/Buenos_Aires" | (string & {});
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Money {
  /** Integer amount in the currency's minor unit (for ARS, centavos). */
  amountMinor: number;
  currency: CurrencyCode;
}

export interface Address {
  recipientName?: string;
  phone?: string;
  line1: string;
  line2?: string;
  locality: string;
  province: string;
  postalCode?: string;
  countryCode: string;
  references?: string;
}

export interface AuditFields {
  createdAt: ISODateString;
  createdByUserId?: Id;
  updatedAt: ISODateString;
  updatedByUserId?: Id;
}

export interface TenantEntity extends AuditFields {
  id: Id;
  organizationId: Id;
}

export const OrganizationStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  ARCHIVED: "ARCHIVED"
} as const;
export type OrganizationStatus = (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

export interface OrganizationSettings {
  currency: CurrencyCode;
  timeZone: TimeZone;
  locale: string;
  /** Default duration used when a new unpaid reservation is made. */
  defaultReservationDurationMinutes: number;
  /** Hard limit that users can select for a manual reservation. */
  maximumReservationDurationMinutes: number;
  allowDispatchWithOutstandingBalance: boolean;
  inventoryCostMethod: "FIFO";
  expirationAlertDays: number;
  defaultLowStockThreshold?: number;
}

export interface Organization extends AuditFields {
  id: Id;
  name: string;
  legalName?: string;
  taxId?: string; // CUIT for the initial Argentina launch
  taxCondition?: string;
  status: OrganizationStatus;
  contactEmail?: string;
  contactPhone?: string;
  fiscalAddress?: Address;
  settings: OrganizationSettings;
}

export const PlatformRole = {
  SUPER_ADMIN: "SUPER_ADMIN"
} as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export const OrganizationRole = {
  OWNER: "OWNER",
  SALES: "SALES",
  INVENTORY_FULFILLMENT: "INVENTORY_FULFILLMENT",
  VIEWER: "VIEWER"
} as const;
export type OrganizationRole = (typeof OrganizationRole)[keyof typeof OrganizationRole];

export const UserStatus = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED"
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface User extends AuditFields {
  id: Id;
  email: string;
  displayName: string;
  status: UserStatus;
  platformRoles: PlatformRole[];
  twoFactorEnabled: boolean;
  lastLoginAt?: ISODateString;
}

export interface OrganizationMembership extends TenantEntity {
  userId: Id;
  role: OrganizationRole;
  active: boolean;
}

export const ProductStatus = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  DISCONTINUED: "DISCONTINUED"
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const AttributeDataType = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN",
  SELECT: "SELECT"
} as const;
export type AttributeDataType = (typeof AttributeDataType)[keyof typeof AttributeDataType];

export const AttributePurpose = {
  VARIANT: "VARIANT",
  INFORMATIONAL: "INFORMATIONAL"
} as const;
export type AttributePurpose = (typeof AttributePurpose)[keyof typeof AttributePurpose];

/** Category templates are editable by each organization. */
export interface CategoryAttributeDefinition {
  id: Id;
  key: string;
  label: string;
  dataType: AttributeDataType;
  purpose: AttributePurpose;
  required: boolean;
  suggestedValues: string[];
  position: number;
}

export interface ProductCategory extends TenantEntity {
  name: string;
  slug: string;
  parentCategoryId?: Id;
  description?: string;
  attributes: CategoryAttributeDefinition[];
  active: boolean;
}

export interface ProductMedia {
  id: Id;
  url: string;
  altText?: string;
  position: number;
}

export interface Product extends TenantEntity {
  name: string;
  slug: string;
  description?: string;
  brand?: string;
  categoryId: Id;
  status: ProductStatus;
  media: ProductMedia[];
  informationalAttributes: Record<string, JsonValue>;
  trackInventory: boolean;
  lotTrackingEnabled: boolean;
  expirationTrackingEnabled: boolean;
  defaultSupplierId?: Id;
}

export interface ProductVariant extends TenantEntity {
  productId: Id;
  name: string;
  sku: string;
  barcode?: string;
  /** Values for category attributes whose purpose is VARIANT. */
  attributes: Record<string, JsonValue>;
  retailPrice: Money;
  wholesalePrice?: Money;
  active: boolean;
  lowStockThreshold?: number;
  weightGrams?: number;
}

export const StockMovementType = {
  PURCHASE_RECEIPT: "PURCHASE_RECEIPT",
  RESERVATION_CREATED: "RESERVATION_CREATED",
  RESERVATION_RELEASED: "RESERVATION_RELEASED",
  SALE_COMMITTED: "SALE_COMMITTED",
  CUSTOMER_RETURN: "CUSTOMER_RETURN",
  EXPIRATION_WRITE_OFF: "EXPIRATION_WRITE_OFF",
  DAMAGE_OR_LOSS: "DAMAGE_OR_LOSS",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT"
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export interface InventoryLot extends TenantEntity {
  productVariantId: Id;
  supplierId?: Id;
  lotCode?: string;
  receivedAt: ISODateString;
  expiresAt?: ISODateString;
  unitCost: Money;
  initialQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  notes?: string;
}

/** Aggregate used by operation screens; lot/cost details remain in InventoryLot. */
export interface InventoryLevel extends TenantEntity {
  productVariantId: Id;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold?: number;
  updatedAt: ISODateString;
}

export interface StockMovement extends TenantEntity {
  productVariantId: Id;
  inventoryLotId?: Id;
  type: StockMovementType;
  /** Signed physical stock change. A reservation has zero physical quantity. */
  quantityDelta: number;
  /** Signed reservation change. */
  reservedQuantityDelta: number;
  unitCost?: Money;
  referenceType?: "ORDER" | "PURCHASE" | "RETURN" | "ADJUSTMENT";
  referenceId?: Id;
  reason?: string;
}

export const OrderChannel = {
  WHATSAPP: "WHATSAPP",
  INSTAGRAM: "INSTAGRAM",
  ONLINE_STORE: "ONLINE_STORE",
  MARKETPLACE: "MARKETPLACE",
  OTHER: "OTHER"
} as const;
export type OrderChannel = (typeof OrderChannel)[keyof typeof OrderChannel];

export const OrderStatus = {
  DRAFT: "DRAFT",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY_TO_SHIP: "READY_TO_SHIP",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ReservationStatus = {
  NONE: "NONE",
  ACTIVE: "ACTIVE",
  RELEASED: "RELEASED",
  EXPIRED: "EXPIRED",
  CONSUMED: "CONSUMED"
} as const;
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export interface OrderLine {
  id: Id;
  productVariantId: Id;
  /** Immutable snapshots keep historical orders meaningful after catalogue edits. */
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPrice: Money;
  discount: Money;
  lineTotal: Money;
}

export interface StockReservation extends TenantEntity {
  orderId: Id;
  productVariantId: Id;
  quantity: number;
  status: ReservationStatus;
  expiresAt?: ISODateString;
  releasedAt?: ISODateString;
  releaseReason?: "CANCELLED" | "EXPIRED" | "MANUAL";
}

export const DeliveryMode = {
  PICKUP: "PICKUP",
  POSTAL_CARRIER: "POSTAL_CARRIER",
  COURIER: "COURIER",
  OWN_DELIVERY: "OWN_DELIVERY",
  OTHER: "OTHER"
} as const;
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

export interface OrderDeliveryRequest {
  mode: DeliveryMode;
  address?: Address;
  customerPaysShipping?: boolean;
  shippingCharge?: Money;
  notes?: string;
}

export interface Order extends TenantEntity {
  orderNumber: string;
  customerId: Id;
  channel: OrderChannel;
  status: OrderStatus;
  lines: OrderLine[];
  subtotal: Money;
  orderDiscount: Money;
  shippingCharge: Money;
  total: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  reservationStatus: ReservationStatus;
  reservationExpiresAt?: ISODateString;
  delivery: OrderDeliveryRequest;
  customerNote?: string;
  internalNote?: string;
  cancelledAt?: ISODateString;
  cancellationReason?: string;
}

export const PaymentMethod = {
  BANK_TRANSFER: "BANK_TRANSFER",
  MERCADO_PAGO: "MERCADO_PAGO",
  CASH_ON_DELIVERY: "CASH_ON_DELIVERY",
  CARD: "CARD",
  OTHER: "OTHER"
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  REFUNDED: "REFUNDED"
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Payment extends TenantEntity {
  orderId: Id;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Money;
  processingFee?: Money;
  paidAt?: ISODateString;
  confirmedAt?: ISODateString;
  confirmedByUserId?: Id;
  externalReference?: string;
  proofUrl?: string;
  notes?: string;
}

export const ShipmentStatus = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  PREPARING: "PREPARING",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  DISPATCHED: "DISPATCHED",
  DELIVERED: "DELIVERED",
  RETURNED: "RETURNED"
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export interface Shipment extends TenantEntity {
  orderId: Id;
  mode: DeliveryMode;
  status: ShipmentStatus;
  recipientAddress?: Address;
  carrierName?: string;
  trackingCode?: string;
  chargedAmount: Money;
  businessCost?: Money;
  expectedAt?: ISODateString;
  dispatchedAt?: ISODateString;
  deliveredAt?: ISODateString;
  notes?: string;
}

export const CustomerType = {
  RETAIL: "RETAIL",
  WHOLESALE: "WHOLESALE"
} as const;
export type CustomerType = (typeof CustomerType)[keyof typeof CustomerType];

export interface Customer extends TenantEntity {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  instagramHandle?: string;
  taxId?: string;
  type: CustomerType;
  acquisitionChannel?: OrderChannel;
  addresses: Address[];
  tags: string[];
  notes?: string;
  lastOrderAt?: ISODateString;
}

export interface Supplier extends TenantEntity {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: Address;
  notes?: string;
  active: boolean;
}

export interface DashboardAttentionItem {
  type:
    | "PENDING_PAYMENT"
    | "RESERVATION_EXPIRING"
    | "LOW_STOCK"
    | "EXPIRING_LOT"
    | "OVERDUE_SHIPMENT";
  count: number;
  label: string;
  href: string;
}

export interface DashboardMetrics {
  salesCollectedToday: Money;
  pendingPaymentOrderCount: number;
  ordersToPrepareCount: number;
  lowStockVariantCount: number;
  grossProfitEstimatePeriod: Money;
  periodStart: ISODateString;
  periodEnd: ISODateString;
}

export interface DashboardRecentOrder {
  orderId: Id;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  total: Money;
  createdAt: ISODateString;
}

export interface DashboardSnapshot {
  organizationId: Id;
  generatedAt: ISODateString;
  metrics: DashboardMetrics;
  attention: DashboardAttentionItem[];
  recentOrders: DashboardRecentOrder[];
}

export const AuditAction = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  STATUS_CHANGE: "STATUS_CHANGE",
  LOGIN: "LOGIN",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
  PAYMENT_CONFIRMATION: "PAYMENT_CONFIRMATION"
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEvent {
  id: Id;
  organizationId?: Id;
  actorUserId?: Id;
  action: AuditAction;
  entityType: string;
  entityId: Id;
  occurredAt: ISODateString;
  before?: JsonValue;
  after?: JsonValue;
  reason?: string;
  ipAddress?: string;
}

// Input DTOs deliberately exclude server-owned audit fields and calculated totals.
export interface CreateOrganizationInput {
  name: string;
  legalName?: string;
  taxId?: string;
  contactEmail?: string;
  contactPhone?: string;
  fiscalAddress?: Address;
  settings?: Partial<OrganizationSettings>;
}

export interface InviteUserInput {
  organizationId: Id;
  email: string;
  displayName: string;
  role: OrganizationRole;
  /** Activation links, never plaintext passwords, are the preferred flow. */
  sendActivationEmail?: boolean;
}

export interface CreateProductInput {
  organizationId: Id;
  name: string;
  categoryId: Id;
  description?: string;
  brand?: string;
  informationalAttributes?: Record<string, JsonValue>;
  trackInventory?: boolean;
  lotTrackingEnabled?: boolean;
  expirationTrackingEnabled?: boolean;
  defaultSupplierId?: Id;
}

export interface CreateCategoryInput {
  organizationId: Id;
  name: string;
  slug?: string;
  parentCategoryId?: Id;
  description?: string;
  /** Base attributes can be removed or extended by the commerce owner. */
  attributes?: Omit<CategoryAttributeDefinition, "id">[];
}

export interface CreateProductVariantInput {
  organizationId: Id;
  productId: Id;
  name: string;
  sku: string;
  barcode?: string;
  attributes?: Record<string, JsonValue>;
  retailPrice: Money;
  wholesalePrice?: Money;
  lowStockThreshold?: number;
}

export interface ReceiveInventoryInput {
  organizationId: Id;
  supplierId?: Id;
  productVariantId: Id;
  quantity: number;
  unitCost: Money;
  lotCode?: string;
  expiresAt?: ISODateString;
  receivedAt?: ISODateString;
  notes?: string;
}

export interface AdjustStockInput {
  organizationId: Id;
  productVariantId: Id;
  /** Positive for additions and negative for removals. */
  quantityDelta: number;
  inventoryLotId?: Id;
  reason: string;
}

export interface CreateOrderLineInput {
  productVariantId: Id;
  quantity: number;
  /** Optional authorized override; otherwise the current price is used. */
  unitPriceOverride?: Money;
  discount?: Money;
}

export interface CreateOrderInput {
  organizationId: Id;
  customerId: Id;
  channel: OrderChannel;
  lines: CreateOrderLineInput[];
  delivery: OrderDeliveryRequest;
  reservationDurationMinutes?: number;
  customerNote?: string;
  internalNote?: string;
}

export interface RegisterPaymentInput {
  organizationId: Id;
  orderId: Id;
  method: PaymentMethod;
  amount: Money;
  processingFee?: Money;
  paidAt?: ISODateString;
  externalReference?: string;
  proofUrl?: string;
  notes?: string;
}

export interface UpdateShipmentInput {
  organizationId: Id;
  orderId: Id;
  mode?: DeliveryMode;
  status?: ShipmentStatus;
  carrierName?: string;
  trackingCode?: string;
  businessCost?: Money;
  expectedAt?: ISODateString;
  notes?: string;
}

export interface CreateCustomerInput {
  organizationId: Id;
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  instagramHandle?: string;
  taxId?: string;
  type?: CustomerType;
  acquisitionChannel?: OrderChannel;
  addresses?: Address[];
  tags?: string[];
  notes?: string;
}

export interface CreateSupplierInput {
  organizationId: Id;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: Address;
  notes?: string;
}
