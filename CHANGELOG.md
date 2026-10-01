# Historial de versiones

Todas las versiones de Descubre EC se registran aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y la numeración,
[Versionado Semántico](https://semver.org/lang/es/) (`MAYOR.MENOR.PARCHE`).
Cómo publicar una versión nueva: sección *Control de versiones* del [README](README.md).

## [Sin publicar]

## [2.4.0] - 2026-10-01

### Añadido
- **Inicio de sesión con Google** (como en Sal y Canela). Botón «Continuar con Google» en ingresar, registro, checkout y empresas.
  - Supabase Auth hace el OAuth con Google y vuelve a `/ingresar` con un `access_token`.
  - `POST /api/v1/auth/google` valida ese token **contra Supabase** con la clave de servidor y exige un correo verificado por Google.
  - Si el correo no existe, se crea una cuenta de cliente **ya verificada**, con contraseña aleatoria que nadie conoce. Si existe, se entra a esa cuenta.
  - Se emite la sesión propia del sistema, ligada con DPoP. Se vuelve a la página desde la que se pulsó el botón.
  - Cubre SEG-016: con Google, el correo queda verificado sin un proveedor de correo.
- **Etiqueta «Nuevo»** (como en Sal y Canela): una atracción la muestra en verde durante sus **primeros 7 días** y luego desaparece sola. Antes duraba 30 días y solo sin reseñas.

## [2.3.0] - 2026-10-01

Cierre de la reauditoría V3. El detalle y las mediciones están en [docs/CORRECCIONES-V3.md](docs/CORRECCIONES-V3.md).

### Seguridad
- **SEG-008:** el bucket de Supabase es privado.
  - Las fotos se sirven por `/api/v1/media/…`, solo las que están en uso, con caché en el CDN.
  - Las recién subidas se ven con un enlace firmado de 2 h.
- **WEB-008:** DPoP (RFC 9449).
  - El token queda ligado a una llave no exportable del navegador, así que robado no sirve.
  - Las integraciones siguen con Bearer.
- **V2-CON-01:** sin caché de sesión por instancia; la revocación es inmediata.
- **SEG-010:** el keepalive verifica cada 5 min que Storage responda con la clave de servidor.
- **V3-SEG-01:** el 503 de arranque usa la URI del catálogo de errores.

### Agregado
- **Pre-renderizado (WEB-003):** cada página pública y cada atracción tienen HTML propio para buscadores y redes, y el sitemap se genera con todas las atracciones.
- **Fotos de cualquier formato y tamaño:** JPG, PNG, WebP, GIF, BMP, AVIF, SVG y HEIC del iPhone. Se convierten en el navegador a JPEG 3:2 de 1600×1067; las cuadradas, verticales o pequeñas se colocan completas sobre un fondo desenfocado.
- **Mapa para la ubicación:** buscar el lugar, hacer clic o arrastrar el marcador. La dirección y el punto de encuentro se sugieren solos.
- **Galería del detalle:** una foto a la vez, con flechas fuera de la imagen, miniaturas, teclado y deslizamiento.

### Corregido
- **ACC-026:** contraste del texto sobre la foto del inicio, medido en el peor píxel.
  - Escritorio: título 3,8:1 y subtítulo 5,05:1.
  - Celular: título 8,15:1 y subtítulo 6,28:1.
- **V3-ACC-01:** borde perceptible (≥ 3:1) en los botones de cuentas demo.
- **V3-ACC-02:** el foco pasa al nuevo encabezado al enviar la solicitud de empresa.
- **Rendimiento:**
  - La API se movió a São Paulo (`gru1`), junto a la base.
  - El catálogo público se sirve desde la caché del CDN.
  - La sesión y el código de la página se cargan en paralelo.
  - Se activó Fluid Compute.
  - Resultado: 9-10 de 10 secciones cargan en ≤ 3 s.

## [2.2.1] - 2026-10-01

### Cambiado
- **Reservas pendientes de pago** (transferencia o pago en sitio):
  - Se cancelan sin costo hasta **1 hora antes** de la salida, ya no hasta la hora de salida.
  - Pasado ese corte, el cupo queda guardado para el cliente y ya no se cancela en línea.
  - La API expone ese corte en `free_cancellation_until`.

## [2.2.0] - 2026-10-01

### Corregido
- **Error de lógica en la cancelación.** Una reserva hecha a último momento, ya dentro del plazo de cancelación gratuita, quedaba sin ninguna forma de cancelarse, aunque estuviera pendiente de pago. La pantalla además decía que el plazo había terminado antes de reservar.

### Cambiado
- **Nueva política de cancelación del cliente.** La API la expone en `cancellation_policy`, `refundable` y `free_cancellation_until`:
  - **Pendiente de pago:** se cancela sin costo hasta la salida.
  - **Pagada, dentro del plazo de la experiencia:** reembolso total.
  - **Pagada a último momento:** 1 hora de arrepentimiento con reembolso total.
  - **Pagada, fuera de plazo:** se puede cancelar sin reembolso, confirmándolo con `accept_no_refund`; sin esa confirmación la API responde 409 `NO_REFUND_CONFIRMATION_REQUIRED`.
  - **Ya empezada:** no se puede cancelar.
  - **Cancela la empresa:** siempre con reembolso total.
- `can_cancel` ahora significa "puede cancelar, con o sin reembolso".
- **Interfaz:**
  - **Mis reservas:** muestra la política de cada reserva. El botón dice "Cancelar sin reembolso" cuando corresponde, y el modal exige marcar que acepta perder el pago.
  - **Checkout:** avisa antes de pagar si la reserva es de último momento o no tiene cancelación gratuita.
  - **Confirmación:** muestra hasta cuándo es gratis cancelar.

## [2.1.0] - 2026-10-01

### Agregado
- **Empresas proveedoras (marketplace):**
  - Nueva página **Para empresas** (`/empresas`). Con cuenta, una agencia solicita vender sus tours y paquetes.
  - El administrador aprueba la solicitud: se crea la empresa y la persona pasa a ser OPERADOR. O la rechaza con motivo, y la persona corrige y vuelve a solicitar.
  - Endpoints `/api/v1/proveedores/solicitudes` (crear, la mía, listar, aprobar, rechazar).
- **Revisión de experiencias:**
  - El operador sube tours y paquetes de su empresa ("Mis experiencias"). Quedan `EN_REVISION` hasta que el administrador las aprueba (`PUBLICADA`) o las rechaza con motivo (`RECHAZADA`).
  - `POST /api/v1/atracciones/{id}/review`.
  - El panel muestra el estado, los contadores y las acciones de aprobar/rechazar.
- **Migración `006_proveedores.sql`:**
  - Tabla `solicitud_operador`.
  - Estados `EN_REVISION` y `RECHAZADA`.
  - Columnas de revisión en `atraccion`.
- **Aviso al reservar:** el botón de reserva indica a los invitados que necesitan una cuenta, que se pide en el siguiente paso sin perder la selección.
- **Pruebas:** 8 E2E nuevas del flujo de empresas, de la revisión y de los permisos por empresa.

### Cambiado
- **Permisos del operador:** recibe `attractions:write`, limitado a **su** empresa. No puede destacar ni asignar experiencias a otra empresa, y lo ajeno responde 404.
- **Catálogos globales y reseñas:** categorías, destinos y operadores, y la moderación de reseñas, pasan a exigir `admin:full`.

## [2.0.0] - 2026-09-30

Versión que cierra los hallazgos abiertos de la reauditoría V2. Es **MAYOR** porque cambia
la plataforma (NestJS 11 / Express 5, React Router 7, Vite 8), las URIs `type` de los
errores, el acceso a la documentación y las credenciales de producción. El detalle por
hallazgo está en [docs/CORRECCIONES-V2.md](docs/CORRECCIONES-V2.md).

### Cambiado (incompatible)
- **Plataforma:**
  - Backend en NestJS 11 + Express 5 (`@nestjs/swagger` 11, `@nestjs/config` 4, `@nestjs/jwt` 11).
  - Frontend en Vite 8 + React Router 7.
  - `npm audit`: **0 vulnerabilidades** en el backend y en el frontend, incluidas las dependencias de desarrollo (antes 13 y 2).
- **Errores RFC 7807:**
  - El campo `type` apunta al propio dominio y se puede resolver: `GET /api/v1/errores/{tipo}` describe cada tipo.
  - El guard de `Idempotency-Key` ya no refleja el valor recibido (V2-SEG-02).
- **Documentación de la API:**
  - Swagger y Redoc son opt-in en producción (`ENABLE_DOCS=true`).
  - Sus recursos se sirven desde `/vendor` del propio dominio, sin CDN de terceros (SEG-019).
- **Credenciales de producción:**
  - Se rotaron las contraseñas de administrador y operador.
  - Solo la cuenta de cliente de demo es pública (CAL-009 / SEG-014).

### Seguridad
- **Seed (V2-SEG-01):**
  - Es *fail-closed*: la API no arranca en producción sin `SEED_ON_START=false`.
  - El seed se niega a ejecutarse con `NODE_ENV=production`.
- **Migraciones (V2-OPS-01):** solo en el despliegue de producción; los builds de *preview* compilan sin tocar el esquema.
- **Idempotencia (SEG-013):** guarda solo el UUID de la reserva (sin datos personales) y reconstruye la respuesta al repetir.
- **Sesiones (V2-CON-01):** la caché de sesión baja de 15 s a 3 s, así que la revocación tarda como máximo 3 s entre instancias.
- **Búsquedas (V2-DAT-01):** `ESCAPE '\'` explícito en todos los `ILIKE` parametrizados.
- **Bucket de imágenes (SEG-008):**
  - Supabase solo acepta JPG/PNG/WebP de hasta 4 MB.
  - `/health` comprueba el almacenamiento con la clave de servidor (SEG-010).
- **CI (V2-CAL-01):** CodeQL (`security-extended`), revisión de dependencias en los PR y `npm audit --audit-level=high` sobre todas las dependencias.

### Agregado
- **Observabilidad (OPS-005):**
  - Logs JSON de una línea con `request_id`, método, ruta, estado y duración.
  - Métricas de la instancia en `/health`.
- **Cobertura del contrato (API-015):** `contract-coverage.spec.ts` compara el contrato OpenAPI con las rutas de Nest y falla ante una ruta sin documentar o una promesa sin implementar.
- **Sesión y datos por pestaña:**
  - Cada pestaña tiene su propio inicio de sesión.
  - Los favoritos son por usuario y no quedan guardados en el navegador.
- **Fotos en Supabase Storage**, como en Sal y Canela: se comprimen en el navegador, se suben al bucket y la tabla guarda la URL.
- **Formularios:**
  - Validación en vivo con máscaras numéricas.
  - Cédula y teléfono ecuatorianos (migración 004).
  - Gestor de fotos con arrastrar y soltar.
- **Interfaz:** barra de navegación fija también en el inicio.
- **Disponibilidad:** el workflow *keepalive* consulta la API cada 10 min (Vercel siempre caliente y Supabase sin pausa).

### Corregido
- **Foco visible (ACC-001):** sobre superficies oscuras (panel, pie, hero, toasts) el anillo es ámbar con contraste ≥ 8:1.
- **Imágenes (WEB-006):** las 2 que se ven de inmediato declaran `loading="eager"` de forma explícita.

## [1.0.0] - 2026-09-29

Primera versión estable: sitio público, panel de administración y API de Atracciones.

### Agregado
- **Catálogo:** atracciones con tarifas versionadas (adulto y niño), horarios, fotos, idiomas, inclusiones y categorías jerárquicas. Incluye búsqueda con filtros, orden y paginación, y destinos, provincias y operadores.
- **Reservas:** disponibilidad y calendario por horario, fechas bloqueadas y control de cupos sin sobreventa. Pago simulado con tarjeta, transferencia o pago en sitio, con idempotencia (`Idempotency-Key`), cancelación con reembolso y confirmación de pagos por el operador.
- **Cuentas:** registro y login con JWT y sesiones revocables, roles ADMIN, OPERADOR y CLIENTE con scopes OAuth2, y alcance por empresa operadora.
- **Participación de clientes:** reseñas para quien ya vivió la experiencia (con moderación), favoritos y formulario de contacto con protección anti-spam.
- **Panel de administración:** dashboard, reportes de ventas y clientes con exportación a Excel, gestión de atracciones, catálogos, personas y mensajes.
- **Integración:** eventos de dominio (outbox + AsyncAPI), contratos OpenAPI, GraphQL y gRPC publicados, Swagger y Redoc.
- **Datos:** modelo relacional SQL-first (`database/01_esquema.sql`, 43 tablas en 3FN) con migraciones y verificación automática (`02_verificacion.sql`). Validación de cédula, RUC y teléfono ecuatorianos en la base, la API y los formularios.
- **Seguridad:** cabeceras HTTP, CSP, CORS, límite de peticiones, errores RFC 7807 y escaneo de secretos en CI.
- **Pruebas:**
  - 125 pruebas E2E contra PostgreSQL real.
  - 93 pruebas unitarias del backend.
  - 27 pruebas del frontend.
  - Cobertura del backend de ~91 % de sentencias (ver [docs/PRUEBAS-QA.md](docs/PRUEBAS-QA.md)).
- `CHANGELOG.md` y control de versiones: la versión publicada aparece en Swagger y en `GET /api/v1/atracciones/health`.

### Corregido (QA previo a la versión)
- Ocultar o eliminar una reseña no recalculaba el promedio de la atracción.
- Varios `DELETE`/`PATCH` no devolvían 404 cuando el registro no existía.
- Un cuerpo de más de 100 kB respondía 500 en vez de 413, sin `request_id`.
- `GET /contracts/constructor` y nombres similares respondían 500.
- La búsqueda con rangos de fechas de más de 62 días excluía atracciones disponibles.
- Duraciones como 1.999 h se mostraban como `PT1H60M` y "1 h 60 min".
- El correo y el teléfono de contacto de la reserva no se guardaban (migración `005_contacto_pasajero.sql`).
- Los reportes contaban como ingreso las reservas pendientes de pago. Ahora "ingresos" es solo lo cobrado, y lo pendiente se muestra en `pending_revenue`.
- El límite de peticiones se podía evadir con `X-Forwarded-For` si la API se exponía sin proxy (`TRUST_PROXY`).
- Se podían guardar en favoritos atracciones inactivas.
- Se podía reseñar una reserva de hoy antes de su hora.
- No se podía quitar el teléfono de un usuario desde el panel.
- Las fechas futuras se mostraban como "hace 1 minuto".

### Cambiado
- La versión del backend pasa de `2.0.0` (heredada de la plantilla) a `1.0.0`, igual que el frontend. La versión del contrato OpenAPI (`info.version`) se mantiene aparte porque versiona el acuerdo con los otros equipos, no el producto.

[Sin publicar]: https://github.com/Dilanm2002/SistemaAtracciones/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Dilanm2002/SistemaAtracciones/releases/tag/v1.0.0
