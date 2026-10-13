# Database domain model

This package defines the database-agnostic TypeScript schema for the commerce platform. It deliberately has no ORM or live database dependency.

Every operational entity has `organizationId`; persistence adapters must enforce that field in every read and write. Inventory movements and audit logs are append-only records so stock, cost layers, and sensitive actions are traceable.

Run `npm run typecheck` from this directory after installing its development dependencies.
