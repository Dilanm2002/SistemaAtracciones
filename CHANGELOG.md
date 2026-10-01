# Historial de versiones

Todas las versiones de Descubre EC se registran aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y la numeración,
[Versionado Semántico](https://semver.org/lang/es/) (`MAYOR.MENOR.PARCHE`).
Cómo publicar una versión nueva: sección *Control de versiones* del [README](README.md).

## [Sin publicar]

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
