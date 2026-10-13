# Checklist de seguridad y despliegue: Neon + Vercel

Este documento contiene nombres de configuración, nunca valores secretos.

## Antes de conectar la aplicación

- [ ] La autenticación emite identidad, organización activa y rol desde la
  sesión firmada; la API no acepta esos valores desde el body ni cabeceras que
  el navegador pueda falsear.
- [ ] El superusuario tiene MFA obligatorio. Invitaciones son de un solo uso,
  expiran y permiten fijar contraseña propia; no se envían contraseñas
  temporales por correo.
- [ ] Las sesiones usan cookies `HttpOnly`, `Secure`, `SameSite` apropiado,
  rotación/revocación y rate limiting en login, invitación y recuperación.
- [ ] Cada acción sensible valida permiso en servidor y deja auditoría sin
  registrar secretos, credenciales ni comprobantes privados completos.
- [ ] CORS sólo permite los orígenes necesarios y las respuestas autenticadas
  usan `Cache-Control: no-store`.

## Neon

- [ ] La región, organización y proyecto corresponden a la aplicación; no se
  reutiliza una base ajena por comodidad.
- [ ] Esquema y políticas RLS están versionados como migraciones revisadas.
- [ ] Toda tabla de negocio con tenant usa `organization_id`, índices acordes y
  RLS que compara contra el claim de sesión; probar lectura y escritura.
- [ ] Aplicar migraciones con URL directa/no agrupada (`DATABASE_URL_UNPOOLED`)
  en una rama de Neon primero. La aplicación usa URL agrupada (`DATABASE_URL`).
- [ ] Producción, preview y desarrollo usan ramas/bases y credenciales distintas;
  un preview nunca apunta a producción.
- [ ] La cuenta de ejecución de la aplicación tiene el mínimo privilegio. Las
  credenciales de migración no se instalan en Vercel Runtime.
- [ ] Se configuró retención/recuperación acorde al plan y se ensayó una
  restauración en una rama independiente.
- [ ] Se revisan conexiones, errores, consultas lentas y capacidad; no se
  habilitan extensiones ni se eliminan índices sin revisión.

## Vercel

- [ ] Las URL de base, secretos de sesión, claves de correo y credenciales de
  terceros se cargan como **Secret** y con alcance mínimo (Production,
  Preview o Development).
- [ ] Ningún secreto aparece en el repositorio, logs, artefactos de build ni
  variable `NEXT_PUBLIC_*`. El archivo `.env.example` sólo tiene nombres y
  ejemplos inocuos.
- [ ] El entorno Preview usa secretos y base de preview; Production usa sus
  propios valores. No copiar secretos de Production a desarrollo.
- [ ] El frontend sólo recibe configuración pública indispensable; la conexión
  a Neon se mantiene del lado servidor/API.
- [ ] Se comprueban encabezados de seguridad, HTTPS, límites de petición y
  páginas de error antes de promover a producción.
- [ ] Se habilitan alertas de despliegue, errores y disponibilidad, con
  responsable y procedimiento de rollback identificado.

## Salida y respuesta ante incidentes

- [ ] Revisar cambios de migración, roles, rutas de pago e inventario por otra
  persona antes de producción.
- [ ] Confirmar que backups/restauración, auditoría y exportación de datos se
  ajustan a obligaciones aplicables en Argentina.
- [ ] Si se sospecha exposición: revocar sesiones y secretos afectados, rotar
  credenciales en Neon/Vercel, preservar auditoría y evaluar alcance antes de
  comunicar.
- [ ] Después del incidente, crear rama de análisis/restauración; no ejecutar
  cambios manuales irreversibles directamente sobre producción.
