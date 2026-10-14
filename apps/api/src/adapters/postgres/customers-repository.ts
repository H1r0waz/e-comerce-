import type { PostgresPool } from "./types.js";
import type { CustomerListItemResponse } from "../../routes/types.js";

interface CustomerRow extends Record<string, unknown> {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  customer_type: "RETAIL" | "WHOLESALE";
  order_count: string | number;
  total_spent_minor: string | number;
  last_purchase_at: Date | string | null;
}

/** Read model for the customer directory. Monetary history only includes paid sales. */
export class PostgresCustomersRepository {
  constructor(private readonly pool: PostgresPool) {}

  async listCustomers(organizationId: string): Promise<CustomerListItemResponse[]> {
    const result = await this.pool.query<CustomerRow>(CUSTOMER_LIST_QUERY, [organizationId]);
    return result.rows.map((row) => ({
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      phone: row.phone,
      email: row.email ?? undefined,
      customerType: row.customer_type,
      orderCount: numberValue(row.order_count),
      totalSpentMinor: numberValue(row.total_spent_minor),
      lastPurchaseAt: row.last_purchase_at ? asIso(row.last_purchase_at) : undefined
    }));
  }
}

const CUSTOMER_LIST_QUERY = `
  SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.customer_type,
         COUNT(o.id) FILTER (WHERE o.status IN ('CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'COMPLETED'))::integer AS order_count,
         COALESCE(SUM(o.total_minor) FILTER (WHERE o.status IN ('CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'COMPLETED')), 0) AS total_spent_minor,
         MAX(o.created_at) FILTER (WHERE o.status IN ('CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'COMPLETED')) AS last_purchase_at
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id AND o.organization_id = c.organization_id
  WHERE c.organization_id = $1
  GROUP BY c.id
  ORDER BY MAX(o.created_at) FILTER (WHERE o.status IN ('CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'COMPLETED')) DESC NULLS LAST, c.created_at DESC
`;

function numberValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Unexpected numeric value returned by PostgreSQL.");
  return parsed;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
