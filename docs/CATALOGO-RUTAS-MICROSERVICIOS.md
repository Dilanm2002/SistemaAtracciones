# Catálogo de rutas de los microservicios — Descubre EC

Estado al **9 de noviembre de 2026**, commit `59129aa` de `main`. Las rutas salen de los controladores del código
(`microservicios/*/src`), no de un documento aparte: si cambia una ruta, hay que actualizar esta tabla.

## Versión actual

| Pieza | Versión | Dónde corre |
|---|---|---|
| Contrato con Booking | **v3.1**: el v3.0.0 oficial (`backend/contracts/atracciones-openapi-v3.yaml`) más `/clientes` y el aviso de check-in | Nodo `NODE_ATR_DILAN` |
| Microservicios (12 + BFF + gateway) | **1.0.0** (`microservicios/package.json`) | Azure Container Apps, `chilecentral` |
| Imagen desplegada | `76f166b` en los servicios y `ba5cc17` en el gateway | Registro `descubreecdilan` |
| Web y API de la tienda | **2.9.0** publicada, con cambios sin numerar desde entonces (ver `CHANGELOG.md`, «Sin publicar») | Vercel, desplegada desde `main` |

La última etiqueta de git es `v2.0.0`: las versiones 2.1.0 a 2.9.0 están en el `CHANGELOG.md` pero no se etiquetaron.

## Cómo se llega a cada ruta

Todo entra por un único gateway público:

```
https://descubre-gateway.livelymoss-5ea81cc6.chilecentral.azurecontainerapps.io
```

| Prefijo en el gateway | Va a | Para quién |
|---|---|---|
| `/api/v3/…` (y `/api/v2/…`) | el microservicio dueño de cada ruta del contrato | Booking |
| `/bff/v1/…` | `bff-web`, que lo traduce a los microservicios | La web y el panel |
| `/ms/<servicio>/v1/…` | `/api/v1/…` de ese servicio | El equipo y depuración |
| `/api/v3/health`, `/gateway/rutas` | las responde el propio gateway | Semáforo de Booking y la demo |

- `<servicio>` es `location`, `catalog`, `review`, `pricing`, `inventory`, `coupon`, `order`, `booking`, `payment`,
  `refund`, `invoicing` o `identity`.
- Las rutas `/internal/…` nunca se publican: el gateway responde 404 aunque se pidan por `/ms/…`.
- Cualquier ruta que no esté en estas tablas responde 404 desde el gateway.

### Seguridad de cada ruta

| Marca | Qué exige |
|---|---|
| Pública | Nada |
| Socio | `X-API-Key` de Booking, o un JWT de rol ADMIN |
| JWT | `Authorization: Bearer <token>` de la tienda. Entre corchetes, los roles permitidos |
| Sesión | Igual que JWT; el BFF lo comprueba y lo reenvía al microservicio |
| Interna | `X-Servicio-Token`, solo entre servicios |
| + Idem. | Además, la cabecera `Idempotency-Key` (UUID) |

## 1. Contrato con Booking (`/api/v3`)

Todas existen también en `/api/v2`, salvo `/clientes`, que solo existe en v3.

| Método | Ruta | Seguridad | Servicio |
|---|---|---|---|
| GET | `/atracciones/categorias/arbol` | Pública | ms-catalog |
| GET | `/atracciones/categorias` | Pública | ms-catalog |
| GET | `/atracciones` | Pública | ms-catalog |
| POST | `/atracciones/search` | Pública | ms-catalog |
| GET | `/atracciones/{id}` (UUID o slug) | Pública | ms-catalog |
| GET | `/atracciones/{id}/disponibilidad?date=AAAA-MM-DD` | Pública | ms-inventory |
| GET | `/atracciones/promociones/contrato` | Socio | ms-coupon |
| PUT | `/atracciones/promociones/contrato` | Socio | ms-coupon |
| POST | `/atracciones/reservas` | Socio + Idem. | ms-booking |
| GET | `/atracciones/reservas/{id}` | Socio | ms-booking |
| POST | `/atracciones/reservas/{id}/cancel` | Socio + Idem. | ms-booking |
| POST | `/atracciones/reservas/{id}/checkin` | Socio + Idem. | ms-booking |
| GET | `/atracciones/eventos` | Socio | ms-booking |
| GET | `/atracciones/vouchers/{código}/qr.png` | Pública | ms-booking |
| POST | `/reservas` (URL base de la guía de socios) | Socio + Idem. | ms-booking |
| GET | `/reservas/{id}` | Socio | ms-booking |
| POST | `/reservas/{id}/cancel` | Socio + Idem. | ms-booking |
| POST | `/reservas/{id}/checkin` | Socio + Idem. | ms-booking |
| GET | `/clientes?email=…&identificacion=…` (basta uno; también `identification`) | Socio | ms-identity |
| POST | `/clientes` (idempotente: 201 nuevo, 200 si ya existía) | Socio | ms-identity |
| GET | `/health` y `/atracciones/health` | Pública | gateway (salud de los 12) |

`GET /api/v1/calendario/{uuid}.ics?t=…` es el enlace firmado de «Añadir al calendario» que va en cada reserva
(ms-booking).

### Lo que nuestro sistema llama en Booking

Host `https://booking-core-api.azurewebsites.net`, siempre con la `X-API-Key` del nodo.

| Método | Ruta | Lo llama | Cuándo |
|---|---|---|---|
| POST | `/api/v3/inventory/stock` | ms-inventory | Cada cambio de cupos (venta, cancelación, aforo). Reintenta hasta 10 veces |
| POST | `/api/v3/reservas/{código}/checkin` | ms-booking | Tras el check-in de una reserva de Booking. Reintenta cada 30 s durante una hora |

## 2. Web y panel (`/bff/v1`)

| Método | Ruta | Seguridad | Qué hace |
|---|---|---|---|
| POST | `/atracciones/search` | Pública | Buscador con filtros y orden |
| POST | `/atracciones/details` | Pública | Varias atracciones por id |
| GET | `/atracciones` | Pública (con `status=all`, personal) | Listado; destacadas con `featured=true` |
| GET | `/atracciones/{id}` | Pública | Ficha con horarios y precios |
| GET | `/atracciones/{id}/availability?date=` | Pública | Cupos de un día |
| GET | `/atracciones/{id}/availability/calendar?month=` | Pública | Cupos de un mes |
| GET | `/atracciones/{id}/reviews` | Pública | Reseñas y su distribución |
| GET | `/atracciones/{id}/reviews/eligibility` | Sesión | Si el usuario puede reseñar |
| POST | `/atracciones/{id}/reviews` | Sesión | Crear reseña (solo tras vivir la experiencia) |
| POST | `/atracciones/{id}/reservations` | Sesión + Idem. | Compra desde la web |
| GET | `/atracciones/reservations` | Sesión | Mis reservas; con `all=true`, las del panel |
| GET | `/atracciones/reservations/{id}` | Sesión | Una reserva (propia, o del personal autorizado) |
| GET | `/atracciones/reservations/{id}/calendar-link` | Sesión | Enlace al `.ics` |
| POST | `/atracciones/reservations/{id}/cancel` | Sesión + Idem. | Cancelar |
| POST | `/atracciones/reservations/{id}/confirm` | Sesión + Idem. | Confirmar un pago pendiente (personal) |
| POST | `/atracciones/reservations/{id}/checkin` | Sesión + Idem. | Check-in presencial (personal) |
| POST | `/atracciones` | Sesión (personal) | Crear atracción con precios y cupos |
| PATCH | `/atracciones/{id}` | Sesión (personal) | Editar, publicar o desactivar |
| DELETE | `/atracciones/{id}` | Sesión (personal) | Eliminar |
| POST | `/atracciones/{id}/review` | Sesión (ADMIN) | Aprobar o rechazar lo que subió una empresa |
| GET | `/atracciones/{id}/blocked-dates` | Pública | Fechas bloqueadas |
| POST | `/atracciones/{id}/blocked-dates` | Sesión (personal) | Bloquear una fecha |
| DELETE | `/atracciones/{id}/blocked-dates/{bid}` | Sesión (personal) | Desbloquear |
| GET | `/turistas` | Sesión (ADMIN) | Turistas registrados por Booking |
| GET | `/health` | Pública | Salud del BFF |

El inicio de sesión, las fotos (`/api/v1/media/…`), las categorías, los destinos y los reportes siguen en la API de
la tienda en Vercel (`https://sistemaatracciones-backend.vercel.app/api/v1`).

## 3. API propia de cada microservicio (`/ms/<servicio>/v1`)

Todos responden además `GET /health`.

**ms-location** (puerto 4001)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/regiones` | Pública |
| GET | `/provincias` · `/provincias/{prov_id}` | Pública |
| GET | `/ciudades` · `/ciudades/{ciu_id}` | Pública |

**ms-catalog** (4002)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/categorias` · `/categorias/arbol` · `/categorias/{cat_id}` | Pública |
| GET | `/idiomas` · `/inclusiones` | Pública |
| GET | `/operadores` · `/operadores/{ope_id}` | Pública |
| GET | `/atracciones` · `/atracciones/{ref}` | Pública |
| POST | `/atracciones` | JWT [ADMIN, OPERADOR] |
| PATCH | `/atracciones/{atr_id}` | JWT [ADMIN, OPERADOR] |
| DELETE | `/atracciones/{atr_id}` | JWT [ADMIN, OPERADOR] |
| POST | `/internal/eventos` | Interna |

**ms-review** (4003)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/resenas?atr_id=` · `/resenas/resumen` · `/resenas/{ren_id}` | Pública |
| POST | `/resenas` | Pública (con JWT queda a nombre del usuario) |
| PATCH | `/resenas/{ren_id}/visibilidad` | JWT [ADMIN] |
| POST | `/resenas/eventos/reintentar` | JWT [ADMIN] |

**ms-pricing** (4004 · gRPC 50044)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/tarifas?atr_id=` · `/tarifas/{atr_id}/historial` | Pública |
| PUT | `/tarifas/{atr_id}` | JWT [ADMIN, OPERADOR] |

**ms-inventory** (4005 · gRPC 50045)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/horarios?atr_id=` · `/disponibilidad?atr_id=` · `/turnos/{dis_id}` | Pública |
| PUT | `/horarios/{atr_id}` | JWT [ADMIN, OPERADOR] |
| GET | `/fechas-bloqueadas?atr_id=` | Pública |
| POST | `/fechas-bloqueadas` | JWT [ADMIN, OPERADOR] |
| DELETE | `/fechas-bloqueadas/{fb_id}` | JWT [ADMIN, OPERADOR] |
| GET | `/stock/sync` | JWT [ADMIN] |
| POST | `/stock/reintentar` | JWT [ADMIN] |

**ms-coupon** (4006)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/cupones` | JWT [ADMIN] |
| POST | `/cupones` | JWT [ADMIN] |
| GET | `/cupones/{codigo}/validar` | Pública |
| GET | `/internal/acuerdo` | Interna |

**ms-order** (4007 · gRPC 50047)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/ordenes` · `/ordenes/{ord_id}` | JWT [ADMIN] |

**ms-booking** (4008 · gRPC 50048)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/reservas` | JWT [ADMIN] |
| GET | `/web/reservas` · `/web/reservas/{id}` · `/web/reservas/{id}/calendario` | JWT (las propias; el personal, las de su empresa) |
| POST | `/web/reservas` | JWT + Idem. |
| POST | `/web/reservas/{id}/cancelar` | JWT + Idem. |
| POST | `/web/reservas/{id}/confirmar` · `/web/reservas/{id}/checkin` | JWT [ADMIN, OPERADOR] + Idem. |
| GET | `/calendario/{uuid}.ics?t=` | Pública (enlace firmado) |
| POST | `/internal/eventos` | Interna |

**ms-payment** (4009)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/metodos-pago` | Pública |
| POST · GET | `/internal/pagos` · `/internal/pagos/{pag_id}` | Interna |
| POST | `/internal/pagos/{pag_id}/aprobar` · `/internal/pagos/{pag_id}/rechazar` | Interna |

**ms-refund** (4010)

| Método | Ruta | Seguridad |
|---|---|---|
| POST · GET | `/internal/reembolsos` | Interna |

**ms-invoicing** (4011)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/facturas` | JWT [ADMIN] |

**ms-identity** (4012)

| Método | Ruta | Seguridad |
|---|---|---|
| GET | `/clientes?q=&page=&limit=` | JWT [ADMIN] |

## 4. gRPC y SOAP entre servicios (no pasan por el gateway)

| Servicio | Protocolo | Dirección interna | Operaciones | Contrato |
|---|---|---|---|---|
| ms-pricing | gRPC | `descubre-pricing:50044` | `ObtenerTarifas` | `microservicios/proto/pricing.proto` |
| ms-inventory | gRPC | `descubre-inventory:50045` | `RetenerCupos`, `LiberarCupos`, `ObtenerTurno` | `microservicios/proto/inventario.proto` |
| ms-order | gRPC | `descubre-order:50047` | `CrearOrden`, `CambiarEstado`, `ObtenerOrden` | `microservicios/proto/orden.proto` |
| ms-booking | gRPC | `descubre-booking:50048` | `ObtenerReserva` | `microservicios/proto/reserva.proto` |
| ms-invoicing | SOAP | `http://descubre-invoicing/soap/facturacion` | `EmitirFactura`, `ObtenerFactura`, `AnularFactura` | `microservicios/ms-invoicing/contract/facturacion.wsdl` |

`microservicios/proto/inventory.proto` es el contrato de Booking (`PushStockUpdate`): se conserva para el canal gRPC,
que hoy está apagado porque Booking recomienda el REST.

## 5. Eventos entre servicios

CloudEvents 1.0 con `X-Servicio-Token`, a `POST /api/v1/internal/eventos` del receptor. Outbox con reintentos cada
3 s, hasta 20 veces.

| Evento | Lo publica | Lo recibe |
|---|---|---|
| `RESENA_PUBLICADA` | ms-review | ms-catalog (promedio y pilares) |
| `PRECIO_ACTUALIZADO` | ms-pricing | ms-catalog (precio vigente) |
| `STOCK_ACTUALIZADO` | ms-inventory | ms-booking (feed `/atracciones/eventos` de Booking) |
