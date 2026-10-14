import { randomUUID } from "node:crypto";
import { withTransaction, type PostgresPool, type PostgresQueryClient } from "./types.js";

export interface CatalogListItem {
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

export interface CreateCatalogProductInput {
  organizationId: string;
  actorUserId: string;
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

export interface ReceiveCatalogStockInput {
  organizationId: string;
  actorUserId: string;
  variantId: string;
  quantity: number;
  unitCostMinor: number;
  lotCode?: string;
  expiresAt?: string;
}

interface CatalogListRow extends Record<string, unknown> {
  id: string;
  variant_id: string;
  name: string;
  variant_name: string;
  category_name: string;
  sku: string;
  retail_price_minor: string | number;
  on_hand_quantity: string | number | null;
  reserved_quantity: string | number | null;
  available_quantity: string | number | null;
  low_stock_threshold: string | number | null;
}

interface IdRow extends Record<string, unknown> { id: string }

/**
 * Persistence adapter for the first operational catalogue flow. Every query is
 * bound to an organization id and all stock writes occur in one transaction.
 */
export class PostgresCatalogRepository {
  constructor(private readonly pool: PostgresPool) {}

  async listProducts(organizationId: string): Promise<CatalogListItem[]> {
    const result = await this.pool.query<CatalogListRow>(
      `SELECT p.id, v.id AS variant_id, p.name, v.name AS variant_name, c.name AS category_name, v.sku,
              v.retail_price_minor, l.on_hand_quantity, l.reserved_quantity, l.available_quantity, l.low_stock_threshold
       FROM products p
       JOIN product_variants v ON v.product_id = p.id AND v.organization_id = p.organization_id
       JOIN product_categories c ON c.id = p.category_id AND c.organization_id = p.organization_id
       LEFT JOIN inventory_levels l ON l.product_variant_id = v.id AND l.organization_id = v.organization_id
       WHERE p.organization_id = $1 AND p.status = 'ACTIVE' AND v.active = true
       ORDER BY p.created_at DESC, v.created_at ASC`,
      [organizationId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      name: row.name,
      variantName: row.variant_name,
      categoryName: row.category_name,
      sku: row.sku,
      retailPriceMinor: numberValue(row.retail_price_minor),
      onHandQuantity: numberValue(row.on_hand_quantity),
      reservedQuantity: numberValue(row.reserved_quantity),
      availableQuantity: numberValue(row.available_quantity),
      lowStockThreshold: row.low_stock_threshold === null ? undefined : numberValue(row.low_stock_threshold)
    }));
  }

  async createProduct(input: CreateCatalogProductInput): Promise<CatalogListItem> {
    return withTransaction(this.pool, async (client) => {
      const categoryId = await this.findOrCreateCategory(client, input.organizationId, input.categoryName);
      const suffix = randomUUID().slice(0, 8);
      const product = await client.query<IdRow>(
        `INSERT INTO products (organization_id, category_id, name, slug, track_inventory)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [input.organizationId, categoryId, input.name, `${slugify(input.name)}-${suffix}`]
      );
      const productId = product.rows[0]?.id;
      if (!productId) throw new Error("Product creation did not return an id.");
      const variantName = input.variantName?.trim() || "Única";
      const sku = input.sku?.trim() || `${slugify(input.name).slice(0, 18).toUpperCase()}-${suffix.toUpperCase()}`;
      const variant = await client.query<IdRow>(
        `INSERT INTO product_variants (organization_id, product_id, name, sku, retail_price_minor, low_stock_threshold)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.organizationId, productId, variantName, sku, input.retailPriceMinor, input.lowStockThreshold ?? null]
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error("Product variant creation did not return an id.");

      await this.insertAudit(client, input.organizationId, input.actorUserId, "catalog.product_created", "product", productId, { name: input.name, sku });
      if ((input.initialQuantity ?? 0) > 0) {
        await this.receiveStockWithClient(client, { ...input, variantId, quantity: input.initialQuantity!, unitCostMinor: input.unitCostMinor ?? 0 });
      }
      return this.getItemWithClient(client, input.organizationId, variantId);
    });
  }

  async receiveStock(input: ReceiveCatalogStockInput): Promise<CatalogListItem> {
    return withTransaction(this.pool, async (client) => {
      await this.receiveStockWithClient(client, input);
      return this.getItemWithClient(client, input.organizationId, input.variantId);
    });
  }

  private async findOrCreateCategory(client: PostgresQueryClient, organizationId: string, name: string): Promise<string> {
    const slug = slugify(name);
    const result = await client.query<IdRow>(
      `INSERT INTO product_categories (organization_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, slug) DO UPDATE SET name = product_categories.name
       RETURNING id`,
      [organizationId, name, slug]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Category creation did not return an id.");
    return id;
  }

  private async receiveStockWithClient(client: PostgresQueryClient, input: ReceiveCatalogStockInput): Promise<void> {
    const owned = await client.query<IdRow>(
      `SELECT id FROM product_variants WHERE id = $1 AND organization_id = $2 AND active = true FOR UPDATE`,
      [input.variantId, input.organizationId]
    );
    if (!owned.rows[0]) throw new Error("Product variant was not found in this organization.");
    const lot = await client.query<IdRow>(
      `INSERT INTO inventory_lots (
        organization_id, product_variant_id, lot_code, expires_at, unit_cost_minor,
        initial_quantity, available_quantity, reserved_quantity
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, 0)
      RETURNING id`,
      [input.organizationId, input.variantId, input.lotCode ?? null, input.expiresAt ?? null, input.unitCostMinor, input.quantity]
    );
    const lotId = lot.rows[0]?.id;
    if (!lotId) throw new Error("Stock receipt did not return a lot id.");
    await client.query(
      `INSERT INTO inventory_levels (organization_id, product_variant_id, on_hand_quantity, reserved_quantity, low_stock_threshold)
       SELECT $1, $2, $3, 0, low_stock_threshold FROM product_variants WHERE id = $2 AND organization_id = $1
       ON CONFLICT (organization_id, product_variant_id)
       DO UPDATE SET on_hand_quantity = inventory_levels.on_hand_quantity + EXCLUDED.on_hand_quantity`,
      [input.organizationId, input.variantId, input.quantity]
    );
    await client.query(
      `INSERT INTO stock_movements (
        organization_id, product_variant_id, inventory_lot_id, movement_type, quantity_delta,
        unit_cost_minor, reference_type, reason, created_by_user_id
      ) VALUES ($1, $2, $3, 'PURCHASE_RECEIPT', $4, $5, 'PURCHASE', 'Ingreso de stock', $6)`,
      [input.organizationId, input.variantId, lotId, input.quantity, input.unitCostMinor, input.actorUserId]
    );
    await this.insertAudit(client, input.organizationId, input.actorUserId, "inventory.stock_received", "inventory_lot", lotId, {
      productVariantId: input.variantId, quantity: input.quantity, unitCostMinor: input.unitCostMinor, lotCode: input.lotCode ?? null
    });
  }

  private async getItemWithClient(client: PostgresQueryClient, organizationId: string, variantId: string): Promise<CatalogListItem> {
    const result = await client.query<CatalogListRow>(
      `SELECT p.id, v.id AS variant_id, p.name, v.name AS variant_name, c.name AS category_name, v.sku,
              v.retail_price_minor, l.on_hand_quantity, l.reserved_quantity, l.available_quantity, l.low_stock_threshold
       FROM product_variants v
       JOIN products p ON p.id = v.product_id AND p.organization_id = v.organization_id
       JOIN product_categories c ON c.id = p.category_id AND c.organization_id = p.organization_id
       LEFT JOIN inventory_levels l ON l.product_variant_id = v.id AND l.organization_id = v.organization_id
       WHERE v.organization_id = $1 AND v.id = $2`,
      [organizationId, variantId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Created product could not be read.");
    return {
      id: row.id, variantId: row.variant_id, name: row.name, variantName: row.variant_name,
      categoryName: row.category_name, sku: row.sku, retailPriceMinor: numberValue(row.retail_price_minor),
      onHandQuantity: numberValue(row.on_hand_quantity), reservedQuantity: numberValue(row.reserved_quantity),
      availableQuantity: numberValue(row.available_quantity),
      lowStockThreshold: row.low_stock_threshold === null ? undefined : numberValue(row.low_stock_threshold)
    };
  }

  private async insertAudit(client: PostgresQueryClient, organizationId: string, actorUserId: string, action: string, entityType: string, entityId: string, afterValue: Record<string, unknown>): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [organizationId, actorUserId, action, entityType, entityId, JSON.stringify(afterValue)]
    );
  }
}

function numberValue(value: string | number | null): number {
  if (value === null) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function slugify(value: string): string {
  const slug = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "producto";
}
