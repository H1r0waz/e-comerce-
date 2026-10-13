# Plan de seguridad implementable

Este documento define los controles mínimos para Comerciar durante su primera
etapa. Es una guía de diseño y entrega; no constituye asesoramiento legal ni
acredita cumplimiento normativo.

## Objetivo y límites de confianza

La plataforma aloja comercios independientes. Un usuario autenticado pertenece
a una o más organizaciones (`organization_id`), con un rol diferente en cada
una. Las interfaces web, las integraciones futuras y los adjuntos son entradas
no confiables. El servidor y la base de datos deben decidir siempre quién puede
leer o modificar cada recurso.

Activos prioritarios: datos de clientes, pedidos, pagos y comprobantes,
inventario, credenciales, enlaces de activación, sesiones, secretos y auditoría.

Invariantes que deben mantenerse:

- Toda entidad operativa está asociada a un `organization_id`; una operación
  nunca acepta este identificador sin comprobar la membresía del actor.
- El cliente no determina roles, precios, estados, stock, totales ni permisos.
- Las operaciones críticas son auditables y los movimientos de inventario se
  registran como eventos, no como cambios silenciosos de un contador.
- Un usuario suspendido, una sesión revocada o un token consumido no puede
  recuperar acceso por caché o por una ruta alternativa.

## Arquitectura de identidad y alta manual

No habrá alta pública inicialmente. El superusuario de plataforma crea el
comercio y luego crea o invita a su dueño/administrador. Ese administrador crea
usuarios de su propio comercio según sus permisos.

### Invitación por enlace (método normal)

1. Un actor autorizado indica correo, organización y rol. El API normaliza y
   valida el correo y verifica que el rol puede ser concedido.
2. El servidor genera un secreto criptográficamente aleatorio (al menos 256
   bits), guarda solo su hash junto con `user_id`, `organization_id`, propósito,
   fecha de vencimiento (24 h por defecto), fecha de uso y emisor.
3. Se envía un enlace HTTPS con el secreto de un solo uso. La URL no se guarda
   en logs de aplicación, analítica ni herramientas de soporte.
4. Al abrirlo, la interfaz pide una contraseña nueva; el endpoint consume el
   token y establece la contraseña dentro de una única transacción. Reintentos
   posteriores fallan de forma genérica.
5. La cuenta queda activa solo después de definir la contraseña. Las invitaciones
   pendientes pueden revocarse y reenviarse; crear otra invalida la anterior.

No se muestran ni se almacenan contraseñas en texto plano. Las contraseñas se
hashean con Argon2id y parámetros revisados al momento de implementación; la
comparación es constante y se permite actualizar el hash al iniciar sesión.

### Fallback: contraseña temporal

Solo si el correo no es viable. Se genera en el servidor, se entrega por un
canal separado y seguro, vence pronto (por defecto, 24 h), permite un único
inicio y obliga a elegir una contraseña antes de cargar cualquier dato del
comercio. Nunca aparece en pantallas posteriores, auditoría ni logs. Debe poder
desactivarse globalmente.

### Autenticación reforzada

- MFA TOTP es obligatorio para el superusuario de plataforma antes de habilitar
  operaciones administrativas. No se permite una excepción permanente.
- MFA TOTP debe estar disponible y ser fuertemente recomendado para dueños; el
  comercio podrá hacerlo obligatorio para sus integrantes en una fase posterior.
- Los códigos de recuperación se muestran una sola vez, se almacenan hasheados
  y se invalidan tras usarse. Regenerarlos invalida los anteriores.
- El restablecimiento de contraseña usa el mismo patrón de token de un solo uso
  que la invitación, sin revelar si una dirección existe.
- Inicio de sesión, invitación, restablecimiento y verificación MFA responden
  de manera uniforme para evitar enumeración de cuentas.

## Autorización y aislamiento multi-comercio

La autorización se implementa en el API y en la capa de acceso a datos; ocultar
botones en la web no es un control de seguridad.

1. La sesión identifica al actor. El contexto de organización activa se deriva
   de una membresía válida, no de un header o parámetro confiado al cliente.
2. Cada endpoint declara acción y recurso. Antes de leer o mutar se verifica
   permiso, pertenencia de recurso y estado de cuenta.
3. Las consultas agregan el filtro `organization_id` obligatoriamente. Las
   mutaciones incluyen ese filtro en `WHERE` y fallan si no afectan una fila.
4. La base de datos usa claves foráneas compuestas o validaciones equivalentes
   para impedir referencias cruzadas de organizaciones. Cuando sea viable, se
   habilita Row Level Security como defensa adicional, sin reemplazar los checks
   de aplicación.
5. Identificadores externos son no adivinables (UUID/ULID); aun así, conocer un
   identificador nunca concede acceso.

### Matriz inicial de roles

| Capacidad | Superusuario | Dueño/admin | Ventas | Stock/envíos | Consulta |
| --- | --- | --- | --- | --- | --- |
| Crear, suspender y asistir comercios | Sí | No | No | No | No |
| Gestionar usuarios del propio comercio | Solo asistencia auditada | Sí | No | No | No |
| Configuración fiscal, alertas y reglas | No* | Sí | No | No | No |
| Productos, categorías y precios | No* | Sí | Crear/consultar** | Consultar | Consultar |
| Compras, lotes, ajustes y stock | No* | Sí | No | Sí | Consultar |
| Clientes y pedidos | Soporte excepcional auditado | Sí | Sí | Consultar/preparar | Consultar |
| Confirmar/reembolsar pagos | No* | Sí | Sí** | No | No |
| Despachar/registrar entrega | No* | Sí | Sí** | Sí | No |
| Reportes del comercio | Solo métricas técnicas agregadas | Sí | Según configuración | Según configuración | Solo lectura |
| Ver auditoría del comercio | Soporte excepcional auditado | Sí | No | No | No |

\* El superusuario no debe navegar datos operativos por defecto. Cualquier
acceso de soporte requiere motivo, duración limitada, aviso al dueño cuando sea
posible y evento de auditoría inmutable.  
\** Permitido solo si el dueño lo habilita en una política del comercio; el valor
predeterminado debe ser el menor privilegio.

Los roles son conjuntos de permisos versionados. La creación de roles
personalizados se posterga hasta que exista una pantalla y pruebas que impidan
escalación de privilegios.

## Sesiones, API y defensas web

- Cookies de sesión: `Secure`, `HttpOnly`, `SameSite=Lax` o más estricto;
  prefijo `__Host-` cuando aplique; sin tokens en `localStorage`.
- Rotar el identificador de sesión tras inicio, cambio de contraseña, alta MFA y
  elevación de privilegios. Mantener expiración absoluta y por inactividad
  configurables; revocar todas las sesiones tras acciones sensibles.
- Proteger toda mutación autenticada contra CSRF mediante tokens verificables y
  validación de `Origin`/`Referer`. Aplicar CORS con una lista explícita de
  orígenes, métodos y headers; nunca `*` con credenciales.
- Validar cada request con esquemas en servidor: tipos, tamaños, enumeraciones,
  fechas, cantidades, límites de paginación y formatos argentinos cuando
  correspondan. Ignorar campos no permitidos.
- Usar controles de concurrencia/transacciones para reservas de stock, pagos y
  movimientos: las cantidades nunca pueden pasar a negativas por carreras.
- Autorización por objeto también en descargas, exportaciones y adjuntos. Las
  URLs firmadas son de corto plazo y con el menor alcance posible.
- Encabezados: CSP estricta y sin `unsafe-inline` cuando sea posible,
  `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, política de
  permisos restrictiva y HSTS una vez que HTTPS sea exclusivo.

### Rate limiting y prevención de abuso

Aplicar límites en un almacén compartido, por IP, cuenta y organización según
la operación. Valores iniciales a ajustar con telemetría:

| Superficie | Límite sugerido |
| --- | --- |
| Inicio de sesión | 5 intentos / 15 min por cuenta e IP; demora progresiva |
| MFA y recuperación | 5 / 15 min por cuenta e IP |
| Invitaciones y reenvíos | 5 / h por comercio; 20 / día |
| Endpoints de lectura | 120 / min por usuario y organización |
| Mutaciones estándar | 60 / min por usuario y organización |
| Exportaciones | 5 / h por usuario y organización |
| Adjuntos | cuota por comercio, tamaño y frecuencia limitados |

Responder con errores genéricos y `429` cuando corresponda. Alertar picos sin
bloquear globalmente a comercios legítimos; debe existir un procedimiento de
desbloqueo auditado.

## Auditoría y operaciones sensibles

Los eventos de auditoría contienen: UUID, momento UTC, actor, organización,
acción, tipo e ID de recurso, resultado, IP/cliente minimizados, correlación de
request y diferencias estructuradas sin secretos. Son append-only para la app:
no hay endpoint de edición o borrado.

Auditar como mínimo: inicios fallidos/exitosos, MFA, creación/revocación/uso de
invitación, recuperación de contraseña, sesiones revocadas, cambios de rol,
acceso de soporte, cambios de configuración, precios, promociones, movimientos
de stock, pagos/reembolsos, pedidos, exportaciones y acciones sobre adjuntos.

Las operaciones de alto impacto requieren motivo y, cuando exista delegación,
pueden requerir aprobación del dueño: ajuste negativo grande de stock,
reembolso, cambio de cuenta bancaria, exportación masiva y acceso de soporte.

## Secretos, infraestructura y dependencias

- Secretos solo en un gestor de secretos o variables protegidas del entorno;
  nunca en repositorio, imágenes, cliente, errores ni logs.
- Separar claves por entorno y propósito; rotarlas tras exposición, salida de
  personal o según una política documentada. Revocar antes de reemplazar.
- CI bloquea secretos conocidos, dependencias vulnerables de severidad alta
  explotables y cambios de infraestructura sin revisión. Usar lockfiles y
  actualizaciones controladas.
- Producción con TLS moderno, base de datos no expuesta públicamente, mínimos
  permisos de red e IAM, cuentas separadas para migraciones y runtime.
- Cifrado en tránsito y cifrado administrado en reposo para base de datos,
  backups y almacenamiento de archivos. Restringir acceso de operadores y
  registrar acciones administrativas.

## Adjuntos y comprobantes

Los comprobantes de pago e imágenes son no confiables.

- Permitir una lista pequeña de tipos y tamaños (por ejemplo, JPEG/PNG/WebP/PDF
  según necesidad); validar firma/binario, no solo extensión o MIME declarado.
- Renombrar con identificadores generados; almacenar fuera del servidor web,
  sin permisos de ejecución y con descarga desde un endpoint autorizado.
- Escanear malware antes de publicar; dejar en cuarentena hasta completar el
  análisis. Rechazar archivos cifrados o ambiguos y eliminar metadatos cuando
  no sean necesarios.
- Nunca confiar en el nombre original para rutas ni representar documentos en
  línea sin cabeceras seguras. Aplicar cuotas por comercio y retención definida.

## Backups, recuperación y continuidad

- Backups automáticos cifrados de base y archivos, separados de producción y
  con acceso mínimo. Definir RPO/RTO con el responsable antes de producción.
- Probar restauraciones periódicas en un entorno aislado y registrar resultado,
  duración e integridad. Un backup no probado no cuenta como control validado.
- Documentar respuesta a incidentes: detección, contención, revocación de
  sesiones/claves, preservación de evidencia, comunicación y recuperación.
- Probar fallas de proveedor, restauración de inventario/auditoría y rotación de
  claves antes del lanzamiento público.

## Monitoreo y privacidad

Centralizar logs con control de acceso y retención definida. No registrar
contraseñas, tokens, códigos MFA, datos completos de tarjetas, enlaces de
activación ni comprobantes. Generar alertas para fuerza bruta, uso repetido de
tokens, escalación de rol, exportaciones anómalas, acceso de soporte, picos de
errores de autorización y cambios masivos de stock.

Para Argentina, antes de operar se debe revisar con asesoramiento especializado
la aplicación de la Ley 25.326, normas complementarias y obligaciones que
correspondan al rol de la plataforma y de cada comercio. Como base técnica:

- recolectar solo datos necesarios para pedidos y operación;
- declarar finalidades y responsables en avisos de privacidad comprensibles;
- ofrecer mecanismos verificables para acceso, corrección y supresión cuando
  proceda, preservando registros requeridos por obligaciones legítimas;
- definir retención y eliminación por tipo de dato y comercio;
- firmar acuerdos apropiados con proveedores que procesen datos y evaluar
  transferencias internacionales antes de habilitarlas.

## Checklist de validación previa a producción

### Identidad y permisos

- [ ] La invitación, el restablecimiento y la contraseña temporal no filtran
  existencia de cuenta, no se reutilizan y vencen correctamente.
- [ ] El superusuario no puede completar acciones administrativas sin MFA TOTP;
  códigos de respaldo funcionan una vez y se invalidan.
- [ ] Suspender una cuenta y revocar una sesión impide de inmediato API, web y
  descargas; cambiar contraseña revoca sesiones según política.
- [ ] Cada acción de la matriz está cubierta por pruebas positivas y negativas.
- [ ] Un usuario de una organización no puede leer, mutar ni adivinar recursos,
  exportaciones o adjuntos de otra organización.

### Integridad de negocio y API

- [ ] Las mutaciones de pedidos, pagos, reservas y stock son transaccionales e
  idempotentes cuando el cliente reintenta una petición.
- [ ] Datos enviados por cliente no permiten manipular precios, totales, roles,
  organización, estados no permitidos ni cantidades negativas.
- [ ] CSRF, CORS, límites, validación de entrada, paginación y cabeceras se
  verifican con pruebas automatizadas o pruebas de integración reproducibles.
- [ ] Las rutas de soporte, exportación y adjuntos aplican la misma autorización
  por organización que las rutas principales.

### Operación

- [ ] Logs y auditoría no contienen secretos ni datos innecesarios; los eventos
  críticos son consultables e inmutables para la aplicación.
- [ ] Secretos no están en el repositorio ni artefactos; hay procedimiento de
  rotación y alertas ante exposición.
- [ ] Adjuntos inválidos, sobredimensionados y maliciosos quedan rechazados o
  aislados; las descargas exigen autorización.
- [ ] Se restauró un backup de prueba y se comparó integridad de datos clave.
- [ ] Existe un runbook de incidentes, responsables y canales de escalamiento.
- [ ] Privacidad, retención, proveedores y avisos fueron revisados para el
  lanzamiento por la persona o asesoría competente.

## Orden recomendado de implementación

1. Modelo de organizaciones/membresías, contexto de tenant y pruebas de
   aislamiento antes de construir recursos operativos.
2. Autenticación, invitaciones de un solo uso, MFA del superusuario, sesiones y
   recuperación de contraseña.
3. RBAC, auditoría append-only, límites y autorizaciones por recurso.
4. Transacciones de inventario/pagos, adjuntos seguros y exportaciones.
5. Monitoreo, backups probados, runbooks, hardening de infraestructura y
   revisión de privacidad antes de exponer el servicio.
