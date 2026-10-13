# Commerce API

Initial TypeScript API for the multi-tenant sales and inventory platform. It uses only Node's built-in HTTP server, so it starts without a database. Domain persistence is represented by the schema in `../../packages/database` and must be provided by repository adapters in later iterations.

## Run locally

From this directory:

```bash
npm install
npm run dev
```

The service listens on `http://127.0.0.1:3001` by default. Use `cp .env.example .env` and export/load those variables with your preferred environment loader. Do not commit `.env` files.

## Endpoints

```bash
curl http://127.0.0.1:3001/health
curl -H 'x-organization-id: demo-org' -H 'x-user-id: owner-1' http://127.0.0.1:3001/v1/modules
```

`/health` is public. Tenant routes currently use validated request headers as a development placeholder; after authentication is added, those identifiers must come only from a verified session/JWT claim, never from the request body or arbitrary headers.

## Security baseline

- Production refuses to start without a `SESSION_SECRET` of at least 32 characters.
- The request boundary sets defensive browser headers and disables response caching.
- Tenant repository contracts require an organization context for every read/write.
- `organizationId` belongs on every operational database entity, and audit records are immutable/append-only.
- Passwords must be stored as hashes by the upcoming authentication adapter; never log or persist plaintext credentials.

## Validation

Run `npm run typecheck` or `npm run build` after dependencies are installed.
