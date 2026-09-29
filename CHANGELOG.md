# Historial de versiones

Todas las versiones de Descubre EC se registran aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y la numeración,
[Versionado Semántico](https://semver.org/lang/es/) (`MAYOR.MENOR.PARCHE`).
Cómo publicar una versión nueva: sección *Control de versiones* del [README](README.md).

## [Sin publicar]

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
