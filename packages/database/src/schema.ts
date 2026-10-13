/**
 * TypeScript mirror of the PostgreSQL schema in database/migrations.
 * Amounts are integer minor units (ARS centavos) and every operational record
 * carries organizationId. Use repository queries with TenantContext as well.
 */

export type Id = string;
export type IsoDateTime = string;
export type JsonObject = Record<string, unknown>;

export interface Timestamped {
  id: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface OrganizationScoped {
  organizationId: Id;
}

export interface Organization extends Timestamped {
  name: string;
  legalName?: string;
  taxId?: string;
  taxCondition?: string;
  countryCode: "AR" | string;
  currency: "ARS" | string;
  timezone: string;
  locale: string;
  settings: JsonObject;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
}

export interface User extends Timestamped {
  email: string;
  displayName: string;
  /** Argon2id hash only; it is absent until an invitation is activated. */
  passwordHash?: string;
  passwordChangedAt?: IsoDateTime;
  passwordVersion: number;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  twoFactorEnabled: boolean;
  /** Encrypted at application level; never return it in API responses. */
  twoFactorSecretEncrypted?: string;
  lastLoginAt?: IsoDateTime;
}

export type PlatformRole = "SUPER_ADMIN";
export type OrganizationRole = "OWNER" | "SALES" | "INVENTORY_FULFILLMENT" | "VIEWER";

export interface OrganizationMembership extends Timestamped, OrganizationScoped {
  userId: Id;
  role: OrganizationRole;
  active: boolean;
}

export interface UserInvitation extends OrganizationScoped {
  id: Id;
  email: string;
  displayName: string;
  role: OrganizationRole;
  /** Hash only: the plaintext activation token must not be persisted. */
  tokenHash: string;
  expiresAt: IsoDateTime;
  acceptedAt?: IsoDateTime;
  revokedAt?: IsoDateTime;
}

export interface ProductAttributeDefinition extends Timestamped, OrganizationScoped {
  categoryId: Id;
  key: string;
  label: string;
  dataType: "TEXT" | "NUMBER" | "BOOLEAN" | "SELECT";
  purpose: "VARIANT" | "INFORMATIONAL";
  required: boolean;
  suggestedValues: unknown[];
  position: number;
}

export interface ProductCategory extends Timestamped, OrganizationScoped {
  parentCategoryId?: Id;
  name: string;
  slug: string;
  description?: string;
  active: boolean;
}

export interface Product extends Timestamped, OrganizationScoped {
  categoryId: Id;
  supplierId?: Id;
  name: string;
  slug: string;
  brand?: string;
  description?: string;
  status: "ACTIVE" | "PAUSED" | "DISCONTINUED";
  informationalAttributes: JsonObject;
  trackInventory: boolean;
  trackLots: boolean;
  trackExpiry: boolean;
}

export interface ProductVariant extends Timestamped, OrganizationScoped {
  productId: Id;
  name: string;
  sku: string;
  barcode?: string;
  attributes: JsonObject;
  retailPriceMinor: number;
  wholesalePriceMinor?: number;
  lowStockThreshold?: number;
  active: boolean;
}

export interface Supplier extends Timestamped, OrganizationScoped {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  notes?: string;
  active: boolean;
}

/** A lot is a FIFO cost layer, not another owner-facing product. */
export interface InventoryLot extends Timestamped, OrganizationScoped {
  productVariantId: Id;
  supplierId?: Id;
  lotCode?: string;
  receivedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
  unitCostMinor: number;
  initialQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
}

export interface InventoryLevel extends OrganizationScoped {
  productVariantId: Id;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold?: number;
  updatedAt: IsoDateTime;
}

export type InventoryMovementType =
  | "PURCHASE_RECEIPT"
  | "RESERVATION_CREATED"
  | "RESERVATION_RELEASED"
  | "SALE_COMMITTED"
  | "CUSTOMER_RETURN"
  | "EXPIRATION_WRITE_OFF"
  | "DAMAGE_OR_LOSS"
  | "MANUAL_ADJUSTMENT";

/** Append-only stock ledger. */
export interface InventoryMovement extends OrganizationScoped {
  id: Id;
  productVariantId: Id;
  inventoryLotId?: Id;
  type: InventoryMovementType;
  quantityDelta: number;
  reservedQuantityDelta: number;
  unitCostMinor?: number;
  referenceType?: "ORDER" | "PURCHASE" | "RETURN" | "ADJUSTMENT";
  referenceId?: Id;
  reason?: string;
  createdByUserId?: Id;
  createdAt: IsoDateTime;
}

export interface Customer extends Timestamped, OrganizationScoped {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  instagramHandle?: string;
  customerType: "RETAIL" | "WHOLESALE";
  sourceChannel?: "WHATSAPP" | "INSTAGRAM" | "ONLINE_STORE" | "MARKETPLACE" | "OTHER";
  addresses: unknown[];
  tags: string[];
  notes?: string;
}

export type OrderStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_TO_SHIP"
  | "COMPLETED"
  | "CANCELLED";

export interface Order extends Timestamped, OrganizationScoped {
  orderNumber: string;
  customerId: Id;
  channel: "WHATSAPP" | "INSTAGRAM" | "ONLINE_STORE" | "MARKETPLACE" | "OTHER";
  status: OrderStatus;
  reservationStatus: "NONE" | "ACTIVE" | "RELEASED" | "EXPIRED" | "CONSUMED";
  reservationExpiresAt?: IsoDateTime;
  currency: string;
  subtotalMinor: number;
  discountTotalMinor: number;
  shippingTotalMinor: number;
  grandTotalMinor: number;
  paidAmountMinor: number;
  outstandingAmountMinor: number;
  createdByUserId?: Id;
}

export interface OrderLine extends Timestamped, OrganizationScoped {
  orderId: Id;
  productVariantId: Id;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  allocatedCostMinor?: number;
}

export interface StockReservation extends Timestamped, OrganizationScoped {
  orderId: Id;
  orderLineId?: Id;
  productVariantId: Id;
  inventoryLotId?: Id;
  quantity: number;
  status: "ACTIVE" | "RELEASED" | "EXPIRED" | "CONSUMED";
  expiresAt?: IsoDateTime;
  releasedAt?: IsoDateTime;
  releaseReason?: "CANCELLED" | "EXPIRED" | "MANUAL";
}

export interface Payment extends Timestamped, OrganizationScoped {
  orderId: Id;
  method: "BANK_TRANSFER" | "MERCADO_PAGO" | "CASH_ON_DELIVERY" | "CARD" | "OTHER";
  amountMinor: number;
  feeAmountMinor?: number;
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "REFUNDED";
  externalReference?: string;
  proofUrl?: string;
  confirmedAt?: IsoDateTime;
  confirmedByUserId?: Id;
}

export interface Shipment extends Timestamped, OrganizationScoped {
  orderId: Id;
  method: "PICKUP" | "POSTAL_CARRIER" | "COURIER" | "OWN_DELIVERY" | "OTHER";
  status: "NOT_REQUIRED" | "PENDING" | "PREPARING" | "READY_FOR_PICKUP" | "DISPATCHED" | "DELIVERED" | "RETURNED";
  recipientAddress?: JsonObject;
  trackingCode?: string;
  carrier?: string;
  chargedAmountMinor: number;
  businessCostMinor?: number;
}

/** Immutable security and operational history. */
export interface AuditLog extends OrganizationScoped {
  id: Id;
  actorUserId?: Id;
  action: string;
  entityType: string;
  entityId?: Id;
  before?: JsonObject;
  after?: JsonObject;
  ipAddress?: string;
  userAgent?: string;
  occurredAt: IsoDateTime;
}

export interface DatabaseSchema {
  organizations: Organization;
  users: User;
  memberships: OrganizationMembership;
  invitations: UserInvitation;
  categories: ProductCategory;
  categoryAttributes: ProductAttributeDefinition;
  products: Product;
  productVariants: ProductVariant;
  suppliers: Supplier;
  inventoryLots: InventoryLot;
  inventoryLevels: InventoryLevel;
  inventoryMovements: InventoryMovement;
  customers: Customer;
  orders: Order;
  orderLines: OrderLine;
  stockReservations: StockReservation;
  payments: Payment;
  shipments: Shipment;
  auditLogs: AuditLog;
}
