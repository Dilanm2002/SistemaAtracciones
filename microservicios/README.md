# Microservicios de Descubre EC

Parte de Dilan en el reparto del equipo: **ms_location, ms_catalog y ms_review**, más el **API Gateway**
que conecta el sistema con Booking Prototipo. Cada servicio tiene su propia base de datos (script del
equipo `02_microservicios_v2_bases_de_datos.sql`), su contrato OpenAPI y sus pruebas de esquemas.

| Servicio | Puerto | Base | Contrato | Qué hace |
|---|:-:|---|---|---|
| `ms-location` | 4001 | `ms_location` | [contract/openapi.yaml](ms-location/contract/openapi.yaml) | Regiones, provincias y ciudades (solo lectura) |
| `ms-catalog` | 4002 | `ms_catalog` | [contract/openapi.yaml](ms-catalog/contract/openapi.yaml) | Atracciones, categorías, idiomas, inclusiones, fotos, itinerario, operadores. **Sirve el catálogo del contrato v3 de Booking** |
| `ms-review` | 4003 | `ms_review` | [contract/openapi.yaml](ms-review/contract/openapi.yaml) | Reseñas; publica `RESENA_PUBLICADA` (outbox) hacia ms_catalog |
| `gateway` | 8080 | — | — | **URL que se registra en Booking.** Reparte cada ruta al microservicio dueño o a la tienda |

## Cómo se integra con Booking (migración gradual)

```
Booking ──► Gateway :8080 /api/v3 ─┬─► ms-catalog  (árbol, categorías, listado, búsqueda, ficha)
                                    └─► tienda :3000 (disponibilidad, reservas, check-in, promociones, eventos)
```

- Mientras los compañeros entregan ms_inventory, ms_order, ms_booking, ms_payment…, esas rutas las sigue
  atendiendo la tienda. Cuando llegue cada uno, se agrega su regla en [`gateway/src/rutas.ts`](gateway/src/rutas.ts).
- `npm run migrar` copia los datos de la tienda a las bases de los microservicios **con los mismos IDs y
  UUID**: una atracción es la misma en el catálogo (ms_catalog) y en las reservas (tienda).
- Ver a dónde va cada ruta: `GET http://localhost:8080/gateway/rutas`.

## Levantar todo (prueba local con Booking por Tailscale)

```bash
# 1) Bases (Docker Desktop encendido)
cd backend && docker compose up -d                 # tienda (5433)
cd ../microservicios && docker compose up -d       # microservicios (5434)

# 2) Dependencias, compilación y copia de datos de la tienda
npm install
npm run migrar                                     # se puede repetir cuando cambie el catálogo de la tienda

# 3) Arrancar (una terminal cada uno); mismas claves en todos
#    K = clave de Booking (24+ caracteres) · T = token entre servicios (16+ caracteres)
cd backend && BOOKING_API_KEY=$K npm run start:dev
cd microservicios/ms-location && DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_location npm run dev
cd microservicios/ms-catalog  && DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_catalog BOOKING_API_KEY=$K SERVICIOS_TOKEN=$T npm run dev
cd microservicios/ms-review   && DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_review SERVICIOS_TOKEN=$T npm run dev
cd microservicios/gateway     && npm run dev

# 4) Antes de la reunión: todo el contrato v3 a través del gateway, validado con los esquemas oficiales
GATEWAY_URL=http://localhost:8080 BOOKING_API_KEY=$K node scripts/prueba-humo.js
```

En el panel de Booking: **URL base** `http://<tu IP de Tailscale>:8080/api/v3`, tipo **Atracciones**.

Variables (todas tienen valor por defecto para local): `LOCATION_URL`, `CATALOG_URL`, `REVIEW_URL`,
`TIENDA_URL`, `EVENTOS_DESTINOS`, `FOTOS_BASE_URL`, `JWT_SECRET` (el mismo de la tienda, para los
endpoints con token), `PORT`, `HOST` (por defecto `0.0.0.0`).

## En la nube (Azure Container Apps + Supabase)

```bash
cp deploy/azure/.env.example deploy/azure/.env   # llenar con los valores de Vercel/Supabase
az login
bash deploy/azure/desplegar.sh                    # Docker Desktop encendido
```

- Una sola imagen (`microservicios/Dockerfile`) para los 3 microservicios y el gateway: `SERVICIO` elige cuál
  arranca. La tienda usa `backend/Dockerfile`.
- Solo el **gateway** es público (HTTPS); la tienda y los microservicios son internos al entorno.
- Base: el mismo proyecto de Supabase de la tienda. Cada microservicio en su schema (`DB_SCHEMA=ms_catalog`…)
  por el *Session pooler*. Su `search_path` empieza por su schema (ahí crea y lee todas sus tablas) y solo al final
  incluye `extensions` y `public`, para encontrar pgcrypto y pg_trgm.
- Las pruebas se pueden correr igual que en la nube (una base, tres schemas):
  `DB_SCHEMA=ms_catalog TEST_DATABASE_URL=…/una_base npm test --workspace ms-catalog`.

## Pruebas (incluye las pruebas de esquemas)

```bash
npm test --workspace gateway
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_location_test npm test --workspace ms-location
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_catalog_test  npm test --workspace ms-catalog
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_review_test   npm test --workspace ms-review
```

Cada respuesta se valida contra el contrato del servicio; las del catálogo, además, contra los esquemas
**oficiales** del contrato v3 de Booking. ms_review comprueba que su evento cumple el contrato de ms_catalog
(contrato dirigido por el consumidor).

## Qué agregué al script del equipo (avisar al equipo)

Solo se **agregan** columnas y tablas (`sql/002_*.sql`); lo del script no cambia. Sin esto no se cumple el
contrato v3 de Booking:

- **ms_catalog:** `cat_incluye_comida/transporte/guia`; en atracción: `atr_incluye_*`, accesibilidad
  (`atr_accesible_silla`, `atr_accesible_coche`, `atr_animales_servicio`), `atr_guia`, `atr_instrucciones_llegada`,
  `atr_permite_paquete`, `atr_descuento_paquete`; tabla `atraccion_itinerario`; proyecciones `tarifa_vigente`
  (precios de ms_pricing) y pilares de calificación (de ms_review); inbox `evento_recibido`.
- **ms_review:** notas por pilar (`ren_limpieza`, `ren_servicio`, `ren_relacion_valor`, `ren_puntualidad`) y outbox `evento`.

## Eventos entre servicios

| Evento | Lo publica | Lo recibe | Datos |
|---|---|---|---|
| `RESENA_PUBLICADA` | ms_review (outbox, reintenta cada 3 s) | ms_catalog `POST /api/v1/internal/eventos` | promedio, total y pilares |
| `PRECIO_ACTUALIZADO` | ms_pricing (Michael) | ms_catalog `POST /api/v1/internal/eventos` | `{ atr_id, tarifas: [{ tipo, precio, moneda }] }` |

Sobre CloudEvents 1.0 con `X-Servicio-Token`. Tras 20 fallos un evento queda apartado; se reencola con
`POST /api/v1/resenas/eventos/reintentar` (ADMIN).
