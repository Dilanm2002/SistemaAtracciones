# Contratos de los microservicios — Descubre EC

> **Estado (versión 3.0.0):** estos son los contratos del **diseño** inicial (8 servicios con GraphQL y RabbitMQ). La
> implementación real tiene 12 servicios, sin GraphQL ni broker, y sus contratos vigentes están en
> `microservicios/<servicio>/contract/` y `microservicios/proto/`. Ver la tabla de estado al inicio de
> [ARQUITECTURA-MICROSERVICIOS.md](../ARQUITECTURA-MICROSERVICIOS.md).

Contratos de los 8 servicios de [ARQUITECTURA-MICROSERVICIOS.md](../ARQUITECTURA-MICROSERVICIOS.md), escritos **antes del código** (API-First / schema-first). Cada servicio se programa contra su contrato y el CI los valida.

El contrato público con Booking (`backend/contracts/`) **no cambia**: el gateway sigue publicando las mismas rutas. Productos y Reservas referencian esos esquemas en vez de copiarlos.

## Estructura

```text
microservicios/
├── catalogo.yaml                          registro de servicios: contratos, eventos, dependencias, SLA
├── comun/comun.yaml                       seguridad, cabeceras, Problem (RFC 7807), paginación, salud
├── eventos/atracciones-eventos.asyncapi.yaml   Event Bus RabbitMQ (exchange atracciones.eventos)
└── servicios/
    ├── usuarios/     openapi.yaml · subgraph.graphql
    ├── clientes/     openapi.yaml · subgraph.graphql
    ├── productos/    openapi.yaml · productos.proto · subgraph.graphql
    ├── stock/        openapi.yaml · stock.proto · subgraph.graphql
    ├── reservas/     openapi.yaml · reservas.proto · subgraph.graphql
    ├── pagos/        openapi.yaml
    ├── facturacion/  facturacion.proto · openapi.yaml · subgraph.graphql
    └── mapas/        openapi.yaml
```

## Qué expone cada servicio

| Servicio | Puerto | REST | gRPC | GraphQL (subgrafo) | Publica |
|---|:-:|---|---|---|---|
| Usuarios | 3001 | auth, cuenta, usuarios y roles, JWKS | — | `Usuario` | `usuario.registrado` / `.actualizado` |
| Clientes | 3008 | ficha, direcciones, favoritos, mensajes, operadores, datos de facturación (interno) | — | `Operador`; `Usuario.ficha`, `.favoritos` | `cliente.actualizado`, `operador.aprobado` |
| Productos | 3002 | catálogo (contrato Booking), tarifas, horarios, reseñas, catálogos | `GetAtraccion`, `BatchGetAtracciones` | `Atraccion`, `Ciudad`, `Categoria` | `atraccion.*` |
| Stock | 3003 | disponibilidad, calendario, fechas bloqueadas, retenciones (interno) | `GetDisponibilidad`, `GetTurno` | `Atraccion.disponibilidad` | `stock.actualizado` / `.retenido` / `.liberado` |
| Reservas | 3004 | reservas (contrato Booking), check-in, carrito, cupones | `CrearReserva`, `ObtenerReserva`, `CancelarReserva` | `Reserva`; `Usuario.reservas` | `reserva.*` |
| Pagos | 3005 | cobro (interno, 202), estado con tiempos, reembolsos, webhook, reporte de tiempos | — | — | `pago.aprobado` / `.rechazado` / `.expirado` / `.reembolsado` |
| Facturación | 3006 · 50056 | solo lectura (el gateway traduce a gRPC) | **interfaz principal**: `EmitirFactura`, `ObtenerFactura`, `AnularFactura`… | `Factura`; `Reserva.factura` | `factura.emitida` / `.anulada` |
| Mapas | 3007 | buscar, inversa, validar (interno) | — | — | — |

## Factura con su detalle

La factura se maneja siempre como **encabezado + detalle** (`factura` + `factura_detalle`, migración 007):

- **gRPC** (`facturacion.proto`): `Factura.lineas` es un `repeated LineaFactura`, nunca vacío. Cada línea tiene código, descripción, cantidad, precio unitario, descuento, base imponible, tarifa y valor de IVA, total y tipo de boleto (adulto, niño, adulto mayor, estudiante, infante).
- **REST** (`facturacion/openapi.yaml`): `Factura.lineas` con `minItems: 1`.
- **GraphQL**: `Factura.lineas: [LineaFactura!]!`, también al pedir `Reserva.factura`.
- **Evento** `atracciones.factura.emitida` / `.anulada`: viaja el encabezado **y todas las líneas**. Anular conserva el detalle.
- Regla: subtotal = Σ base imponible, IVA = Σ valor de IVA, total = Σ total de las líneas.

## Reglas comunes

- Errores: `application/problem+json` (RFC 7807) con `code`, `request_id` y `correlation_id`.
- Escrituras con `Idempotency-Key`; el mismo valor dos veces → un solo efecto.
- Montos: texto decimal con 2 decimales (`"105.00"`) en gRPC, REST interno y eventos nuevos; los eventos públicos conservan sus números por compatibilidad.
- Turno: modelo canónico de [CONTRATO-SCHEMA-FIRST.md](../CONTRATO-SCHEMA-FIRST.md) (`slot_id`, `time_24h`, `timezone`, `total_units`, `available_units`, `revision`).
- Seguridad: JWT de usuario (RS256 + DPoP) emitido por Usuarios; JWT de servicio + mTLS entre servicios; Booking con `X-API-Key`.
- Las rutas `/internal/*` no se publican en el gateway.

## Validación

Suite de pruebas (40 pruebas: OpenAPI, gRPC, GraphQL, AsyncAPI, factura con detalle, compatibilidad con Booking y catálogo):

```bash
cd pruebas && npm install && npm test
```

Herramientas sueltas, si se prefieren:

```bash
npx @redocly/cli lint servicios/*/openapi.yaml comun/comun.yaml
npx @asyncapi/cli validate eventos/atracciones-eventos.asyncapi.yaml
buf lint servicios           # o protoc --descriptor_set_out=/dev/null servicios/*/*.proto
rover supergraph compose --config supergraph.yaml   # composición Federation 2 de los subgrafos
```
