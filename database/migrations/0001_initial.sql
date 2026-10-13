-- Comerciar initial Lakebase Postgres schema.
--
-- This migration is deliberately safe to re-run on an empty or partially
-- initialized branch. Run it through a direct (non-pooler) DATABASE_URL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE organization_status AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE user_status AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE organization_role AS ENUM ('OWNER', 'SALES', 'INVENTORY_FULFILLMENT', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE product_status AS ENUM ('ACTIVE', 'PAUSED', 'DISCONTINUED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE order_channel AS ENUM ('WHATSAPP', 'INSTAGRAM', 'ONLINE_STORE', 'MARKETPLACE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE order_status AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE reservation_status AS ENUM ('NONE', 'ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE shipment_status AS ENUM ('NOT_REQUIRED', 'PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE delivery_mode AS ENUM ('PICKUP', 'POSTAL_CARRIER', 'COURIER', 'OWN_DELIVERY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE stock_movement_type AS ENUM (
    'PURCHASE_RECEIPT', 'RESERVATION_CREATED', 'RESERVATION_RELEASED',
    'SALE_COMMITTED', 'CUSTOMER_RETURN', 'EXPIRATION_WRITE_OFF',
    'DAMAGE_OR_LOSS', 'MANUAL_ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  legal_name text,
  tax_id text,
  tax_condition text,
  contact_email text,
  contact_phone text,
  fiscal_address jsonb,
  status organization_status NOT NULL DEFAULT 'ACTIVE',
  currency_code char(3) NOT NULL DEFAULT 'ARS',
  time_zone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  locale text NOT NULL DEFAULT 'es-AR',
  settings jsonb NOT NULL DEFAULT jsonb_build_object(
    'defaultReservationDurationMinutes', 60,
    'maximumReservationDurationMinutes', 240,
    'allowDispatchWithOutstandingBalance', false,
    'inventoryCostMethod', 'FIFO',
    'expirationAlertDays', 30
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_tax_id_unique
  ON organizations (tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  -- Algorithm-tagged password hash only. Invited users receive their first hash on activation.
  password_hash text,
  password_changed_at timestamptz,
  password_version integer NOT NULL DEFAULT 1 CHECK (password_version > 0),
  status user_status NOT NULL DEFAULT 'INVITED',
  two_factor_enabled boolean NOT NULL DEFAULT false,
  -- Application-layer encrypted TOTP secret; recovery codes are individually hashed.
  two_factor_secret_encrypted bytea,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recovery_code_hashes) = 'array'),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((two_factor_enabled = false) OR two_factor_secret_encrypted IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
  ON app_users (lower(email));

CREATE TABLE IF NOT EXISTS platform_user_roles (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = 'SUPER_ADMIN'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role organization_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role organization_role NOT NULL,
  -- SHA-256 (or stronger) hash only. The activation secret is never stored.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at)
);

CREATE INDEX IF NOT EXISTS user_invitations_pending_idx
  ON user_invitations (organization_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- SHA-256 (or stronger) hash of an opaque, HttpOnly session token.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_active_by_user_idx
  ON auth_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_pending_idx
  ON password_reset_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_category_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, slug),
  CONSTRAINT product_categories_parent_tenant_fk
    FOREIGN KEY (parent_category_id, organization_id)
    REFERENCES product_categories (id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS category_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  attribute_key text NOT NULL CHECK (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('TEXT', 'NUMBER', 'BOOLEAN', 'SELECT')),
  purpose text NOT NULL CHECK (purpose IN ('VARIANT', 'INFORMATIONAL')),
  required boolean NOT NULL DEFAULT false,
  suggested_values jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_values) = 'array'),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (category_id, attribute_key),
  CONSTRAINT category_attribute_category_tenant_fk
    FOREIGN KEY (category_id, organization_id)
    REFERENCES product_categories (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  contact_name text,
  email text,
  phone text,
  tax_id text,
  address jsonb,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  default_supplier_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  brand text,
  status product_status NOT NULL DEFAULT 'ACTIVE',
  informational_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(informational_attributes) = 'object'),
  track_inventory boolean NOT NULL DEFAULT true,
  lot_tracking_enabled boolean NOT NULL DEFAULT false,
  expiration_tracking_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, slug),
  CONSTRAINT products_category_tenant_fk
    FOREIGN KEY (category_id, organization_id)
    REFERENCES product_categories (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT products_supplier_tenant_fk
    FOREIGN KEY (default_supplier_id, organization_id)
    REFERENCES suppliers (id, organization_id) ON DELETE SET NULL (default_supplier_id)
);

CREATE TABLE IF NOT EXISTS product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  url text NOT NULL,
  alt_text text,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (product_id, position),
  CONSTRAINT product_media_product_tenant_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  name text NOT NULL,
  sku text NOT NULL,
  barcode text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  retail_price_minor bigint NOT NULL CHECK (retail_price_minor >= 0),
  wholesale_price_minor bigint CHECK (wholesale_price_minor >= 0),
  low_stock_threshold numeric(14,3) CHECK (low_stock_threshold >= 0),
  weight_grams integer CHECK (weight_grams >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, sku),
  CONSTRAINT product_variants_product_tenant_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON product_variants (organization_id, product_id) WHERE active;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name text,
  phone text NOT NULL CHECK (length(btrim(phone)) > 0),
  email text,
  instagram_handle text,
  tax_id text,
  customer_type text NOT NULL DEFAULT 'RETAIL' CHECK (customer_type IN ('RETAIL', 'WHOLESALE')),
  acquisition_channel order_channel,
  addresses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(addresses) = 'array'),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  notes text,
  last_order_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (organization_id, phone);
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (organization_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  order_number text NOT NULL,
  channel order_channel NOT NULL,
  status order_status NOT NULL DEFAULT 'DRAFT',
  reservation_status reservation_status NOT NULL DEFAULT 'NONE',
  reservation_expires_at timestamptz,
  currency_code char(3) NOT NULL DEFAULT 'ARS',
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  order_discount_minor bigint NOT NULL DEFAULT 0 CHECK (order_discount_minor >= 0),
  shipping_charge_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_charge_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  paid_amount_minor bigint NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  outstanding_amount_minor bigint NOT NULL DEFAULT 0 CHECK (outstanding_amount_minor >= 0),
  delivery_mode delivery_mode NOT NULL DEFAULT 'PICKUP',
  delivery_address jsonb,
  delivery_customer_pays_shipping boolean NOT NULL DEFAULT true,
  delivery_notes text,
  customer_note text,
  internal_note text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, order_number),
  CHECK (
    (reservation_status = 'ACTIVE' AND reservation_expires_at IS NOT NULL)
    OR reservation_status <> 'ACTIVE'
  ),
  CONSTRAINT orders_customer_tenant_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS orders_work_queue_idx
  ON orders (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_expiring_reservations_idx
  ON orders (organization_id, reservation_expires_at)
  WHERE reservation_status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  product_variant_id uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  allocated_cost_minor bigint CHECK (allocated_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT order_lines_order_tenant_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT order_lines_variant_tenant_fk
    FOREIGN KEY (product_variant_id, organization_id)
    REFERENCES product_variants (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (organization_id, order_id);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_variant_id uuid NOT NULL,
  supplier_id uuid,
  lot_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  initial_quantity numeric(14,3) NOT NULL CHECK (initial_quantity > 0),
  available_quantity numeric(14,3) NOT NULL CHECK (available_quantity >= 0),
  reserved_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CHECK (reserved_quantity <= available_quantity),
  CHECK (expires_at IS NULL OR expires_at >= received_at),
  CONSTRAINT inventory_lots_variant_tenant_fk
    FOREIGN KEY (product_variant_id, organization_id)
    REFERENCES product_variants (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_lots_supplier_tenant_fk
    FOREIGN KEY (supplier_id, organization_id)
    REFERENCES suppliers (id, organization_id) ON DELETE SET NULL (supplier_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_lots_code_unique
  ON inventory_lots (organization_id, product_variant_id, lot_code)
  WHERE lot_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_lots_expiry_idx
  ON inventory_lots (organization_id, expires_at)
  WHERE expires_at IS NOT NULL AND available_quantity > 0;

CREATE TABLE IF NOT EXISTS inventory_levels (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_variant_id uuid NOT NULL,
  on_hand_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity numeric(14,3) GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity) STORED,
  low_stock_threshold numeric(14,3) CHECK (low_stock_threshold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, product_variant_id),
  CHECK (reserved_quantity <= on_hand_quantity),
  CONSTRAINT inventory_levels_variant_tenant_fk
    FOREIGN KEY (product_variant_id, organization_id)
    REFERENCES product_variants (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  order_line_id uuid,
  product_variant_id uuid NOT NULL,
  inventory_lot_id uuid,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  status reservation_status NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text CHECK (release_reason IN ('CANCELLED', 'EXPIRED', 'MANUAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CHECK (
    (status = 'ACTIVE' AND expires_at IS NOT NULL AND released_at IS NULL)
    OR status <> 'ACTIVE'
  ),
  CONSTRAINT stock_reservations_order_tenant_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT stock_reservations_line_tenant_fk
    FOREIGN KEY (order_line_id, organization_id)
    REFERENCES order_lines (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT stock_reservations_variant_tenant_fk
    FOREIGN KEY (product_variant_id, organization_id)
    REFERENCES product_variants (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT stock_reservations_lot_tenant_fk
    FOREIGN KEY (inventory_lot_id, organization_id)
    REFERENCES inventory_lots (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS stock_reservations_expiry_idx
  ON stock_reservations (organization_id, expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_variant_id uuid NOT NULL,
  inventory_lot_id uuid,
  movement_type stock_movement_type NOT NULL,
  quantity_delta numeric(14,3) NOT NULL DEFAULT 0,
  reserved_quantity_delta numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost_minor bigint CHECK (unit_cost_minor >= 0),
  reference_type text CHECK (reference_type IN ('ORDER', 'PURCHASE', 'RETURN', 'ADJUSTMENT')),
  reference_id uuid,
  reason text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_delta <> 0 OR reserved_quantity_delta <> 0),
  CONSTRAINT stock_movements_variant_tenant_fk
    FOREIGN KEY (product_variant_id, organization_id)
    REFERENCES product_variants (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_lot_tenant_fk
    FOREIGN KEY (inventory_lot_id, organization_id)
    REFERENCES inventory_lots (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS stock_movements_variant_history_idx
  ON stock_movements (organization_id, product_variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx
  ON stock_movements (organization_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('BANK_TRANSFER', 'MERCADO_PAGO', 'CASH_ON_DELIVERY', 'CARD', 'OTHER')),
  status payment_status NOT NULL DEFAULT 'PENDING',
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  processing_fee_minor bigint CHECK (processing_fee_minor >= 0),
  paid_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  external_reference text,
  proof_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CHECK ((status <> 'CONFIRMED') OR confirmed_at IS NOT NULL),
  CONSTRAINT payments_order_tenant_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES orders (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (organization_id, order_id, status);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments (organization_id, created_at)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  delivery_mode delivery_mode NOT NULL,
  status shipment_status NOT NULL DEFAULT 'PENDING',
  recipient_address jsonb,
  carrier_name text,
  tracking_code text,
  charged_amount_minor bigint NOT NULL DEFAULT 0 CHECK (charged_amount_minor >= 0),
  business_cost_minor bigint CHECK (business_cost_minor >= 0),
  expected_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, order_id),
  CHECK (delivered_at IS NULL OR dispatched_at IS NULL OR delivered_at >= dispatched_at),
  CONSTRAINT shipments_order_tenant_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES orders (id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS shipments_work_queue_idx
  ON shipments (organization_id, status, expected_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (before_value IS NULL OR jsonb_typeof(before_value) IN ('object', 'array')),
  CHECK (after_value IS NULL OR jsonb_typeof(after_value) IN ('object', 'array'))
);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_history_idx
  ON audit_logs (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_history_idx
  ON audit_logs (organization_id, entity_type, entity_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_super_admin_mfa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'platform_user_roles' AND NEW.role = 'SUPER_ADMIN' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM app_users
      WHERE id = NEW.user_id
        AND two_factor_enabled = true
        AND two_factor_secret_encrypted IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SUPER_ADMIN requires enrolled MFA'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'app_users' AND NEW.two_factor_enabled = false THEN
    IF EXISTS (
      SELECT 1 FROM platform_user_roles
      WHERE user_id = NEW.id AND role = 'SUPER_ADMIN'
    ) THEN
      RAISE EXCEPTION 'MFA cannot be disabled for a SUPER_ADMIN'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'app_users', 'organization_memberships',
    'product_categories', 'category_attribute_definitions', 'suppliers',
    'products', 'product_media', 'product_variants', 'customers', 'orders',
    'order_lines', 'inventory_lots', 'inventory_levels', 'stock_reservations',
    'payments', 'shipments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'set_updated_at_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      'set_updated_at_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS enforce_super_admin_mfa_on_role ON platform_user_roles;
CREATE TRIGGER enforce_super_admin_mfa_on_role
  BEFORE INSERT OR UPDATE ON platform_user_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_super_admin_mfa();

DROP TRIGGER IF EXISTS enforce_super_admin_mfa_on_user ON app_users;
CREATE TRIGGER enforce_super_admin_mfa_on_user
  BEFORE UPDATE OF two_factor_enabled, two_factor_secret_encrypted ON app_users
  FOR EACH ROW EXECUTE FUNCTION enforce_super_admin_mfa();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['stock_movements', 'audit_logs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'reject_mutation_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation()',
      'reject_mutation_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE stock_movements IS
  'Append-only ledger. Inventory levels and lot balances are updated in the same database transaction.';
COMMENT ON TABLE audit_logs IS
  'Append-only security and operational audit trail.';
COMMENT ON COLUMN user_invitations.token_hash IS
  'Hash of a one-time activation secret; never persist the plaintext token.';
COMMENT ON COLUMN app_users.password_hash IS
  'Algorithm-tagged password hash only; plaintext passwords never reach persistence.';
COMMENT ON COLUMN app_users.two_factor_secret_encrypted IS
  'Application-layer encrypted TOTP secret. Platform super-admins must have MFA enabled.';

COMMIT;
