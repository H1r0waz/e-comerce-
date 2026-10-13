# `@commerce-os/contracts`

Contratos TypeScript independientes de framework para el dominio de Commerce OS. Es la fuente compartida de tipos entre API, web y cualquier cliente futuro.

## Alcance

- Multi-tenant por `organizationId`.
- Venta digital localizada inicialmente para Argentina (`ARS`, `America/Argentina/Buenos_Aires`).
- Catálogo configurable por categorías, atributos y variantes.
- Inventario con reservas, lotes, vencimientos y capas de costo FIFO.
- Pedidos, pagos manuales/parciales, envíos, clientes y proveedores.
- DTOs para dashboard, auditoría y comandos de creación/actualización.

Los importes monetarios usan unidades menores (`amountMinor`): `$ 1.234,56` se representa como `123456`. Las fechas se expresan como strings ISO 8601.

```ts
import type { CreateOrderInput, OrderStatus } from "@commerce-os/contracts";

const input: CreateOrderInput = {
  organizationId: "org_123",
  channel: "WHATSAPP",
  customerId: "cus_123",
  lines: [{ productVariantId: "var_123", quantity: 2 }],
  delivery: { mode: "COURIER" }
};
```

Ejecutar `npm run typecheck` para validar los contratos o `npm run build` para generar declaraciones y JavaScript en `dist/`.
