# Database domain model

This package contains the TypeScript persistence contract and the PostgreSQL
schema for the commerce platform. `database/migrations/0001_initial.sql` is
the source of truth for the first Lakebase Postgres (Neon) schema.

Every operational record is scoped by `organization_id`. Related tenant data
uses composite foreign keys such as `(product_id, organization_id)`, which
prevents a record in one commerce from referencing a record in another even if
an application query is incorrect. Repository implementations must still bind
every read and write to an explicit `TenantContext` and use parameterized SQL.

Important persistence rules:

- Monetary values are stored as integer minor units (`*_minor`), never floats.
- `stock_movements` and `audit_logs` are append-only at the database level.
- Inventory levels, lot balances and movements must be changed in one database
  transaction; the movement ledger remains the traceable source of change.
- Authentication is self-managed so mandatory MFA can be enforced for the
  platform superuser. `app_users` stores only an Argon2id password hash,
  encrypted TOTP secret and hashed recovery codes; sessions and reset links
  use opaque token hashes. Invitation records also store only a one-time token
  hash.

Run migrations with a direct, non-pooler `DATABASE_URL_UNPOOLED`; use the
pooled `DATABASE_URL` for normal app traffic. Test each migration on a Neon
branch before applying it to the production branch.

Run `npm run typecheck` from this directory after installing dependencies.
