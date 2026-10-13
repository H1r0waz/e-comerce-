# Arquitectura técnica propuesta

## Propósito y alcance inicial

El producto es un SaaS multi-comercio para gestionar pedidos digitales, ventas, inventario, clientes, compras, pagos y envíos. El primer perfil es belleza y cuidado personal en Argentina: los pedidos ingresan manualmente desde WhatsApp e Instagram y los pagos/envíos se confirman manualmente.

La arquitectura debe mantener una operación diaria sencilla para cada comercio, pero conservar trazabilidad de costos, lotes, vencimientos y movimientos de inventario. Se priorizan aislamiento entre comercios, autorización de mínimo privilegio y auditoría de operaciones sensibles.

## Stack y monorepo

Se propone un monorepo TypeScript gestionado con `pnpm` workspaces y Turborepo:

```text
apps/
  web/                 # Next.js: aplicación responsive de operación y superadmin
  api/                 # NestJS: API REST, reglas de negocio y jobs HTTP
packages/
  db/                  # Prisma schema, migraciones, seeds y cliente tipado
  domain/              # Tipos, invariantes y servicios de dominio sin framework
  api-contracts/       # DTOs, esquemas Zod y cliente HTTP generado/manual
  auth/                # Helpers de autorización, sesiones y políticas
  config/              # Configuración compartida de TypeScript, ESLint y testing
docs/
  architecture.md
  domain-model.md
```

### Aplicación web (`apps/web`)

- Next.js (App Router), React y TypeScript.
- Diseño responsive, priorizando móvil para pedidos y alertas; escritorio para reportes/configuración.
- Consume exclusivamente la API. No accede directamente a la base de datos.
- Mantiene una consola de superadministración separada por rutas, políticas y navegación de la operación de cada comercio.

### API (`apps/api`)

- NestJS con API REST versionada bajo `/v1`.
- Módulos independientes: identidad, organizaciones, catálogo, inventario, pedidos, pagos, envíos, clientes, proveedores/compras, promociones, reportes, notificaciones y auditoría.
- Validación de entrada con DTOs/esquemas compartidos; la validación del navegador nunca reemplaza la validación de servidor.
- OpenAPI publicado para documentar y verificar los contratos.
- Procesos asíncronos: worker separado o proceso de jobs para vencer reservas, generar alertas y, en una etapa posterior, integraciones.

### Persistencia e infraestructura

- PostgreSQL como fuente de verdad transaccional.
- Prisma para migraciones y acceso tipado a datos. Las operaciones críticas de stock usan transacciones SQL y bloqueos adecuados; no dependen de lecturas previas no atómicas.
- Redis para colas de trabajos, rate limiting, caché efímera y control de idempotencia; nunca como fuente de verdad de stock/pedidos.
- Almacenamiento de objetos compatible con S3 para fotos de productos y comprobantes. Los archivos se sirven mediante URLs firmadas de corta duración.
- Email transaccional para invitaciones, restablecimiento de contraseña y alertas futuras. Integraciones con Mercado Pago, correo y WhatsApp quedan detrás de adaptadores, fuera del MVP operativo.

## Límites de módulos

| Módulo | Responsabilidad | No debe hacer |
| --- | --- | --- |
| Identidad y acceso | usuarios, sesiones, MFA, invitaciones, roles y políticas | modificar datos operativos |
| Organizaciones | comercio, sucursales futuras, configuración regional y pertenencias | decidir reglas de stock |
| Catálogo | categorías, atributos, productos, variantes, precios base | alterar existencias |
| Inventario | lotes, costos, reservas, movimientos y disponibilidad | confirmar pagos |
| Pedidos | líneas, descuentos, estado comercial y notas | asumir cómo se cobra o entrega |
| Pagos | pagos parciales, confirmación manual, comisiones y reembolsos | despachar envíos |
| Envíos | modalidad, dirección, costo, tracking y entrega | modificar cobros |
| Compras | proveedores, órdenes opcionales y recepción | crear variantes sin Catálogo |
| Promociones | reglas, combos, cupones y descuentos aplicados | editar pedidos finalizados sin auditoría |
| Reportes | consultas agregadas de lectura | recalcular historia operativa de forma destructiva |
| Notificaciones | alertas y preferencias | cambiar estados sin comando explícito y auditado |
| Auditoría | eventos inmutables de acciones relevantes | ser reemplazada por logs técnicos |

La comunicación entre módulos ocurre a través de servicios de aplicación/comandos y eventos de dominio. Por ejemplo, `PaymentConfirmed` puede solicitar a Pedidos que recalcule el estado y a Inventario que convierta una reserva en salida, dentro de una transacción o mediante una estrategia outbox cuando atraviese procesos asíncronos.

## Multi-tenancy y autorización

El modelo es **base de datos compartida, esquema compartido y fila aislada por organización**. Toda entidad de negocio posee `organization_id` no nulo, incluso las tablas de relación. Se usará UUID/ULID como identificador externo para no exponer secuencias.

Reglas obligatorias:

1. La organización activa proviene de la sesión y la pertenencia (`organization_memberships`), nunca de un `organizationId` confiado al cliente.
2. Cada repositorio/consulta aplica `organization_id` de forma centralizada. No se permiten búsquedas de recursos por ID sin scope de organización.
3. Las claves únicas de negocio incluyen `organization_id`: por ejemplo, `(organization_id, sku)` y `(organization_id, phone_normalized)` cuando corresponda.
4. Se habilita Row Level Security (RLS) en PostgreSQL como defensa adicional. La API establece el contexto de organización dentro de cada transacción; las políticas impiden lectura/escritura de otra organización aun ante una consulta defectuosa.
5. El superadministrador es una capacidad de plataforma explícita, separada de una membresía comercial. Sus accesos de soporte requieren motivo, auditoría reforzada y, si es posible, modo de impersonación de solo lectura con sesión visible.
6. Las cargas de archivos se autorizan antes de emitir una URL firmada y se almacenan bajo prefijos por organización; se valida tipo, tamaño y contenido.

## Roles iniciales

- `platform_superadmin`: crea/suspende comercios y administradores; MFA obligatorio; no accede a datos comerciales sin un flujo auditado de soporte.
- `owner`: administración completa de su comercio, usuarios y configuración.
- `sales`: clientes, pedidos y registro de pagos conforme a permisos.
- `inventory_fulfillment`: catálogo operativo, movimientos autorizados, preparación y despacho.
- `viewer`: lectura de panel/reportes autorizados.

El control debe ser por permisos, no únicamente por nombres de rol, para permitir evolución. Ejemplos: `orders.create`, `payments.confirm`, `inventory.adjust`, `reports.read`, `users.manage`.

## Seguridad desde el diseño

- Contraseñas con Argon2id, parámetros actualizables; nunca se almacenan ni registran en texto plano.
- Alta manual mediante invitación de un solo uso y vencimiento. El usuario define su contraseña; la alternativa de contraseña temporal debe forzar cambio, vencer y no poder revelarse posteriormente.
- MFA TOTP obligatorio para superadministrador y configurable/altamente recomendado para owners. Códigos de recuperación cifrados/hash según corresponda.
- Sesiones con cookies `HttpOnly`, `Secure`, `SameSite=Lax` (o protección CSRF equivalente si se requiere cross-site); rotación de sesión en login/cambio de privilegio, expiración y revocación de sesiones.
- Rate limit y protección contra fuerza bruta en autenticación, reset, invitaciones y endpoints costosos. Mensajes de login sin enumerar cuentas.
- Validación estricta en API, consultas parametrizadas mediante ORM/SQL seguro, encabezados de seguridad y CSP. Sanitizar contenido mostrado y rechazar cargas inseguras.
- Secretos en gestor de secretos/variables de entorno; no en repositorio, payloads, logs o métricas. Rotación documentada.
- TLS obligatorio, backups cifrados y restauraciones verificadas. Retención mínima de logs y datos personales.
- Eventos de auditoría append-only para login, cambios de roles, pedidos, pagos, stock, costos, ajustes y exportaciones.
- Idempotency keys en creación de pedidos, confirmación de pagos y comandos de inventario para impedir duplicaciones por reintentos.

## Consistencia e inventario

El stock no es un campo editable sin historial. La disponibilidad se deriva de movimientos confirmados y reservas activas:

```text
disponible = ingresos vendibles - salidas confirmadas - reservas activas
```

Para rendimiento puede mantenerse una proyección de saldo por variante/lote, actualizada en la misma transacción que el movimiento. Cada comando de reserva, liberación, venta, devolución o ajuste debe:

1. autenticar y autorizar al actor;
2. verificar el scope de organización;
3. bloquear la proyección de stock afectada (`SELECT ... FOR UPDATE` o actualización condicional);
4. comprobar disponibilidad y vencimiento;
5. insertar movimiento inmutable y actualizar proyección en una transacción;
6. emitir evento/outbox y auditoría.

Las entradas de compra crean capas de costo/lote. La asignación de costo para venta aplica FIFO sobre capas vendibles, sin duplicar el producto que ve el usuario. Las reservas tienen `expires_at`, se liberan mediante job idempotente y no pueden reservar lotes vencidos.

## API REST inicial

Los endpoints se versionan bajo `/v1`, usan JSON, fechas ISO 8601 en UTC y montos como enteros en centavos para evitar errores de punto flotante. Para ARS se visualizan dos decimales, aunque usualmente se operen enteros. Las respuestas de listado se paginan con cursor.

### Identidad y plataforma

```text
POST   /v1/auth/login
POST   /v1/auth/logout
POST   /v1/auth/invitations/accept
POST   /v1/auth/password/forgot
POST   /v1/auth/password/reset
POST   /v1/auth/mfa/verify
GET    /v1/me
POST   /v1/platform/organizations
GET    /v1/platform/organizations
PATCH  /v1/platform/organizations/{organizationId}
```

### Operación por comercio

```text
GET/POST       /v1/organizations/{organizationId}/users
PATCH          /v1/organizations/{organizationId}/users/{userId}
GET/POST       /v1/organizations/{organizationId}/categories
GET/POST       /v1/organizations/{organizationId}/products
GET/PATCH      /v1/organizations/{organizationId}/products/{productId}
POST           /v1/organizations/{organizationId}/products/{productId}/variants
GET            /v1/organizations/{organizationId}/inventory/availability
GET            /v1/organizations/{organizationId}/inventory/movements
POST           /v1/organizations/{organizationId}/inventory/adjustments
GET/POST       /v1/organizations/{organizationId}/customers
GET/PATCH      /v1/organizations/{organizationId}/customers/{customerId}
GET/POST       /v1/organizations/{organizationId}/suppliers
GET/POST       /v1/organizations/{organizationId}/purchase-receipts
GET/POST       /v1/organizations/{organizationId}/orders
GET/PATCH      /v1/organizations/{organizationId}/orders/{orderId}
POST           /v1/organizations/{organizationId}/orders/{orderId}/transitions
POST           /v1/organizations/{organizationId}/orders/{orderId}/payments
POST           /v1/organizations/{organizationId}/orders/{orderId}/shipments
PATCH          /v1/organizations/{organizationId}/shipments/{shipmentId}
GET/POST       /v1/organizations/{organizationId}/promotions
GET            /v1/organizations/{organizationId}/dashboard
GET            /v1/organizations/{organizationId}/reports/sales
GET            /v1/organizations/{organizationId}/reports/inventory
GET            /v1/organizations/{organizationId}/audit-events
```

El `organizationId` de la ruta es útil para URL y selección de contexto, pero la API debe verificar que coincide con una membresía válida. Los comandos sensibles incluyen `Idempotency-Key`; las transiciones reciben una acción explícita (por ejemplo `{ "action": "MARK_PREPARING" }`) y no permiten saltos arbitrarios de estado.

## Evolución y despliegue

- Inicio: una API modular monolítica y un worker, ambos desplegados de forma independiente. Esto reduce complejidad sin mezclar límites de dominio.
- Las integraciones externas se implementan como adaptadores y eventos, de forma que WhatsApp, Mercado Pago, correos y logística no contaminen el núcleo.
- Se incorporarán servicios separados únicamente cuando existan métricas de carga, equipos o límites de despliegue que lo justifiquen.
- CI ejecuta typecheck, lint, tests unitarios/de integración y migraciones contra PostgreSQL efímero. Los flujos de inventario, tenant isolation y autorización se prueban como casos críticos.
