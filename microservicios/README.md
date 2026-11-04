# Microservicios de Descubre EC

Los **11 microservicios** que necesita la integración completa con Booking Prototipo, más el **API Gateway**
que Booking registra como nodo `NODE_ATR_DILAN`. Cada uno tiene su base (sección del script del equipo
`02_microservicios_v2_bases_de_datos.sql`, copiada sin cambios como `sql/001`), su contrato y sus pruebas.
Se comunican con la tecnología que fija el script: **gRPC**, **REST** o **SOAP**.

| Servicio | HTTP | Protocolo entre servicios | Contrato | Qué hace |
|---|:-:|---|---|---|
| `ms-location` | 4001 | REST | [openapi](ms-location/contract/openapi.yaml) | Regiones, provincias y ciudades |
| `ms-catalog` | 4002 | REST | [openapi](ms-catalog/contract/openapi.yaml) | Atracciones y categorías. **Catálogo del contrato v3** |
| `ms-review` | 4003 | REST | [openapi](ms-review/contract/openapi.yaml) | Reseñas; publica `RESENA_PUBLICADA` a ms_catalog |
| `ms-pricing` | 4004 | **gRPC** :50044 | [proto](proto/pricing.proto) · [openapi](ms-pricing/contract/openapi.yaml) | Tarifas versionadas; publica `PRECIO_ACTUALIZADO` |
| `ms-inventory` | 4005 | **gRPC** :50045 | [proto](proto/inventario.proto) · [openapi](ms-inventory/contract/openapi.yaml) | Cupos por turno sin sobreventa. **Disponibilidad v3** y **stock a Booking** (`PushStockUpdate`) |
| `ms-coupon` | 4006 | REST | [openapi](ms-coupon/contract/openapi.yaml) | Cupones y **acuerdo de promociones v3** |
| `ms-order` | 4007 | **gRPC** :50047 | [proto](proto/orden.proto) · [openapi](ms-order/contract/openapi.yaml) | Órdenes, una línea por tipo de boleto |
| `ms-booking` | 4008 | **gRPC** :50048 | [proto](proto/reserva.proto) · [openapi](ms-booking/contract/openapi.yaml) | **Reservas v3** (crear, consultar, cancelar, check-in, QR, eventos): orquesta la saga |
| `ms-payment` | 4009 | REST | [openapi](ms-payment/contract/openapi.yaml) | Pagos simulados (tarjeta, transferencia, en sitio, pasarela de Booking) |
| `ms-refund` | 4010 | REST | [openapi](ms-refund/contract/openapi.yaml) | Reembolsos, nunca más de lo cobrado |
| `ms-invoicing` | 4011 | **SOAP** | [WSDL](ms-invoicing/contract/facturacion.wsdl) | Facturas con su detalle y clave de acceso SRI |
| `gateway` | 8080 | — | — | **La URL que se registra en Booking.** Reparte cada ruta al servicio dueño |

## Cómo atiende a Booking

```
Booking ──► Gateway /api/v3 ─┬─► ms-catalog    árbol, categorías, listado, búsqueda, ficha
                             ├─► ms-inventory  /atracciones/{id}/disponibilidad
                             ├─► ms-coupon     /atracciones/promociones/contrato
                             └─► ms-booking    reservas (también {baseUrlRest}/reservas), check-in, vouchers, eventos, .ics

ms-booking (saga) ── REST ──► ms-catalog ─► ms-location
                  ── gRPC ──► ms-pricing · ms-inventory (retener/liberar cupos) · ms-order
                  ── REST ──► ms-payment · ms-refund
                  ── SOAP ──► ms-invoicing
ms-inventory ── gRPC ──► Booking (inventory.InventoryStockService/PushStockUpdate)
```

- **Crear reserva:** catálogo → tarifas → **retener cupos** (sin cupos → `409 OUT_OF_STOCK`) → orden → pago → reserva y eventos. Si un paso falla se **compensa** en orden inverso (libera cupos, reembolsa o anula el pago, cancela la orden). La orden PAGADA y la factura se hacen **después de responder** (Booking corta a los 4 s): quedan marcadas como pendientes y, si facturación no responde, se reintentan solas cada 30 s.
- **Cancelar:** libera cupos → reembolso (si se cobró) → orden REEMBOLSADA → factura ANULADA (conserva su detalle). Cada paso es idempotente: reintentar completa lo que faltó.
- Los errores del contrato (`409 OUT_OF_STOCK`, `422 INVALID_DOCUMENT`…) llegan iguales a Booking aunque pasen por gRPC o SOAP: viajan en `details` (gRPC) o en el `<detail>` del Fault (SOAP).
- Ver a dónde va cada ruta: `GET /gateway/rutas`. Salud de los 11: `GET /api/v3/health` (DOWN si cae catálogo, inventario o reservas; DEGRADED si cae otro).

## Levantar en local

```bash
cd microservicios && docker compose up -d      # una base por servicio (puerto 5434) y sus copias _test
npm install
npm run migrar                                  # copia los datos de la tienda (5433) con los mismos IDs
bash scripts/arrancar-todo.sh                   # los 11 + gateway; claves de backend/.env
GATEWAY_URL=http://localhost:8080 BOOKING_API_KEY=<clave> node scripts/prueba-humo.js
```

`npm run migrar` copia **siempre** catálogo, ubicación y reseñas, y los servicios transaccionales (precios, inventario, cupones, órdenes, reservas, pagos, reembolsos, facturas) **solo si su base está vacía**: desde la copia inicial sus datos son suyos (`MIGRAR_FORZAR=true` para volver a copiarlos). Con un volumen de Docker ya creado, las bases nuevas se crean con `docker exec descubre_ms_db psql -U postgres -c "CREATE DATABASE ms_<servicio>"`.

## En la nube (Azure Container Apps + Supabase)

```bash
cp deploy/azure/.env.example deploy/azure/.env   # llenar (Supabase, JWT_SECRET, BOOKING_API_KEY)
az login
bash deploy/azure/desplegar.sh                    # Docker Desktop encendido
```

- Una sola imagen (`microservicios/Dockerfile`); `SERVICIO` elige cuál arranca. Solo el **gateway** es público (HTTPS).
- Los 4 servicios gRPC exponen su puerto como **puerto TCP adicional interno** (`descubre-pricing:50044`…).
- Base: el proyecto de Supabase de la tienda, **un schema por servicio** (`DB_SCHEMA`) por el *Session pooler*. Su `search_path` empieza por su schema y solo al final incluye `extensions` y `public` (para pgcrypto y pg_trgm). El pooler gratuito admite ~15 conexiones: 1 por servicio (2 en catálogo, inventario y reservas).
- La copia de datos corre como **job** dentro de Azure (muchas redes bloquean 5432/6543 hacia Supabase).

## Pruebas

```bash
npm test --workspace gateway
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_<servicio>_test npm test --workspace ms-<servicio>
```

Cada respuesta se valida contra el contrato del servicio y, las del contrato con Booking, contra los esquemas **oficiales** del v3. `ms-booking/test/saga.spec.ts` levanta los **7 servicios reales** de la saga en un proceso (cada uno en su schema) y prueba la compra, la idempotencia, `OUT_OF_STOCK`, la compensación si cae un servicio, la cancelación con reembolso, el check-in y la factura pendiente. Con una sola base y schemas, como en la nube: `DB_SCHEMA=ms_<servicio>`. Logs en pruebas: `LOGS_EN_PRUEBAS=1`.

## Qué se agregó al script del equipo (avisar al equipo)

Lo del script no cambia (`sql/001`); lo que pide el contrato con Booking va en `sql/002_*`. Casi todo se **agrega**; tres reglas se **amplían**:

- **ms_catalog:** inclusiones (`*_incluye_*`), accesibilidad, guía, instrucciones de llegada, paquetes; `atraccion_itinerario`; proyecciones `tarifa_vigente` y pilares de calificación; inbox `evento_recibido`.
- **ms_review:** notas por pilar y outbox `evento`.
- **ms_pricing:** tipo de tarifa `ESTUDIANTE` (se amplía `tarifa_tipo_valido`) y outbox `evento`.
- **ms_inventory:** `atraccion_ref` (UUID de cada atracción), `retencion` (cupos por reserva, idempotente), `sync_stock` (envíos a Booking) y outbox `evento`.
- **ms_coupon:** `acuerdo_promocion` y `acuerdo_promocion_destino` (acuerdo B2B con Booking).
- **ms_payment:** método `SOA_BOOKING_GATEWAY` (Booking cobra en su pasarela).
- **ms_booking:** estado `CHECKED_IN`; adultos mayores, estudiantes e infantes (se amplía `reserva_total_coherente`); RUC y pasaportes alfanuméricos (se amplía `dom_documento`); fecha y hora del turno, check-in, `client_id` del turista (v3.1), IDs lógicos de orden y pago, copia de la atracción y del pago; `idempotencia`, feed `evento` y `parametro`.
- **ms_order:** sin cambios de tablas. Una línea de orden por tipo de boleto (así cuadra `det_subtotal = det_cantidad × det_precio_unitario` y cada línea se factura una vez, `factura_detalle.det_id` es único).

## Eventos entre servicios (CloudEvents 1.0, `X-Servicio-Token`)

| Evento | Lo publica | Lo recibe |
|---|---|---|
| `RESENA_PUBLICADA` | ms_review | ms_catalog `POST /api/v1/internal/eventos` (promedio y pilares) |
| `PRECIO_ACTUALIZADO` | ms_pricing | ms_catalog (proyección `tarifa_vigente`) |
| `STOCK_ACTUALIZADO` | ms_inventory | ms_booking (feed `GET /atracciones/eventos` de Booking) |

Outbox con reintentos (cada 3 s, hasta 20); el receptor descarta repetidos por `event_id`.
