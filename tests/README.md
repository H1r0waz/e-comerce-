# Pruebas de calidad

Este repositorio todavía no cuenta con persistencia ni servicios de dominio
concretos. Por eso las pruebas actuales se dividen en:

- `api/tenant-boundary.test.ts`: prueba ejecutable del límite HTTP hoy
  disponible (rechazo de contexto ausente o malformado y cabeceras básicas).
- `domain/commerce-policy.spec.test.ts`: especificación ejecutable de reglas
  de negocio. Deberá migrarse a pruebas black-box contra los servicios reales
  cuando se implemente la base de datos y las rutas.

Ejecutar sin modificar los scripts del repositorio:

```bash
./apps/api/node_modules/.bin/tsx --test tests/api/tenant-boundary.test.ts tests/domain/commerce-policy.spec.test.ts
```

## Cobertura requerida al integrar Neon

Las pruebas siguientes son requisito de salida antes de conectar datos reales:

1. Crear dos organizaciones y datos equivalentes (producto, cliente, pedido)
   en cada una. Con la sesión de la organización A, cada `GET`, `PATCH` y
   `DELETE` por ID de la organización B debe responder `404` (sin revelar la
   existencia del recurso) y no alterar filas.
2. Repetir el caso anterior para cada tabla con `organization_id`, incluidos
   movimientos de stock, lotes, reservas, pagos, envíos y auditoría.
3. Verificar RLS desde una conexión de aplicación con los claims de A y B, y
   verificar que una conexión de migración no se use en tiempo de ejecución.
4. Probar las decisiones de permisos con cada rol: `OWNER`, `SALES`,
   `INVENTORY_FULFILLMENT` y `VIEWER`. La denegación debe ser `403`; no se debe
   mutar stock, pago, usuario ni auditoría.
5. Ejecutar los casos concurrentes contra una rama de Neon: dos reservas del
   último ítem, vencimiento frente a confirmación de pago y doble confirmación
   del mismo pago. Las cantidades disponibles nunca pueden ser negativas y el
   libro mayor debe tener un único efecto lógico.

La matriz completa y el checklist de salida están en `docs/quality/`.
