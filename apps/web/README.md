# Panel de gestión — frontend

Panel responsive de la aplicación web para comercios de belleza y cuidado personal. En desarrollo puede usar datos de demostración; las publicaciones usan un proxy interno para acceder al backend.

## Requisitos

- Node.js 20.9 o superior
- npm 10 o superior

## Ejecutar en desarrollo

Desde esta carpeta:

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## Conectar el backend

Copiá `.env.example` a `.env.local` y configurá `COMMERCIAR_API_URL` con el origen del backend. La variable se lee únicamente en el servidor mediante `src/app/api/backend/[...path]/route.ts`; no debe llevar secretos, rutas ni credenciales.

La interfaz debe usar `NEXT_PUBLIC_API_URL=/api/backend`. Así las solicitudes de autenticación se mantienen en el mismo origen y la cookie de sesión no depende de cookies de terceros. En producción `COMMERCIAR_API_URL` debe usar HTTPS.

El proxy solo reenvía rutas `/v1/*` y los métodos `GET`, `POST`, `DELETE` y `OPTIONS`. Conserva `Cookie`, `Content-Type` y `Set-Cookie`, sin reenviar `Host` ni `Origin` al backend.

## Comprobar una compilación de producción

```bash
npm run build
npm run start
```

La interfaz se encuentra principalmente en `src/app/page.tsx` y sus estilos en `src/app/globals.css`.
