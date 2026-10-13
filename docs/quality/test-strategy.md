# Estrategia de pruebas

## Objetivo

Proteger las reglas que más impacto tienen para un comercio multiusuario y
multiempresa: aislamiento del tenant, permisos, inventario reservado y el
ciclo de vida de pedidos, cobros y envíos.

## Pirámide de pruebas

| Nivel | Qué verifica | Entorno |
| --- | --- | --- |
| Unidad | Totales en centavos, tablas de transición, autorización por acción y cálculo de reserva | Local/CI |
| Integración | Repositorios SQL, RLS, transacciones, FIFO y bloqueo de inventario | Rama de Neon de desarrollo |
| API | Sesión real, rol, rutas y respuestas `403`/`404` | API con Neon aislado |
| E2E | Invitación, cambio obligatorio de contraseña, venta manual, cobro confirmado y despacho | Preview de Vercel + Neon de preview |

## Matriz mínima de aceptación

| Riesgo | Caso verificable | Resultado esperado |
| --- | --- | --- |
| Fuga entre comercios | Usuario A consulta/edita el ID de B | `404`; cero filas modificadas; sin datos en la auditoría devuelta |
| Elevación de privilegios | `VIEWER` confirma pago o ajusta stock | `403`; no hay movimiento ni evento de auditoría de éxito |
| Reserva doble | Dos ventas reservan el último artículo | Una reserva queda activa; la otra recibe conflicto; disponible nunca es negativo |
| Vencimiento | Reserva vencida y tarea de expiración | Reserva `EXPIRED`, se libera lo reservado y se agrega un movimiento trazable |
| Pago parcial | Suma de pagos menor al total | Pedido sigue pendiente; no se descuenta definitivamente el stock |
| Pago completo | Pago manual confirmado cubre el total | Pedido pasa a confirmado y la reserva se consume una sola vez |
| Doble confirmación | Reintento del mismo pago | Operación idempotente; no duplica cobro, venta ni movimiento |
| Cancelación | Pedido antes/después de confirmar | Sólo transiciones permitidas; la devolución de stock sigue la política documentada |
| Lotes/costos | Dos ingresos del mismo SKU con costos distintos | Una existencia visible; capa FIFO correcta y margen desglosable |

## Transiciones que debe imponer el dominio

Pedidos: `DRAFT → PENDING_PAYMENT → CONFIRMED → PREPARING → READY_TO_SHIP → COMPLETED`.
`CANCELLED` se permite solamente desde los estados operativos definidos; ni
`COMPLETED` ni `CANCELLED` pueden reabrirse automáticamente.

Pagos: registrar un pago no equivale a confirmarlo. Sólo la confirmación manual
autorizada puede convertir el pedido cuando el acumulado cubre el total. Pago
parcial conserva el pedido pendiente.

Reservas: `ACTIVE → CONSUMED | RELEASED | EXPIRED`. Crear/liberar una reserva
debe actualizar el agregado de inventario y el libro de movimientos dentro de
la misma transacción.

Envíos: `PENDING → PREPARING → READY_FOR_PICKUP/DISPATCHED → DELIVERED`;
desde `DISPATCHED` sólo puede volver a `RETURNED` mediante un flujo explícito.

## Datos y aislamiento de pruebas

- Nunca usar producción para pruebas de migración o concurrencia.
- Crear una rama Neon por PR o usar una rama de desarrollo desechable.
- Usar dos tenants por suite, con UUIDs aleatorios y limpieza por transacción o
  por rama descartable.
- No poner URLs, tokens, comprobantes reales ni CUITs reales en fixtures.
- Las pruebas de RLS deben usar la misma identidad/rol que emplea la API, no el
  rol administrador de migraciones.

## Puertas de calidad

Antes de merge: TypeScript, las pruebas unitarias, las pruebas API de límites y
la migración aplicada desde cero a una rama Neon.

Antes de producción: matriz mínima completa, pruebas de carga de reserva,
restauración ensayada, revisión de permisos/RLS y checklist de seguridad y
despliegue aprobado.
