# Pruebas automatizadas y QA

## Cómo ejecutarlas

```bash
# Backend: unitarias (sin base de datos)
cd backend && npm test

# Backend: E2E contra PostgreSQL real (la API aplica migraciones y seed al arrancar)
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/descubre_ec_test npm run test:e2e

# Frontend: validaciones y formatos (runner nativo node:test, sin dependencias)
cd frontend && npm test
```

Sin `TEST_DATABASE_URL` (ni `DATABASE_URL`) las suites E2E se omiten. En CI se ejecutan en el job
`database`, después de `02_verificacion.sql`, y el frontend corre `npm test` antes del build.

## Inventario

| Capa | Archivo | Qué cubre |
|---|---|---|
| E2E | `backend/test/e2e/reservas.e2e-spec.ts` | Reservar (tarjeta, transferencia, en sitio), precio adulto/niño, validaciones, cupos, **10 reservas simultáneas sobre 5 cupos (sin sobreventa)**, idempotencia (repetición, conflicto, aislamiento por usuario, liberación tras fallo), cancelación con reembolso/rechazo y devolución de cupos, plazos de cancelación, confirmación por operador, alcance por empresa, fechas bloqueadas, calendario |
| E2E | `backend/test/e2e/auth.e2e-spec.ts` | Registro, login sin enumeración de cuentas, JWT manipulado/ajeno, logout y cambio de contraseña revocan sesiones, desactivación y cambio de rol inmediatos, rate limit (429), 403 por scope, administración de usuarios, cabeceras de seguridad, CORS, JSON inválido, cuerpo > 100 kB |
| E2E | `backend/test/e2e/catalogo.e2e-spec.ts` | Listado/paginación HATEOAS, búsqueda (filtros, orden, token, comodines LIKE, rango de fechas), detalle en lote, visibilidad de inactivas, CRUD de atracciones y validaciones, fechas bloqueadas por empresa, subida de imágenes falsas, reseñas y recálculo del promedio, favoritos, contacto (honeypot), reportes, feed de eventos y contratos |
| E2E | `backend/test/e2e/catalogo-admin.e2e-spec.ts` | Categorías (slug único, ciclos, borrado protegido), destinos, operadores (RUC/código únicos, altas concurrentes), moderación |
| Unit | `compras.spec.ts`, `atraccion.mapper.spec.ts`, `utils/fechas.spec.ts` | Registro de compra y reintento ante choque de código, regla de cancelación gratuita, enlaces HATEOAS, fechas en hora de Ecuador |
| Unit | `problem-details.filter.spec.ts`, `auth-guards.spec.ts` | RFC 7807 y no filtrado de errores internos, guards JWT/opcional, sesiones, `Idempotency-Key`, `ParseIdPipe`, normalización de resultados SQL |
| Unit | `frontend/tests/*.test.js` | Validaciones de formularios (paridad con la API) y formatos |

## Bugs encontrados y corregidos

| # | Severidad | Síntoma | Causa | Corrección |
|---|---|---|---|---|
| 1 | Alta | Ocultar o eliminar una reseña no recalculaba el promedio ni el número de reseñas de la atracción | El driver Postgres de TypeORM devuelve `[filas, afectadas]` en `UPDATE`/`DELETE`; `one()` tomaba el arreglo de filas como si fuera la fila | `DbService` normaliza el resultado (`filas()`) en `query` y `one` |
| 2 | Media | `DELETE /mensajes/:id`, `PATCH /mensajes/:id`, `DELETE …/blocked-dates/:id`, `PATCH/DELETE /resenas/:id` nunca devolvían 404 (el PATCH de mensaje inexistente respondía 200 vacío) | Misma causa que el #1 (`r.length` era siempre 2) | Igual que el #1 |
| 3 | Media | Un cuerpo de más de 100 kB respondía **500** y se registraba como error interno | El `PayloadTooLargeError` de body-parser no es `HttpException` | El filtro RFC 7807 respeta los errores 4xx de `http-errors` (413) |
| 4 | Baja | Los errores de body-parser (413, JSON inválido) no traían `request_id` | El middleware de `X-Request-Id` se registraba después del body-parser | Se registra antes |
| 5 | Media | `GET /contracts/constructor` (o `toString`, `hasOwnProperty`…) respondía 500 | La búsqueda en el objeto `CONTRATOS` encontraba propiedades del prototipo de `Object` | Solo se aceptan claves propias → 400 |
| 6 | Media | `POST /atracciones/search` con `dates` de más de 62 días excluía atracciones con ≥ 62 días bloqueados aunque operaran otros días del rango | El número de días del rango se limitaba a 62, pero no los días bloqueados | Se compara con el número real de días |
| 7 | Baja | `horasAIso(1.999)` → `PT1H60M` (ISO 8601 inválido); lo mismo en `fmtDuration` del frontend (“1 h 60 min”) | Se redondeaban los minutos después de separar las horas | Se redondea a minutos totales antes de separar |

## Observaciones no corregidas (requieren decisión)

- **`customer_email` y `customer_phone` de la reserva se validan pero se ignoran**: la respuesta muestra el correo y teléfono de la cuenta. O se guardan (p. ej. en `reserva_pasajero`) o se retiran del contrato.
- **Los reportes cuentan como ingresos las reservas `PENDIENTE_PAGO`** (todo lo que no está cancelado). Si “ingresos” debe ser dinero cobrado, hay que filtrar por pago aprobado.
- **El límite de peticiones confía en `X-Forwarded-For`** (`trust proxy 1`). Es correcto detrás de Vercel, pero si la API se expone directamente el límite se evade enviando otra IP en la cabecera.
- Favoritos acepta atracciones **inactivas** (no eliminadas); luego su detalle público responde 404.
- La elegibilidad para reseñar considera “vivida” una reserva de **hoy** aunque su hora no haya llegado.
- En el panel de personas no se puede **borrar** el teléfono de un usuario (solo se envía si no está vacío).
- `fmtRelative` con una fecha futura muestra “hace 1 minuto”.
- `xlsx` se descarga de `cdn.sheetjs.com`: `npm ci` del frontend falla en redes que bloquean ese dominio.
