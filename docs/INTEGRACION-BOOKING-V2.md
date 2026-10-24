# Integración con Booking Prototipo — contrato v2 (RDA2)

Qué implementa Descubre EC del contrato [`backend/contracts/atracciones-openapi-v2.yaml`](../backend/contracts/atracciones-openapi-v2.yaml), cómo probarlo y qué decisiones se tomaron donde el contrato no era explícito.

El archivo del contrato es **el que envió el equipo de Booking, sin modificar**.

## 1. Dónde está

| | URL |
|---|---|
| **API v2 (contrato con Booking)** | `https://sistemaatracciones-backend.vercel.app/api/v2` |
| API v1 (contrato anterior y web, sin cambios) | `https://sistemaatracciones-backend.vercel.app/api/v1` |
| Swagger (v1 y v2) | `https://sistemaatracciones-backend.vercel.app/api/docs` |
| Contrato v2 publicado | `https://sistemaatracciones-backend.vercel.app/api/v1/contracts/atracciones-openapi-v2.yaml` |
| Proto de stock | `https://sistemaatracciones-backend.vercel.app/api/v1/contracts/inventory.proto` |

**Sin autenticación**, como define el contrato (no declara `security` en ninguna operación).

## 2. Las 20 operaciones del contrato

Todas están implementadas. El test [`contract-coverage.spec.ts`](../backend/src/contract-coverage.spec.ts) lo verifica en cada CI: si falta una o aparece una ruta no declarada, el CI falla.

| Operación | Notas |
|---|---|
| `GET /atracciones/categorias/arbol` | Árbol con `incluye_comida`, `incluye_transporte` e `incluye_guia`. Los ids son `cat-<n>` |
| `GET /atracciones/categorias?padre_id=` | Sin `padre_id` devuelve las categorías raíz |
| `POST /atracciones/search` | Filtra por destino, rango de fechas (con cupos para `adult_count`), precio, duración, idioma del guía, accesibilidad, animales, cancelación gratuita y categoría (incluye sus subcategorías) |
| `GET /atracciones` | Parámetros `city`, `categoria_id`, `incluye_*`, `page`, `limit` (≤ 50) y `sort` |
| `GET /atracciones/{id}` | `id` = UUID **o slug**. Incluye itinerario, calificación por pilares, accesibilidad, punto de encuentro con coordenadas, idiomas del guía, política de cancelación, `permite_paquete`, descuento y proveedor |
| `GET /atracciones/{id}/availability` y `/disponibilidad` | Turnos con `AGOTADO` (0 cupos), `ULTIMOS_CUPOS` (≤ 3) o `DISPONIBLE`, en formato «10:30 a.m.» |
| `POST /atracciones/reservas` y `/atracciones/{id}/reservations` | **201** con `external_order_id` (`ORD-…`), código PNR (`DEC-…`), voucher QR firmado y `Location`. **409 `OUT_OF_STOCK`** para activar la compensación de la saga |
| `GET /atracciones/reservas/{id}` y `/reservations/{id}` | Por UUID o por código PNR |
| `POST …/cancel` (ambas rutas) | Compensación de la saga: devuelve los cupos, reembolsa y es idempotente |
| `POST …/checkin` (ambas rutas) | Valida el documento del titular y/o el QR del voucher; la reserva pasa a `CHECKED_IN` |
| `GET` y `PUT /atracciones/promociones/contrato` | Cuestionario B2B: permite promociones, porcentaje máximo (0 a 50), destinos, vigencia y condiciones |
| `GET /atracciones/eventos` | Outbox con cursor `after`. Tipos: `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `STOCK_ACTUALIZADO` y `RESERVA_CANCELADA` |
| `GET /atracciones/health` | Semáforo del nodo: `UP` con latencia < 200 ms, `DEGRADED` por encima, `DOWN` con **503** si la base no responde o está activo el kill-switch |

**Cabeceras:**
- `X-Correlation-Id` se devuelve igual y queda en los logs, en los eventos del outbox y en los metadatos del envío gRPC.
- `Idempotency-Key` (UUID) es **obligatoria** al reservar y cancelar: la misma clave repite la respuesta sin duplicar cupos ni cobros.

**Errores:** RFC 7807 con `code`, `correlation_id`, `timestamp` e `invalid_params` (`[{ name, reason }]`).

## 3. Sincronización de stock por gRPC (CE01)

Descubre EC es el **cliente**: después de cada venta, cancelación o cambio de aforo (fechas bloqueadas o reabiertas), envía `inventory.InventoryStockService/PushStockUpdate` con los cupos que quedan en ese turno.

| Variable (Vercel) | Valor por defecto | Para qué |
|---|---|---|
| `BOOKING_GRPC_URL` | `booking.epn.edu.ec:50051` | Servidor gRPC de Booking (en local: `localhost:50051`) |
| `BOOKING_GRPC_TLS` | `true` con dominio público; `false` con `localhost` o un nombre de Docker | TLS en producción, h2c en red interna |
| `BOOKING_SERVICE_ID` | `atracciones-dilan` | `service_id` del mensaje |
| `BOOKING_GRPC_ENABLED` | `true` (en pruebas `false`) | Apagar el envío |
| `NODE_ID` / `NODE_CODE` | `node-dilan-atracciones-01` / `DILAN_ATRACCIONES` | Identidad del nodo en `/health` |
| `NODE_KILL_SWITCH` | — | `true` fuerza `DOWN` (para probar el foco rojo) |

**Garantías:**
- **No afecta a la venta:** el envío ocurre después de confirmar la transacción. Si Booking no responde, la reserva igual se confirma.
- **Todo queda registrado:** cada envío se guarda en `ops.sync_stock` con su estado, intentos, latencia y respuesta. Se ve en **Panel → Observabilidad → Sincronización de stock con Booking**, que tiene el botón «Reintentar pendientes».
- **Reintentos:** lo que falla se reintenta en el siguiente envío, hasta 10 veces. Si llega un valor más nuevo del mismo turno, el anterior se descarta, porque solo importa el último.
- **Probado de punta a punta:** las pruebas E2E levantan un servidor gRPC que simula a Booking y verifican el mensaje recibido y el correlation id ([booking-v2.e2e-spec.ts](../backend/test/e2e/booking-v2.e2e-spec.ts)).

## 4. Decisiones donde el contrato no era explícito

| Tema | Decisión |
|---|---|
| Estado de una reserva v2 | El contrato solo tiene `CONFIRMED`, `CHECKED_IN` y `CANCELLED`, y dice que el 201 es «compra confirmada». Por eso toda reserva v2 nace **confirmada**. Con `TARJETA_CREDITO` o `SOA_BOOKING_GATEWAY` el pago queda aprobado y se emite factura; con `TRANSFERENCIA` o `PAGO_EN_SITIO` el pago queda pendiente (extensión `payment_status: PENDING`) |
| Dueño de la orden | Las órdenes de Booking pertenecen a un usuario técnico «Booking Prototipo» que no puede iniciar sesión. El cliente real queda como titular de la reserva |
| 409 | `OUT_OF_STOCK` cuando no hay cupos, el turno está cerrado o la fecha está bloqueada |
| 422 | Cédula con dígito verificador inválido, pasaporte o RUC mal formado (`code: INVALID_DOCUMENT`) |
| Cancelación por `CLIENTE` | Solo dentro del plazo de cancelación gratuita (fuera de plazo responde 400). `SAGA_ORCHESTRATOR` y `ADMIN` cancelan siempre, con reembolso total |
| Cancelar una reserva ya cancelada | 200 con la reserva cancelada: la compensación es idempotente |
| Check-in | Si la reserva tiene documento, debe coincidir. Si no lo tiene, se valida con el QR del voucher (firmado con HMAC: no se puede falsificar). Una vez hecho el check-in, la reserva ya no se cancela |
| Escalas | La calificación se expresa sobre 10 (internamente es de 1 a 5). Las reseñas sin nota por pilar aportan su nota general a cada pilar |
| Edades y tarifas | Adulto 13 a 64 años; niño 5 a 12 (tarifa niño); senior 65 o más (tarifa `MAYOR`; 60 % del adulto en los datos de demostración); infante 0 a 4 (gratis, pero ocupa cupo) |
| Descuento en paquetes | El de cada atracción, nunca mayor que el máximo del acuerdo B2B. Si el acuerdo no permite promociones, es 0 |
| Pasaporte y teléfono | Pasaporte de 6 a 9 letras o números. Teléfono E.164 (`+…`) o ecuatoriano; `+5939…` se guarda como `09…` |

## 5. Observaciones sobre el archivo del contrato (para el equipo de Booking)

Al validarlo con Redocly (`npx @redocly/cli lint`) aparecen **3 errores de estructura**. No afectan a la implementación, pero conviene corregirlos en la próxima versión:

| Línea | Problema |
|---|---|
| 594 | La respuesta `200` de `GET /atracciones/reservations/{reservationId}` no tiene `description` (obligatoria en OpenAPI 3.0) |
| 663 | La respuesta `200` del alias `POST /atracciones/reservations/{reservationId}/cancel` no tiene `description` |
| 735 | La respuesta `200` del alias `POST /atracciones/reservations/{reservationId}/checkin` no tiene `description` |

Los otros 19 errores de Redocly son `security-defined`: ninguna operación declara seguridad, aunque el contrato define `BearerAuth` y `ApiKeyAuth`. Si Booking quiere exigir `X-API-Key`, basta con declararlo en el contrato; en el código es un cambio pequeño.

## 6. Probarlo rápido

```bash
API=https://sistemaatracciones-backend.vercel.app/api/v2
curl -s $API/atracciones/health
curl -s "$API/atracciones?city=Quito&limit=2"
ID=$(curl -s "$API/atracciones?limit=1" | jq -r '.data[0].id')
curl -s "$API/atracciones/$ID/availability?date=2026-11-10"
curl -s -X POST $API/atracciones/reservas \
  -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen)" -H "X-Correlation-Id: cid-prueba-001" \
  -d '{"atraccion_id":"'$ID'","fecha":"2026-11-10","hora":"09:00 a.m.","adult_count":2,
       "customer":{"full_name":"Paúl Rosero","email":"paul.rosero@epn.edu.ec","phone":"+593991234567",
                   "document_type":"CEDULA","document_id":"1710034065"},
       "payment_method":"SOA_BOOKING_GATEWAY","saga_id":"SAGA-PRUEBA-1"}'
```
