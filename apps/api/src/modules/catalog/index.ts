import type { ModuleDefinition } from "../shared.js";
import {
  assertSameTenant,
  DomainValidationError,
  requireMinorMoney,
  requireTenantId,
  type TenantContext
} from "./tenant.js";

export const catalogModule: ModuleDefinition = {
  name: "catalog",
  routePrefix: "/v1/catalog",
  description: "Tenant catalogue, category-defined variant attributes, and prices."
};

export type AttributeKind = "text" | "number" | "boolean" | "select";
export type AttributePurpose = "variant" | "informational";

export interface CategoryAttribute {
  key: string;
  label: string;
  kind: AttributeKind;
  purpose: AttributePurpose;
  required: boolean;
  suggestedValues: string[];
  position: number;
}

export interface Category {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  attributes: CategoryAttribute[];
  active: boolean;
}

export interface CatalogProduct {
  id: string;
  organizationId: string;
  categoryId: string;
  name: string;
  status: "active" | "paused" | "discontinued";
  trackInventory: boolean;
  lotTrackingEnabled: boolean;
  expirationTrackingEnabled: boolean;
  informationalAttributes: Record<string, unknown>;
}

export interface CatalogVariant {
  id: string;
  organizationId: string;
  productId: string;
  name: string;
  sku: string;
  attributes: Record<string, unknown>;
  retailPriceMinor: number;
  currency: string;
  active: boolean;
  lowStockThreshold?: number;
}

export interface CreateCategoryCommand {
  name: string;
  slug: string;
  attributes?: CategoryAttribute[];
}

export interface CreateProductCommand {
  categoryId: string;
  name: string;
  informationalAttributes?: Record<string, unknown>;
  trackInventory?: boolean;
  lotTrackingEnabled?: boolean;
  expirationTrackingEnabled?: boolean;
}

export interface CreateVariantCommand {
  productId: string;
  name: string;
  sku: string;
  attributes?: Record<string, unknown>;
  retailPriceMinor: number;
  currency?: string;
  lowStockThreshold?: number;
}

/** All reads must be tenant-filtered at the persistence boundary. */
export interface CatalogRepository {
  findCategory(context: TenantContext, categoryId: string): Promise<Category | null>;
  findProduct(context: TenantContext, productId: string): Promise<CatalogProduct | null>;
  findVariant(context: TenantContext, variantId: string): Promise<CatalogVariant | null>;
  findVariantBySku(context: TenantContext, sku: string): Promise<CatalogVariant | null>;
  createCategory(context: TenantContext, command: CreateCategoryCommand): Promise<Category>;
  createProduct(context: TenantContext, command: CreateProductCommand): Promise<CatalogProduct>;
  createVariant(context: TenantContext, command: CreateVariantCommand): Promise<CatalogVariant>;
}

/** Read port used by orders and inventory without coupling them to storage. */
export interface CatalogReader {
  getActiveVariant(context: TenantContext, variantId: string): Promise<CatalogVariant>;
}

export class CatalogService implements CatalogReader {
  constructor(private readonly repository: CatalogRepository) {}

  async createCategory(context: TenantContext, command: CreateCategoryCommand): Promise<Category> {
    requireTenantId(context.organizationId);
    if (!command.name.trim() || !command.slug.trim()) throw new DomainValidationError("Category name and slug are required.");
    const attributes = command.attributes ?? [];
    const keys = new Set<string>();
    for (const attribute of attributes) {
      if (!attribute.key.trim() || !attribute.label.trim() || keys.has(attribute.key)) {
        throw new DomainValidationError("Category attribute keys must be present and unique.");
      }
      keys.add(attribute.key);
    }
    return this.repository.createCategory(context, { ...command, attributes });
  }

  async createProduct(context: TenantContext, command: CreateProductCommand): Promise<CatalogProduct> {
    const category = await this.repository.findCategory(context, command.categoryId);
    if (!category) throw new DomainValidationError("Product category was not found.");
    assertSameTenant(context, category);
    if (!category.active || !command.name.trim()) throw new DomainValidationError("An active category and a product name are required.");
    if (command.expirationTrackingEnabled && !command.lotTrackingEnabled) {
      throw new DomainValidationError("Expiry tracking requires lot tracking.");
    }
    return this.repository.createProduct(context, command);
  }

  async createVariant(context: TenantContext, command: CreateVariantCommand): Promise<CatalogVariant> {
    requireMinorMoney(command.retailPriceMinor, "retailPriceMinor");
    if (!command.name.trim() || !command.sku.trim()) throw new DomainValidationError("Variant name and SKU are required.");
    if (command.lowStockThreshold !== undefined && (!Number.isInteger(command.lowStockThreshold) || command.lowStockThreshold < 0)) {
      throw new DomainValidationError("lowStockThreshold must be a non-negative integer.");
    }
    const product = await this.repository.findProduct(context, command.productId);
    if (!product) throw new DomainValidationError("Product was not found.");
    assertSameTenant(context, product);
    const duplicate = await this.repository.findVariantBySku(context, command.sku);
    if (duplicate) throw new DomainValidationError("SKU is already used in this organization.");
    const category = await this.repository.findCategory(context, product.categoryId);
    if (!category) throw new DomainValidationError("Product category was not found.");
    this.validateVariantAttributes(category, command.attributes ?? {});
    return this.repository.createVariant(context, command);
  }

  async getActiveVariant(context: TenantContext, variantId: string): Promise<CatalogVariant> {
    const variant = await this.repository.findVariant(context, variantId);
    if (!variant) throw new DomainValidationError("Product variant was not found.");
    assertSameTenant(context, variant);
    if (!variant.active) throw new DomainValidationError("Product variant is not active.");
    return variant;
  }

  private validateVariantAttributes(category: Category, values: Record<string, unknown>): void {
    for (const attribute of category.attributes.filter((item) => item.purpose === "variant")) {
      const value = values[attribute.key];
      if (attribute.required && (value === undefined || value === null || value === "")) {
        throw new DomainValidationError(`Variant attribute ${attribute.label} is required.`);
      }
      if (value !== undefined && attribute.kind === "select" && !attribute.suggestedValues.includes(String(value))) {
        throw new DomainValidationError(`Variant attribute ${attribute.label} has an unsupported value.`);
      }
    }
  }
}
