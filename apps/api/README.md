# Commerce API

TypeScript API for the multi-tenant sales and inventory platform. It exposes authenticated HTTP endpoints backed by Neon PostgreSQL when `DATABASE_URL` and `MFA_ENCRYPTION_KEY` are configured. Without those values it only exposes the health check, never an in-memory fallback.

For Vercel, deploy this directory as a separate API project. `api/index.ts` is a Node.js Function entry point; `vercel.json` rewrites `/v1/*` and `/health` to it. The web project should access it through its same-origin `/api/backend` proxy so session cookies never become third-party cookies.

## Despliegue en Vercel

Importá el mismo repositorio de GitHub en un proyecto separado, con **Root Directory** en `apps/api`. Dejá que Vercel detecte Node.js y use los comandos por defecto (`npm install` y `npm run build`); no hace falta indicar un directorio de salida. El proyecto declara Node.js 22 mediante `package.json` y la compilación valida tanto el servicio como la Function `api/index.ts`.

Configurá estas variables en el proyecto de API, sin guardarlas en Git:

- `NODE_ENV=production`
- `DATABASE_URL`: URL agrupada (pooled) de la rama de producción de Neon.
- `SESSION_SECRET`: valor aleatorio de al menos 32 caracteres.
- `MFA_ENCRYPTION_KEY`: clave base64url de exactamente 32 bytes.
- `CORS_ORIGIN`: origen HTTPS exacto del panel web, sin una ruta final.

Aplicá las migraciones de Neon antes de publicar la API. Luego verificá `GET https://<tu-api>/health`; debe responder `status: "ok"`. El panel se configura después con ese origen en `COMMERCIAR_API_URL`.

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
curl -X POST http://127.0.0.1:3001/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"dueno@ejemplo.com","password":"una-clave-segura"}'
```

`/health` es público. Las rutas autenticadas usan una cookie `HttpOnly` de sesión: la organización y los permisos se obtienen de la sesión, no de encabezados ni datos que aporte el navegador. La autenticación requiere las variables de entorno y las migraciones aplicadas; en un entorno nuevo todavía hay que aprovisionar el superusuario inicial.

## Security baseline

- Production refuses to start without a `SESSION_SECRET` of at least 32 characters.
- The request boundary sets defensive browser headers and disables response caching.
- Tenant repository contracts require an organization context for every read/write.
- `organizationId` belongs on every operational database entity, and audit records are immutable/append-only.
- Passwords must be stored as hashes by the upcoming authentication adapter; never log or persist plaintext credentials.

## Validation

Run `npm run typecheck` or `npm run build` after dependencies are installed.
