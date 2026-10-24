# Integración con Booking Prototipo — contrato v2 (RDA2)

Qué implementa Descubre EC del contrato **final** [`backend/contracts/atracciones-openapi-v2.yaml`](../backend/contracts/atracciones-openapi-v2.yaml), cómo probarlo y qué decisiones se tomaron donde el contrato no era explícito.

El archivo es **el que envió el equipo de Booking, sin modificar**. Redocly lo valida sin errores: solo da 29 avisos de estilo (falta `operationId`, etc.).

## 1. Dónde está

| | URL |
|---|---|
| **API v2 (contrato con Booking)** | `https://sistemaatracciones-backend.vercel.app/api/v2` |
| API v1 (contrato anterior y web, sin cambios) | `https://sistemaatracciones-backend.vercel.app/api/v1` |
| Swagger (v1 y v2) | `https://sistemaatracciones-backend.vercel.app/api/docs` |
| Contrato v2 publicado | `https://sistemaatracciones-backend.vercel.app/api/v1/contracts/atracciones-openapi-v2.yaml` |
| Proto de stock | `https://sistemaatracciones-backend.vercel.app/api/v1/contracts/inventory.proto` |

## 2. Seguridad (como dice el contrato)

El contrato declara `security: [BearerAuth, ApiKeyAuth]`: basta con **una** de las dos.

| Operaciones | Acceso |
|---|---|
| `GET /atracciones/categorias/arbol`, `GET /atracciones/categorias`, `POST /atracciones/search`, `GET /atracciones`, `GET /atracciones/{id}`, `GET /atracciones/{id}/disponibilidad`, `GET /atracciones/health` | **Públicas** (`security: []`) |
| `POST /atracciones/reservas`, `GET /atracciones/reservas/{id}`, `POST …/cancel`, `POST …/checkin`, `GET`/`PUT /atracciones/promociones/contrato`, `GET /atracciones/eventos` | **`X-API-Key`** (Booking) **o** `Authorization: Bearer <JWT>` de un administrador de Descubre EC |

- **Sin credenciales: 401** (`code: UNAUTHORIZED`).
- **Con un JWT que no es de administrador: 403** (`code: FORBIDDEN`).
- **La clave se configura en Vercel como `BOOKING_API_KEY`** (24 caracteres o más) y se comparte con el equipo de Booking por un canal privado. Mientras no esté configurada, ninguna clave es válida y solo funciona el JWT de administrador.

## 3. Las 16 operaciones del contrato

Todas están implementadas. El test [`contract-coverage.spec.ts`](../backend/src/contract-coverage.spec.ts) lo comprueba en cada CI: si falta una operación del contrato o aparece una ruta no declarada, el CI falla.

| Operación | Notas |
|---|---|
| `GET /atracciones/categorias/arbol` | Árbol con `incluye_comida`, `incluye_transporte` e `incluye_guia`. Los ids son `cat-<n>` |
| `GET /atracciones/categorias?padre_id=` | Sin `padre_id` devuelve las categorías raíz |
| `POST /atracciones/search` | Filtra por destino, rango de fechas (con cupos para `adult_count` o `cantidad_adultos`), precio, duración, idioma del guía, accesibilidad, animales, cancelación gratuita y categoría (incluye sus subcategorías) |
| `GET /atracciones` | `city`, `categoria_id`, `incluye_*`, `page`, `limit` (≤ 50) y `sort` |
| `GET /atracciones/{id}` | `id` = UUID **o slug**: itinerario, calificación por pilares, accesibilidad, punto de encuentro con coordenadas, política de cancelación, paquetes y proveedor |
| `GET /atracciones/{id}/disponibilidad` | `date` o `fecha`. Turnos con `slot_id` (`slot-AAAAMMDD-HHMM`), `time` («10:30 a.m.»), `time_24h` y estado `AGOTADO`, `ULTIMOS_CUPOS` (≤ 3) o `DISPONIBLE` |
| `POST /atracciones/reservas` | Requiere `atraccion_id`, `fecha`, **`slot_id`**, `hora`, `adult_count`, `customer` y `payment_method`. Devuelve **201** con `external_order_id` (`ORD-…`), código PNR (`DEC-…`), voucher QR firmado y `Location`. **409 `OUT_OF_STOCK`** activa la compensación de la saga |
| `GET /atracciones/reservas/{id}` | Por UUID o por código PNR |
| `POST /atracciones/reservas/{id}/cancel` | Compensación: devuelve los cupos y reembolsa (`reembolso_id`, `monto_reembolsado`). Es idempotente |
| `POST /atracciones/reservas/{id}/checkin` | Documento del titular y/o QR del voucher. Con la **misma** `Idempotency-Key` responde de nuevo el pase emitido (200); con otra, 409 |
| `GET` y `PUT /atracciones/promociones/contrato` | Cuestionario B2B: permite promociones, descuento máximo (0 a 50 %), destinos, vigencia y condiciones |
| `GET /atracciones/eventos` | **CloudEvents 1.0** (`specversion`, `source`, `data`) con cursor `after`. Tipos: `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `STOCK_ACTUALIZADO` y `RESERVA_CANCELADA` |
| `GET /atracciones/health` | Semáforo del nodo: `UP` con latencia < 200 ms, `DEGRADED` por encima, `DOWN` (**503**) si la base no responde o el kill-switch está activo |

**Datos que pide el contrato final:**
- **Cinco tipos de boleto:** adulto (13 a 64 años), niño (5 a 12), adulto mayor (65 o más), **estudiante con carnet** e infante (0 a 4 años, gratis pero ocupa cupo). Cada uno con su tarifa, su conteo en la reserva y su propia línea en la factura.
- **Alias en español** (`cantidad_adultos`, `nombre_completo`, `metodo_pago`, `observaciones`, `precio`, `itinerario`, `punto_encuentro_geo`…). Se aceptan en las peticiones; si llegan el campo principal y su alias, manda el principal. Las respuestas traen ambos nombres.
- **Estados de 6 fases:**
  - `PENDING` y `EXPIRED`: pendiente de pago (expira si su salida ya pasó sin pagarse);
  - `CONFIRMED`;
  - `CHECKED_IN`;
  - `COMPLETED`;
  - `CANCELLED`.

**Cabeceras y errores:**
- `X-Correlation-Id` se devuelve igual y queda en los logs, en los eventos y en los metadatos gRPC.
- `Idempotency-Key` es **obligatoria** al reservar, cancelar y hacer check-in.
- Errores en formato RFC 7807, con `code`, `correlation_id`, `timestamp` e `invalid_params` (`[{ name, reason }]`).

## 4. Sincronización de stock por gRPC (CE01)

Descubre EC es el **cliente**: después de cada venta, cancelación o cambio de aforo (fechas bloqueadas o reabiertas), envía `inventory.InventoryStockService/PushStockUpdate` con los cupos que quedan en ese turno.

| Variable (Vercel) | Valor por defecto | Para qué |
|---|---|---|
| **`BOOKING_API_KEY`** | — (obligatoria para que Booking reserve) | Clave `X-API-Key` que recibe Booking |
| `BOOKING_GRPC_URL` | `booking.epn.edu.ec:50051` | Servidor gRPC de Booking (en local: `localhost:50051`) |
| `BOOKING_GRPC_TLS` | `true` con dominio público; `false` con `localhost` o un nombre de Docker | TLS en producción, h2c en red interna |
| `BOOKING_SERVICE_ID` | `atracciones-dilan` | `service_id` del mensaje |
| `BOOKING_GRPC_ENABLED` | `true` (en pruebas, `false`) | Apagar el envío |
| `NODE_ID` / `NODE_CODE` | `node-dilan-atracciones-01` / `DILAN_ATRACCIONES` | Identidad del nodo en `/health` |
| `NODE_KILL_SWITCH` | — | `true` fuerza `DOWN` (para probar el foco rojo) |

**Garantías:**
- **No afecta a la venta:** el envío ocurre después de confirmar la transacción.
- **Todo queda registrado** en `ops.sync_stock` (estado, intentos, latencia y respuesta) y se ve en **Panel → Observabilidad**, con el botón «Reintentar pendientes».
- **Reintentos:** lo que falla se reintenta, hasta 10 veces, y un valor más nuevo del mismo turno descarta los anteriores.
- **Probado de punta a punta:** las pruebas E2E levantan un servidor gRPC que simula a Booking ([booking-v2.e2e-spec.ts](../backend/test/e2e/booking-v2.e2e-spec.ts)).

> **Al 24 de octubre de 2026, `booking.epn.edu.ec` no resuelve en DNS.** Los envíos quedan registrados como error y se reintentan solos. Cuando Booking tenga su servidor, basta con poner su dirección en `BOOKING_GRPC_URL`.

> El §2.1 del contrato describe la tabla `schema_atracciones.turnos_aforo`. En Descubre EC ese papel lo cumple la tabla `disponibilidad`: la consulta `/disponibilidad` la lee directamente y cada reserva bloquea su fila (`SELECT … FOR UPDATE`).

## 5. Decisiones donde el contrato no era explícito

| Tema | Decisión |
|---|---|
| Estado inicial de una reserva v2 | El 201 es «compra confirmada»: nace `CONFIRMED`. Con `TARJETA_CREDITO` o `SOA_BOOKING_GATEWAY` el pago queda aprobado y se emite factura; con `TRANSFERENCIA` o `PAGO_EN_SITIO` queda pendiente (extensión `payment_status: PENDING`) |
| Dueño de la orden | Un usuario técnico «Booking Prototipo» que no puede iniciar sesión. El cliente real queda como titular de la reserva |
| `slot_id`, `fecha` y `hora` | Deben referirse al mismo turno; si no coinciden, 400 |
| 409 | Al reservar: `OUT_OF_STOCK` (sin cupos, turno cerrado o fecha bloqueada). Al cancelar o hacer check-in: conflicto de estado (ya hizo check-in, ya se realizó o ya se registró con otra clave) |
| 422 | Cédula con dígito verificador inválido, pasaporte o RUC mal formado (`INVALID_DOCUMENT`) |
| Cancelación por `CLIENTE` | Solo dentro del plazo de cancelación gratuita (fuera de plazo, 400). `SAGA_ORCHESTRATOR` y `ADMIN` cancelan siempre, con reembolso total |
| Check-in | Si la reserva tiene documento, debe coincidir. Si no, se valida con el QR del voucher, que está firmado con HMAC y no se puede falsificar |
| Escalas | Calificación sobre 10 (internamente de 1 a 5). Las reseñas sin nota por pilar aportan su nota general |
| Tarifas de demostración | Adulto mayor: 60 % del adulto. Estudiante: 75 % (el «25 % típico» del contrato). Cada empresa las cambia en el panel |
| Descuento en paquetes | El de cada atracción, nunca mayor que el máximo del acuerdo B2B. Si el acuerdo no permite promociones, es 0 |

## 6. Probarlo rápido

```bash
API=https://sistemaatracciones-backend.vercel.app/api/v2
KEY="<BOOKING_API_KEY>"            # la que se acordó con Booking
curl -s $API/atracciones/health
ID=$(curl -s "$API/atracciones?limit=1" | jq -r '.data[0].id')
SLOT=$(curl -s "$API/atracciones/$ID/disponibilidad?date=2026-11-10" | jq -c '.time_slots[0]')
curl -s -X POST $API/atracciones/reservas \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "X-Correlation-Id: cid-prueba-001" \
  -d '{"atraccion_id":"'$ID'","fecha":"2026-11-10","slot_id":'$(echo $SLOT | jq .slot_id)',
       "hora":'$(echo $SLOT | jq .time_24h)',"adult_count":2,
       "customer":{"full_name":"Paúl Rosero","email":"paul.rosero@epn.edu.ec","phone":"+593991234567",
                   "document_type":"CEDULA","document_id":"1710034065"},
       "payment_method":"SOA_BOOKING_GATEWAY","saga_id":"SAGA-PRUEBA-1"}'
```
