# Comerciar

Comerciar es una plataforma web multi-comercio para gestionar ventas digitales, inventario, clientes y operaciones. El primer caso de uso es belleza y cuidado personal en Argentina, pero el modelo está preparado para otros rubros.

## Funcionalidades actuales

- Pedidos manuales de WhatsApp e Instagram, con pago, preparación y envío como estados independientes.
- Catálogo por comercio: categorías, variantes configurables, precios, lotes y vencimientos opcionales.
- Inventario con reservas temporales, capas de costo FIFO, alertas de stock y trazabilidad.
- Pagos manuales o parciales, envíos y reportes básicos de operación.
- Aislamiento multi-tenant por comercio, roles, auditoría y sesiones seguras.
- Acceso mediante invitación, contraseñas hasheadas, MFA TOTP para superadministración y códigos de recuperación.

## Arquitectura

| Componente | Ubicación | Responsabilidad |
| --- | --- | --- |
| Panel web | `apps/web` | Next.js, autenticación visual y dashboard. |
| API | `apps/api` | Node.js/TypeScript, sesiones, MFA, dashboard y reglas de dominio. |
| Base de datos | `database/migrations` | Esquema PostgreSQL multi-tenant para Neon. |
| Contratos | `packages/contracts` | Tipos compartidos entre módulos. |
| Persistencia | `packages/database` | Puertos y contratos de acceso a PostgreSQL. |

La interfaz usa un proxy same-origin (`/api/backend`) para hablar con la API. Así las cookies de sesión permanecen seguras y no se usan tokens en `localStorage`.

## Base de datos

El proyecto usa [Neon](https://neon.tech/) con PostgreSQL. Las migraciones se versionan en `database/migrations`:

1. `0001_initial.sql`: organizaciones, catálogo, inventario, ventas, pagos, envíos y auditoría.
2. `0002_auth_session_context.sql`: contexto de comercio y MFA para las sesiones.

Probá las migraciones primero en una rama de Neon. Para la aplicación usá la URL agrupada `DATABASE_URL`; reservá `DATABASE_URL_UNPOOLED` para migraciones.

## Desarrollo local

Requisitos: Node.js 20.9+ y npm 10+.

```bash
# API
cd apps/api
npm install
cp .env.example .env
npm run dev

# En otra terminal, panel web
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Configurá los secretos solo en tu gestor de secretos o archivos ignorados por Git. Nunca los subas al repositorio.

## Variables de entorno

API (`apps/api`):

- `DATABASE_URL`: URL agrupada de Neon para la aplicación.
- `SESSION_SECRET`: secreto de al menos 32 caracteres.
- `MFA_ENCRYPTION_KEY`: clave base64url de 32 bytes para cifrar secretos TOTP.
- `CORS_ORIGIN`: origen del panel web.

Web (`apps/web`):

- `NEXT_PUBLIC_API_URL=/api/backend`
- `COMMERCIAR_API_URL`: URL interna del API; se usa solo en el servidor.

## Verificación

```bash
cd apps/api && npm run typecheck && npm run build
cd ../../packages/database && npm run typecheck && npm run build
cd ../../apps/web && npm run build
cd ../.. && ./apps/api/node_modules/.bin/tsx --test tests/api/tenant-boundary.test.ts tests/domain/commerce-policy.spec.test.ts
```

## Despliegue

El API está preparado como Vercel Function y el panel como proyecto Next.js. Antes de producción:

- aplicar las migraciones en la rama objetivo de Neon;
- crear dos proyectos Vercel que importen este repositorio, uno con **Root Directory** `apps/api` y otro con **Root Directory** `apps/web`;
- dejar los comandos de instalación y compilación por defecto de cada proyecto (`npm install` y `npm run build`), sin directorio de salida personalizado;
- cargar las variables de entorno en Vercel;
- publicar primero el API, comprobar `GET /health` y configurar después `COMMERCIAR_API_URL` en el panel;
- crear el superusuario inicial con MFA;
- verificar login, MFA, cierre de sesión y aislamiento entre comercios.

### Variables por proyecto

| Proyecto | Variables de producción |
| --- | --- |
| API (`apps/api`) | `NODE_ENV=production`, `DATABASE_URL` agrupada de Neon, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `CORS_ORIGIN=https://<panel>` |
| Panel (`apps/web`) | `NEXT_PUBLIC_API_URL=/api/backend`, `COMMERCIAR_API_URL=https://<api>` |

Los secretos se cargan únicamente en Vercel/Neon. Para las vistas previas, usá una base y secretos aislados o mantenelas deshabilitadas hasta contar con ese entorno; nunca reutilices ni expongas valores de producción.

Consultá `docs/architecture.md`, `docs/security/implementation-plan.md` y `docs/quality/` para más detalle.
