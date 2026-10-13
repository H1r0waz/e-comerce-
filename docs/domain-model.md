# Modelo de dominio

## Convenciones

- Todas las entidades operativas incluyen `id`, `organization_id`, `created_at`, `updated_at` y, cuando aplica, `created_by`.
- Los importes monetarios se almacenan como `amount_minor` entero y `currency` ISO 4217 (`ARS` inicialmente).
- Las fechas se almacenan en UTC. La organización define `timezone` (`America/Argentina/Buenos_Aires` inicialmente) para mostrar fechas y calcular alertas.
- Los registros históricos, movimientos, pagos y auditoría no se borran ni se modifican destructivamente; se compensan con nuevos eventos o estados.
- `organization_id` no es opcional en entidades comerciales y se aplica en todas las claves foráneas y consultas.

## Identidad y tenancy

```text
PlatformUser
  └─ OrganizationMembership ── Organization
                                    ├─ OrganizationSettings
                                    ├─ User roles/permissions
                                    └─ datos comerciales
```

| Entidad | Datos clave | Notas |
| --- | --- | --- |
| `platform_users` | email normalizado, password_hash, MFA, estado | Identidad global; email único globalmente. |
| `organizations` | nombre, estado, timezone, moneda, datos fiscales opcionales | Comercio/tenant. `active`, `suspended`, `archived`. |
| `organization_memberships` | user_id, organization_id, rol, estado | Un usuario puede pertenecer a más de un comercio. Único por usuario+organización. |
| `organization_settings` | plazos de reserva, alertas, pagos, envíos, reglas | Configurable por owner; valores seguros por defecto. |
| `invitations` | email, organization_id, rol, token_hash, expires_at, accepted_at | Token aleatorio, de un uso; nunca guardar token legible. |
| `audit_events` | actor, organización, acción, recurso, antes/después, motivo, IP/metadatos | Append-only y con retención definida. |

`platform_superadmin` se modela como capacidad de plataforma. Su acción sobre organizaciones produce `audit_events` reforzados. No debe utilizarse para ejecutar acciones ordinarias de una tienda.

## Catálogo configurable

```text
CategoryTemplate ──< CategoryAttribute >── AttributeDefinition
        │
        └──< Product ──< ProductVariant
                              └── stock, precio y código propios
```

| Entidad | Datos clave | Reglas |
| --- | --- | --- |
| `categories` | nombre, padre opcional, activa | Por comercio; se puede iniciar desde plantillas de belleza. |
| `attribute_definitions` | nombre, código, tipo (`text`, `select`, `number`, `boolean`) | Definición reutilizable por organización. |
| `category_attributes` | categoría, atributo, uso (`variant`, `informational`), requerido, orden, valores sugeridos | Define variantes base editables por el dueño. |
| `products` | nombre, marca, descripción, categoría, estado, lote_requerido, vencimiento_requerido | Representa el concepto comercial, no una unidad vendible específica. |
| `product_variants` | producto, SKU, código barras, atributos, precio minorista/mayorista, stock mínimo, activa | Artículo vendible con inventario propio. El producto sin variantes tiene una variante por defecto. |
| `product_media` | producto/variante, clave de archivo, orden, alt text | Solo se guarda metadato y clave de storage, no URL pública permanente. |
| `price_lists` / `variant_prices` | tipo de cliente, importe, vigencia | Permite precios minoristas y mayoristas sin reescribir el historial. |

Cambiar una plantilla de categoría se aplica por defecto a productos nuevos. Los cambios que invaliden atributos/variantes existentes requieren una migración explícita, previsualización y confirmación; no se ejecutan silenciosamente.

## Inventario, costo y vencimientos

```text
ProductVariant
  └─< InventoryLot/CostLayer
         ├─< InventoryMovement
         └─< InventoryReservation
```

| Entidad | Datos clave | Reglas |
| --- | --- | --- |
| `inventory_locations` | nombre, tipo, activa | En MVP puede existir una ubicación predeterminada; habilita depósitos futuros. |
| `inventory_lots` | variante, lote externo, fecha vencimiento, costo unitario, cantidad recibida/restante | Opcional por producto, obligatorio si la política del producto lo exige. |
| `cost_layers` | variante, lote opcional, recepción, costo unitario, cantidad restante | Conserva capas FIFO aunque el catálogo muestre un solo stock agregado. |
| `inventory_movements` | tipo, cantidad firmada, variante, lote/capa, referencia, motivo, actor | Inmutable. Referencia a compra, pedido, devolución o ajuste. |
| `inventory_balances` | variante, ubicación, on_hand, reserved, sellable | Proyección transaccional para consulta rápida. |
| `inventory_reservations` | pedido/línea, variante, lote/capa, cantidad, estado, expires_at | Bloquea unidades sin convertirlas aún en venta. |

### Tipos de movimiento

- `PURCHASE_RECEIPT`: ingreso de mercadería y creación de capa de costo.
- `RESERVATION`: reserva lógica; aumenta `reserved`, no reduce `on_hand`.
- `RESERVATION_RELEASE`: libera por cancelación, cambio o vencimiento.
- `SALE_FULFILLMENT`: salida definitiva; reduce existencias y consume capas FIFO.
- `CUSTOMER_RETURN`: ingreso tras devolución aprobada y apta para reventa.
- `EXPIRED`: baja por vencimiento.
- `DAMAGED_LOST`: baja por rotura, pérdida o merma.
- `MANUAL_ADJUSTMENT`: corrección excepcional, con motivo obligatorio y permiso específico.

### Disponibilidad y FIFO

```text
available_to_reserve = sellable_on_hand - active_reserved
```

El usuario ve una sola variante con su stock agregado. Internamente cada recepción con costo, lote o vencimiento diferente crea una capa. Al confirmar salida por venta, el sistema asigna primero las capas FIFO vendibles; para productos con vencimiento se prioriza que no estén vencidos y puede adoptarse FEFO posteriormente si el comercio lo requiere. El margen histórico de una venta usa el costo de las capas realmente consumidas.

## Clientes y proveedores

| Entidad | Datos clave | Reglas |
| --- | --- | --- |
| `customers` | nombre, teléfono normalizado, email, Instagram, tipo, etiquetas, notas | Teléfono es el identificador principal opcionalmente único por organización; se detectan posibles duplicados sin fusionar automáticamente. |
| `customer_addresses` | cliente, dirección, localidad, provincia, código postal, referencias | Versionar/copy-on-order para preservar dirección usada en una entrega histórica. |
| `suppliers` | nombre, contacto, CUIT opcional, condiciones, notas | Por organización. |
| `purchase_receipts` | proveedor, fecha, comprobante, observaciones, estado | Al confirmar recepción se generan capas/movimientos. |
| `purchase_receipt_lines` | variante, cantidad, costo, lote/vencimiento | No altera catálogo ni precios de venta de forma automática. |

## Pedido, pago y envío

El pedido, pago y envío son agregados relacionados con estados independientes. Esto permite, por ejemplo, un pedido pagado que aún no fue despachado.

```text
Customer ──< Order ──< OrderLine ── ProductVariant
                    ├──< Payment
                    ├──< Shipment
                    ├──< InventoryReservation
                    └──< OrderStatusHistory
```

| Entidad | Datos clave | Reglas |
| --- | --- | --- |
| `orders` | número visible, cliente, canal, estado, totales, moneda, reserva vence, notas | Snapshot de datos comerciales relevantes; nunca recalcular pedido histórico desde catálogo actual. |
| `order_lines` | variante, nombre/SKU snapshot, cantidad, precio unitario, descuentos, impuestos futuros, total | Cada línea conserva el precio aplicado y regla/promoción utilizada. |
| `payments` | pedido, medio, monto, estado, referencia, comisión, confirmado por | Admite pagos parciales y reembolsos; no guarda tarjetas. |
| `shipments` | pedido, modalidad, dirección snapshot, costo, pagador, carrier, tracking, estado | Puede haber reenvío si una entrega falla. |
| `order_status_history` | pedido, transición, actor, motivo, fecha | Registro inmutable de estado comercial. |

### Estados del pedido

```text
DRAFT
  └─(submit/reserve)→ PENDING_PAYMENT
                         ├─(payment complete)→ CONFIRMED
                         │                       └→ PREPARING → READY_TO_SHIP → COMPLETED
                         └─(cancel/expiry)→ CANCELLED

CONFIRMED / PREPARING / READY_TO_SHIP
  └─(cancel)→ CANCELLED [puede requerir reembolso]
```

| Estado | Significado | Efecto de stock |
| --- | --- | --- |
| `DRAFT` | carga incompleta, no comprometida | ninguno |
| `PENDING_PAYMENT` | pedido enviado/esperando pago | crea reserva hasta `reservation_expires_at` |
| `CONFIRMED` | pago suficiente según regla del comercio | la reserva sigue activa hasta la salida de venta; el estado evita que expire |
| `PREPARING` | paquete en preparación | stock comprometido |
| `READY_TO_SHIP` | listo para despacho/retiro | stock comprometido |
| `COMPLETED` | entregado o retirado | salida de inventario ya registrada a más tardar en despacho |
| `CANCELLED` | cancelado manual o por vencimiento | libera reserva o inicia devolución/reembolso según situación |

La salida definitiva de inventario se recomienda en el despacho/entrega según configuración explícita del comercio. Para conservar la regla validada, el pago confirmado asegura el pedido y evita liberación por vencimiento; la conversión exacta a `SALE_FULFILLMENT` debe ser una política configurable y auditable (`on_payment_confirmation` u `on_dispatch`). La elección por defecto se define antes de implementación y no puede cambiarse retroactivamente sin conciliación.

### Estados del pago

```text
PENDING → CONFIRMED
PENDING → REJECTED
CONFIRMED → PARTIALLY_REFUNDED | REFUNDED
```

- Un pago representa un intento/importe concreto; el estado agregado del pedido se deriva de la suma de pagos confirmados menos reembolsos.
- Estado de resumen del pedido: `unpaid`, `partially_paid`, `paid`, `overpaid`, `refunded`.
- Cuando los pagos confirmados cubren el total exigible, se emite `PaymentCompleted`; un usuario autorizado debe confirmar manualmente el pago durante el MVP.
- Un pedido cancelado con dinero confirmado se marca como pendiente de reembolso hasta que existan movimientos `REFUNDED` equivalentes.

### Estados de envío

```text
NOT_REQUIRED
PENDING → PREPARING → READY → DISPATCHED → DELIVERED
PENDING → PENDING_PICKUP → PICKED_UP
DISPATCHED → RETURNED
```

Las modalidades iniciales son `pickup`, `postal`, `courier`, `own_delivery` y `other`. Los campos de tracking/carrier son opcionales. Una devolución no repone automáticamente: debe registrarse la condición de cada ítem y crear `CUSTOMER_RETURN` solo si es apto para reventa.

## Promociones y reportes

| Entidad | Datos clave | Reglas |
| --- | --- | --- |
| `promotions` | tipo, condiciones, vigencia, prioridad, estado | Descuento de producto/pedido, combo, 2x1, N por M y cupón futuro. |
| `promotion_applications` | promoción, pedido/línea, importe descontado, snapshot de regla | Evita que editar una promoción altere la historia. |
| `reporting_snapshots` (opcional) | período, métricas, organización | Proyección para dashboard; no fuente de verdad. |

Las métricas de margen usan ingresos de líneas menos descuentos, costo FIFO consumido, comisiones y costo de envío asumido. Debe diferenciarse siempre `ventas` (pedidos), `cobros` (pagos confirmados) y `ganancia estimada`.

## Eventos de dominio mínimos

```text
OrganizationCreated
UserInvited / InvitationAccepted / RoleChanged
ProductCreated / VariantCreated / PriceChanged
PurchaseReceiptConfirmed / InventoryAdjusted
StockReserved / ReservationReleased / ReservationExpired / StockCommittedToSale
OrderSubmitted / OrderCancelled / OrderTransitioned
PaymentRecorded / PaymentConfirmed / PaymentRefunded
ShipmentCreated / ShipmentDispatched / ShipmentDelivered / ShipmentReturned
LotExpiringSoon / LotExpired / LowStockDetected
```

Los eventos que salgan de la transacción se escriben en una tabla `outbox` dentro de la misma transacción que el cambio de estado. Un worker los publica de forma idempotente para notificaciones, proyecciones e integraciones futuras.
