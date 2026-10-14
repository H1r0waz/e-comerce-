# Despliegue operativo: Neon + Vercel

Esta guía describe cómo publicar la versión actual de Comerciar sin exponer
credenciales. No contiene valores reales de conexión ni sustituye el
checklist de seguridad en `docs/quality/security-deployment-checklist.md`.

## Alcance y prerequisitos

La solución se despliega como **dos proyectos Vercel** que comparten el mismo
repositorio:

| Proyecto | Directorio raíz en Vercel | Función |
| --- | --- | --- |
| `comerciar-api` | `apps/api` | API Node.js y acceso a Neon. |
| `comerciar-dashboard` | `apps/web` | Panel Next.js y proxy same-origin hacia la API. |

Se necesita acceso de administrador al proyecto Neon objetivo, a los dos
proyectos Vercel y al repositorio. Usar una rama Neon distinta para desarrollo
o previews; un preview nunca debe usar la base ni los secretos de producción.

Antes de desplegar, validar el código que se publicará:

```bash
cd apps/api && npm ci && npm run typecheck && npm run build
cd ../../packages/database && npm ci && npm run typecheck && npm run build
cd ../../apps/web && npm ci && npm run build
cd ../.. && ./apps/api/node_modules/.bin/tsx --test tests/api/tenant-boundary.test.ts tests/domain/commerce-policy.spec.test.ts
```

## 1. Preparar Neon

1. Elegir la rama Neon destino. Para producción, usar la rama asignada a
   producción; para validar cambios, crear una rama desde ella.
2. Aplicar, en orden, las migraciones versionadas:
   - `database/migrations/0001_initial.sql`
   - `database/migrations/0002_auth_session_context.sql`
3. Ejecutarlas con una conexión **directa/no agrupada** (`DATABASE_URL_UNPOOLED`),
   preferentemente mediante el proceso de migraciones aprobado por el equipo.
   No ejecutar cambios de esquema manuales que no estén versionados en
   `database/migrations`.
4. Verificar que ambas migraciones terminaron correctamente antes de apuntar
   tráfico de la aplicación a la rama. Como mínimo, comprobar que existen
   `organizations`, `app_users`, `auth_sessions` y las columnas de contexto
   de sesión agregadas por la segunda migración.
5. Obtener una URL **agrupada** (host con `-pooler`) de esa misma rama para el
   runtime. Esa URL será `DATABASE_URL` del proyecto API. La URL directa no se
   instala en Vercel Runtime.

La API usa `pg` y un pool compatible con funciones Vercel; la conexión agrupada
evita agotar conexiones ante concurrencia. Guardar ambas URLs solo en el gestor
de secretos elegido, nunca en el repositorio, tickets, capturas ni chat.

## 2. Configurar el proyecto API en Vercel

Crear o importar un proyecto desde el repositorio con estos valores:

- Nombre sugerido: `comerciar-api`.
- **Root Directory:** `apps/api`.
- Framework: dejar que Vercel detecte el proyecto Node.js.
- Rama de producción: `main` (o la rama de lanzamiento que el equipo defina).

En **Settings → Environment Variables**, cargar los siguientes valores para el
entorno correspondiente. Marcar las variables sensibles como secret/protegidas
en la configuración de Vercel.

| Variable | Producción | Notas |
| --- | --- | --- |
| `NODE_ENV` | `production` | No es secreta. |
| `DATABASE_URL` | URL agrupada de Neon de producción | Secreta; usar solo en la API. |
| `SESSION_SECRET` | valor aleatorio único de al menos 32 caracteres | Secreto; no reutilizar entre entornos. |
| `MFA_ENCRYPTION_KEY` | valor base64url que decodifique exactamente a 32 bytes | Secreto; perderlo impide descifrar TOTP existentes. |
| `CORS_ORIGIN` | origen HTTPS exacto del panel, sin ruta final | Ej.: `https://panel.ejemplo.com`. |

Generar las dos claves de aplicación localmente y cargarlas directamente en
Vercel, sin pegarlas en una terminal compartida ni enviarlas por chat:

```bash
openssl rand -base64 48
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

El primer resultado puede utilizarse como `SESSION_SECRET` y el segundo como
`MFA_ENCRYPTION_KEY`. Conservarlos en un gestor de secretos con control de
acceso. No rotar `MFA_ENCRYPTION_KEY` sin un procedimiento de re-cifrado de los
secretos TOTP: la rotación directa invalidaría el inicio MFA ya configurado.

El archivo `apps/api/vercel.json` ya expone `GET /health` y enruta `/v1/*` a la
función. Tras el despliegue, comprobar desde un navegador o una herramienta
HTTP:

```text
GET https://<dominio-api>/health  ->  200 y status: ok
```

No considerar publicado el API si la comprobación de salud falla. Consultar los
logs de esa implementación, no los del panel, para diagnosticar variables de
entorno o errores de conexión.

## 3. Configurar el panel web en Vercel

Crear o actualizar el proyecto del panel con:

- Nombre sugerido: `comerciar-dashboard`.
- **Root Directory:** `apps/web`.
- Rama de producción: la misma rama de lanzamiento del API.

Configurar estas variables:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `/api/backend` |
| `COMMERCIAR_API_URL` | origen HTTPS del API, sin ruta, query, credenciales ni fragmento |

`COMMERCIAR_API_URL` es una variable de servidor: no lleva el prefijo
`NEXT_PUBLIC_` y no se expone al navegador. El panel reenvía solo rutas
`/v1/*` mediante `/api/backend`; con este diseño, la cookie de sesión se queda
en el origen del panel y no depende de cookies de terceros.

Una vez elegido el dominio final del panel, volver al proyecto API y establecer
`CORS_ORIGIN` con ese origen exacto. Si se usan dominios distintos para preview,
usar una configuración de API y un secreto propios para preview; no ampliar
`CORS_ORIGIN` de producción indiscriminadamente.

## 4. Orden seguro de publicación

1. Probar migraciones en una rama Neon y revisar el resultado.
2. Aplicar las mismas migraciones en la rama Neon de producción durante una
   ventana controlada.
3. Desplegar el API con las variables de producción y comprobar `/health`.
4. Desplegar el panel con el origen definitivo del API.
5. Actualizar `CORS_ORIGIN` si el dominio definitivo del panel cambió y volver
   a desplegar el API.
6. Probar el flujo completo desde el panel: sesión inexistente, inicio de
   sesión, verificación MFA cuando aplique, cierre de sesión y acceso al
   dashboard.
7. Revisar logs de ambos proyectos y el checklist de seguridad antes de enviar
   tráfico real.

Para un cambio de base de datos futuro, mantener el despliegue compatible en
dos fases: primero una migración aditiva y verificada; después el código que la
usa. Tener identificada la versión Vercel anterior para rollback. Un rollback
del código no revierte automáticamente una migración; por eso los cambios
destructivos requieren un plan de restauración probado.

## Superusuario inicial: estado actual y operación segura

La base exige MFA TOTP antes de asignar el rol `SUPER_ADMIN`. Es una protección
intencional: no se debe insertar un superusuario manualmente por SQL, ni
desactivar temporalmente el trigger, ni guardar una contraseña o semilla TOTP
en texto plano para sortearlo.

La API actual expone inicio de sesión, aceptación de invitaciones, consulta y
cierre de sesión, y verificación MFA. Aún **no** expone una ruta administrativa
ni una interfaz de aprovisionamiento para crear el primer comercio/superusuario
o para completar la inscripción MFA inicial. Por lo tanto, el alta inicial no
está lista para operar en producción aunque el esquema y la verificación MFA
ya estén preparados.

Antes de habilitar usuarios reales, implementar y revisar un flujo de bootstrap
de una sola vez con estas propiedades mínimas:

1. Requiere una autorización fuera de banda y de un único operador de
   plataforma; no existe como endpoint público reutilizable.
2. Crea organización, usuario y membresía en una transacción, sin asignar el
   rol `SUPER_ADMIN` hasta que el TOTP haya sido confirmado.
3. Presenta la URI/QR TOTP únicamente por TLS y una vez; cifra la semilla con
   `MFA_ENCRYPTION_KEY` y almacena solo hashes de códigos de recuperación.
4. Confirma un código TOTP válido antes de insertar `SUPER_ADMIN`; luego revoca
   la capacidad de bootstrap y registra una auditoría sin secretos.
5. Emite una invitación de un solo uso para los siguientes usuarios. Nunca
   envía ni persiste una contraseña temporal en texto plano.

Hasta que exista ese flujo, limitar el despliegue a validación técnica
(`/health`, build y revisión de migraciones) y no declarar el sistema listo
para altas reales. La persona que implemente el bootstrap debe añadir pruebas
de imposibilidad de repetirlo, MFA obligatorio, auditoría y aislamiento entre
organizaciones.

## Verificación posterior y operación

- El endpoint `/health` debe responder 200, pero no confirma que la base esté
  migrada ni que las credenciales funcionen; el flujo de autenticación y
  dashboard deben probarse cuando el bootstrap esté disponible.
- Verificar que una URL de producción usa HTTPS y que las respuestas
  autenticadas no se almacenan en caché.
- Mantener responsables de alertas, restauración y rotación de secretos. Ante
  sospecha de exposición, revocar sesiones y rotar primero las credenciales
  afectadas, preservando logs y auditoría.
- No utilizar los mismos secretos ni la misma rama Neon entre Development,
  Preview y Production.

Ver también:

- `docs/quality/security-deployment-checklist.md`
- `docs/security/implementation-plan.md`
- `README.md`
