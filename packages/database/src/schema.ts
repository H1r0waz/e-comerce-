/**
 * Database-agnostic domain schema. It intentionally contains no database
 * client so the API can be developed and tested without external services.
 * A future ORM adapter should map these interfaces to tables/collections.
 */

export type Id = string;
export type IsoDateTime = string;

export interface Timestamped {
  id: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Every business record is isolated by this field. */
export interface OrganizationScoped {
  organizationId: Id;
}

export interface Organization extends Timestamped {
  name: string;
  legalName?: string;
  taxId?: string;
  countryCode: "AR" | string;
  currency: "ARS" | string;
  timezone: string;
  status: "active" | "suspended" | "archived";
}

export type UserRole = "platform_admin" | "owner" | "sales" | "inventory" | "viewer";

export interface User extends Timestamped {
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  organizationId?: Id;
  status: "invited" | "active" | "disabled";
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt?: IsoDateTime;
}

export interface ProductCategory extends Timestamped, OrganizationScoped {
  name: string;
  description?: string;
  /** Editable defaults such as tone, volume or fragrance. */
  attributes: ProductAttributeDefinition[];
  active: boolean;
}

export interface ProductAttributeDefinition {
  key: string;
  label: string;
  mode: "variant" | "informational";
  required: boolean;
  suggestedValues: string[];
}

export interface Product extends Timestamped, OrganizationScoped {
  categoryId?: Id;
  supplierId?: Id;
  name: string;
  brand?: string;
  description?: string;
  status: "active" | "paused" | "discontinued";
  trackLots: boolean;
  trackExpiry: boolean;
  tags: string[];
}

export interface ProductVariant extends Timestamped, OrganizationScoped {
  productId: Id;
  sku: string;
  barcode?: string;
  attributes: Record<string, string>;
  retailPrice: number;
  wholesalePrice?: number;
  reorderPoint?: number;
  active: boolean;
}

export interface Supplier extends Timestamped, OrganizationScoped {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export type InventoryMovementType =
  | "purchase_receipt"
  | "reservation"
  | "reservation_release"
  | "sale"
  | "return"
  | "adjustment"
  | "expiry"
  | "damage";

/**
 * Append-only stock ledger. Positive quantities add stock; negative values
 * consume it. Cost layers preserve FIFO profitability without duplicating a
 * product in the owner-facing catalogue.
 */
export interface InventoryMovement extends Timestamped, OrganizationScoped {
  productVariantId: Id;
  type: InventoryMovementType;
  quantityDelta: number;
  reservedQuantityDelta: number;
  unitCost?: number;
  lotCode?: string;
  expiresAt?: string;
  referenceType?: "purchase" | "order" | "return" | "adjustment";
  referenceId?: Id;
  reason?: string;
  createdByUserId: Id;
}

export interface Customer extends Timestamped, OrganizationScoped {
  name: string;
  phone: string;
  email?: string;
  instagramHandle?: string;
  customerType: "retail" | "wholesale";
  sourceChannel?: "whatsapp" | "instagram" | "other";
  notes?: string;
}

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "confirmed"
  | "preparing"
  | "ready_to_ship"
  | "completed"
  | "cancelled";

export interface Order extends Timestamped, OrganizationScoped {
  orderNumber: string;
  customerId: Id;
  channel: "whatsapp" | "instagram" | "other";
  status: OrderStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  reservationExpiresAt?: IsoDateTime;
  notes?: string;
  internalNotes?: string;
  createdByUserId: Id;
}

export interface OrderLine extends Timestamped, OrganizationScoped {
  orderId: Id;
  productVariantId: Id;
  descriptionSnapshot: string;
  quantity: number;
  unitPrice: number;
  discountTotal: number;
  allocatedCostTotal?: number;
}

export type PaymentStatus = "pending" | "confirmed" | "rejected" | "refunded";

export interface Payment extends Timestamped, OrganizationScoped {
  orderId: Id;
  method: string;
  amount: number;
  feeAmount: number;
  status: PaymentStatus;
  reference?: string;
  proofUrl?: string;
  confirmedAt?: IsoDateTime;
  confirmedByUserId?: Id;
}

export type ShipmentStatus = "not_required" | "pending" | "preparing" | "dispatched" | "delivered" | "returned";

export interface Shipment extends Timestamped, OrganizationScoped {
  orderId: Id;
  method: string;
  status: ShipmentStatus;
  recipientName: string;
  address?: string;
  trackingCode?: string;
  carrier?: string;
  cost: number;
  paidBy: "customer" | "organization" | "shared";
  dispatchedAt?: IsoDateTime;
  deliveredAt?: IsoDateTime;
  notes?: string;
}

/** Immutable security and operational history. */
export interface AuditLog extends Timestamped, OrganizationScoped {
  actorUserId?: Id;
  action: string;
  entityType: string;
  entityId: Id;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface DatabaseSchema {
  organizations: Organization;
  users: User;
  categories: ProductCategory;
  products: Product;
  productVariants: ProductVariant;
  suppliers: Supplier;
  inventoryMovements: InventoryMovement;
  customers: Customer;
  orders: Order;
  orderLines: OrderLine;
  payments: Payment;
  shipments: Shipment;
  auditLogs: AuditLog;
}
