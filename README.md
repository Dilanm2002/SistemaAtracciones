# Descubre EC · Reserva de atracciones turísticas en Ecuador

> 📘 Documentación técnica (arquitectura, modelo de datos, APIs, eventos): [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) · Guía de demostración: [docs/GUIA-DEFENSA.md](docs/GUIA-DEFENSA.md) · Pruebas y QA: [docs/PRUEBAS-QA.md](docs/PRUEBAS-QA.md)

Plataforma web para buscar, reservar y administrar tours, entradas y paquetes turísticos en Ecuador (Andes, Costa, Amazonía y Galápagos). Es el **dominio de Atracciones** del sistema *Booking Prototipo* y está construida sobre la plantilla oficial [`Plantilla-Integracion-Sistemas`](https://github.com/semestre5grupal-ops/Plantilla-Integracion-Sistemas), respetando su contrato `contracts/atracciones-openapi.yaml` para la futura migración a microservicios y Apollo Federation.

```
Proyecto Ecommerce/
├── docs/       Documentación técnica (ARQUITECTURA.md) y guía de la defensa (GUIA-DEFENSA.md)
├── database/   Modelo relacional: 01_esquema.sql (43 tablas, 3FN), 02_verificacion.sql, 03_eventos.sql y los cambios 04 (cédula/teléfono EC) y 05 (contacto del pasajero)
├── backend/    NestJS 10 + PostgreSQL + Swagger · solo el dominio de Atracciones
│   └── contracts/   OpenAPI (REST), AsyncAPI (eventos), GraphQL (Federation) y gRPC
└── frontend/   React 18 + Vite + CSS propio (sitio público + panel de administración)
```

Los módulos y contratos de vuelos, autos y alojamientos que traía la plantilla se retiraron: los desarrollan otros equipos y se integrarán a través del API Gateway / Apollo Federation. Los puntos de integración previstos están en `atracciones.graphql` (`Atraccion`, `Reserva` y `Ciudad` con `@key`; por ejemplo, el subgrafo de vuelos puede extender `Ciudad` para ofrecer vuelos al destino de una atracción).

## En la nube

| Pieza | Servicio | URL |
|---|---|---|
| Sitio web | Vercel (proyecto `descubre-ec`, Root Directory `frontend`) | https://descubre-ec.vercel.app |
| API + Swagger | Vercel serverless (proyecto `sistemaatracciones-backend`, Root Directory `backend`) | https://sistemaatracciones-backend.vercel.app/api/docs |
| Base de datos | Supabase PostgreSQL (São Paulo), *transaction pooler* puerto 6543, RLS activo | — |
| Fotos subidas | Supabase Storage, bucket público `uploads` | — |

Cada `git push` a `main` pasa por CI (`.github/workflows/ci.yml`: lint, tipos, tests, build, `npm audit` y gitleaks) y vuelve a desplegar ambos proyectos.

Variables de la API en Vercel: `DATABASE_URL`, `DB_SSL=true`, `DB_POOL_MAX=1`, `SEED_ON_START=false` (obligatorio), `ENABLE_DOCS=true`, `NODE_ENV=production`, `JWT_SECRET` (≥ 32 caracteres aleatorios), `JWT_EXPIRES_IN=2h`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET=uploads`, `PUBLIC_URL`, `FRONTEND_URL`. Variable del frontend: `VITE_API_URL`. `TRUST_PROXY` solo hace falta si la API está detrás de otro proxy (en Vercel se confía en `X-Forwarded-For` automáticamente; sin proxy, el límite de peticiones usa la IP de la conexión). La API **no arranca** si falta `JWT_SECRET`, si es un valor de ejemplo, si `DATABASE_URL` apunta a `localhost` en producción, si se intenta `DB_SYNC=true` o si `SEED_ON_START` no es `false` en producción (`src/config/env.validation.ts`). En producción se ignora cualquier archivo `.env`.

`DB_POOL_MAX=1`: cada instancia serverless abre como mucho una conexión contra el *transaction pooler* de Supabase, cuyo límite es por proyecto; con N instancias concurrentes se usan N conexiones.

### Base de datos: modelo relacional SQL-first

El modelo es **`database/01_esquema.sql`**: 43 tablas en 3FN con la convención `<sigla>_id` (región → provincia → ciudad; usuario ↔ rol N:M; operador ↔ usuario; atracción con tarifas versionadas, horarios, inventario diario en `disponibilidad`, fotos, idiomas e inclusiones normalizadas; orden → detalle → reserva → pasajero; pago, pago con tarjeta, factura y reembolso; favoritos, sesiones, idempotencia y bitácora). `database/02_verificacion.sql` comprueba estructura, integridad y reglas de negocio.

- La API aplica el modelo con migraciones SQL (`backend/src/database/sql/`): `001_modelo_relacional.sql` es **copia exacta** de `01_esquema.sql` (un test lo exige) y `002_seguridad.sql` activa RLS y retira los permisos de `anon`/`authenticated` de Supabase (la API pública de Supabase no expone nada).
- El control de migraciones vive en `ops.migracion`, fuera de `public`. En desarrollo se aplican al arrancar; en Vercel, en el build (`npm run vercel-build`).
- Nunca se usa `synchronize`: TypeORM solo gestiona el pool de conexiones y las transacciones; las consultas son SQL parametrizado.

```bash
cd backend
npm run migration:run   # aplica las migraciones pendientes
npm run seed            # carga los datos de demostración (solo si no hay atracciones)
npm run db:verify       # ejecuta database/02_verificacion.sql y falla si alguna verificación devuelve filas
```

Ajustes que se hicieron al modelo al integrarlo (documentados en la cabecera de `01_esquema.sql`): el trigger `fn_actualizar_timestamp` fallaba en todo `UPDATE` porque asignaba `NEW.actualizado_en` (las columnas llevan prefijo); se agregaron `atr_uuid` y `res_uuid` como identificadores públicos del contrato; `atr_tipo` admite `PACKAGE` y la duración llega a 720 h; `ciudad` tiene descripción e imagen; y se corrigieron datos del catálogo (Bolívar es Sierra, Archidona está en Napo, Puyo).

## Cómo ejecutarlo

Requisitos: Node 20+, Docker Desktop.

```bash
# 1. Base de datos (PostgreSQL en el puerto 5433 del host)
cd backend
cp .env.example .env
docker compose up -d

# 2. API  →  http://localhost:3000/api/v1   ·   Swagger: /api/docs   ·   Redoc del contrato: /api/redoc
npm install
npm run start:dev          # aplica las migraciones y la primera vez carga datos de demostración
npm test                   # pruebas unitarias (idempotencia, validaciones, subida de imágenes…)
npm run lint

# 3. Frontend  →  http://localhost:5173
cd ../frontend
npm install
npm run dev
npm run lint
```

> El contenedor usa el puerto **5433** porque en muchos equipos ya existe un PostgreSQL local en el 5432. Se cambia con `DB_PORT` en `backend/.env`.

### Cuentas de demostración

> ⚠️ Solo la cuenta de **cliente** es pública (no tiene permisos administrativos). Las contraseñas de **administrador** y **operador** de producción se rotaron y se entregan por privado al evaluador (CAL-009 / SEG-014). El login está limitado a 5 intentos por minuto por IP y el *seed* está bloqueado en producción (V2-SEG-01).

| Rol | Correo | Contraseña | Acceso |
|---|---|---|---|
| Administrador (Andrea Salazar) | admin@descubre-ec.com | *(por privado)* | Panel completo |
| Operador | operador@descubre-ec.com | *(por privado)* | Dashboard, Reservas y Disponibilidad **de su empresa** (Andes Explorer, código 101) |
| Cliente | cliente@descubre-ec.com | Cliente123 | Reservar, Mis reservas, reseñas |

En local (base del `docker-compose` con el *seed*) las contraseñas de demostración son las de `backend/src/seed/seed-data.ts`.

Tarjeta de prueba para el pago simulado: `4111 1111 1111 1111`, cualquier fecha futura y CVV.

## Control de versiones

Versión actual: **2.4.3** · historial en [CHANGELOG.md](CHANGELOG.md) · la versión desplegada se ve en `GET /api/v1/atracciones/health` (campo `version`) y en Swagger.

Se usa [Versionado Semántico](https://semver.org/lang/es/) `MAYOR.MENOR.PARCHE`:

| Cambio | Ejemplo | Nueva versión |
|---|---|---|
| Corrección de un error, sin cambiar la API | arreglar un cálculo | 1.0.**1** |
| Funcionalidad nueva compatible con lo anterior | un filtro nuevo en la búsqueda | 1.**1**.0 |
| Cambio que rompe el contrato de la API | renombrar un campo de la respuesta | **2**.0.0 |

El trabajo del día a día se anota en `CHANGELOG.md` bajo **[Sin publicar]**. Para publicar una versión:

1. Mover lo de *[Sin publicar]* a una sección `## [X.Y.Z] - AAAA-MM-DD` en `CHANGELOG.md`.
2. Subir el número en `backend/src/config/version.ts` y ejecutar `npm version X.Y.Z --no-git-tag-version` en `backend/` y en `frontend/`, que actualiza `package.json` y el lockfile. La prueba `version.spec.ts` falla si alguno queda desalineado.
3. Fusionar el PR en `main` y marcar ese commit con una etiqueta:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "Descubre EC X.Y.Z"
   git push origin vX.Y.Z
   ```
4. En GitHub, en **Releases → Draft a new release**, elegir la etiqueta `vX.Y.Z` y pegar su sección del CHANGELOG.

Para volver a una versión anterior: `git checkout v1.0.0` (solo lectura) o crear una rama desde la etiqueta: `git switch -c arreglo-1.0 v1.0.0`.

## Reglas de negocio: reservas y empresas proveedoras

**Reservar exige cuenta.** Cualquiera puede explorar y elegir fecha y entradas, pero para pagar hay que iniciar sesión o registrarse. El checkout lo pide sin perder la selección, y la API rechaza con 401 una reserva sin token.

**Cancelación por parte del cliente.** La API la decide y la devuelve en `cancellation_policy`:

| Situación | ¿Puede cancelar? | Reembolso |
|---|---|---|
| Pendiente de pago (transferencia o en sitio) | Sí, hasta **1 hora antes** de la salida | No hay cobro: se anula el pago y se libera el cupo |
| Pagada, antes del plazo gratuito de la experiencia | Sí | 100 % |
| Pagada a último momento (ya dentro del plazo) | Sí, con **1 hora de arrepentimiento** tras reservar | 100 % |
| Pagada, fuera de esos plazos | Sí, confirmando `accept_no_refund` | 0 %; se libera el cupo |
| La experiencia ya empezó o terminó | No | — |
| Cancela la empresa o el administrador | Siempre | 100 % al cliente |

El checkout avisa antes de pagar si la reserva es de último momento o no tiene cancelación gratuita.

**Una empresa que quiere vender sus tours o paquetes** (página *Para empresas*, `/empresas`):

1. **Cuenta.** La persona responsable crea su cuenta o inicia sesión.
2. **Solicitud.** Envía los datos de su empresa: nombre comercial, RUC válido, provincia, correo y teléfono ecuatorianos, y qué ofrece. Queda **PENDIENTE**, y solo puede haber una pendiente por persona y por RUC.
3. **Revisión de la empresa.** El administrador la revisa en *Solicitudes de empresas*.
   - **Aprobar:** en una sola transacción se crea la empresa (`operador`), se vincula a la persona y esta recibe el rol **OPERADOR**.
   - **Rechazar:** exige un motivo, que la persona ve para corregir y volver a solicitar.
4. **Carga de experiencias.** El operador sube sus tours y paquetes en *Mis experiencias*.
   - Solo puede publicar para **su** empresa y no puede destacarlos en el inicio.
   - Todo lo nuevo queda **EN REVISIÓN** y no se ve en el sitio.
5. **Revisión de cada experiencia.** El administrador la **aprueba**, y queda publicada y reservable, o la **rechaza con motivo**. Si se rechaza, el operador la corrige y vuelve a revisión.
6. **Pausa y reactivación.** Una experiencia ya aprobada se puede pausar y reactivar sin pasar otra vez por revisión.

**Permisos:** los catálogos globales (categorías, destinos, operadores) y la moderación de reseñas son solo del administrador. Tablas: `solicitud_operador`, más los estados y columnas de revisión de `atraccion` (migración `006_proveedores.sql`).

## Páginas

**Sitio público**: Inicio (buscador, categorías, destacadas, regiones, destinos, vistos recientemente) · Explorar (filtros por destino, región, categoría, precio, duración, tipo, calificación y cancelación gratis; orden; paginación por token) · Detalle (galería, calendario de disponibilidad real, horarios con cupos, adultos/niños, mapa, reseñas) · Checkout en 3 pasos (login dentro del flujo, datos, pago con tarjeta/transferencia/en sitio) · Confirmación (código, .ics, imprimir) · Mis reservas (próximas/pasadas/canceladas, cancelar, reseñar) · Favoritos · Destinos · Ayuda (FAQ) · Contacto · Ingresar/Registro · Perfil · 404.

**Panel de administración** (misma estructura que Sal y Canela: sidebar agrupado, topbar, módulos):

| Grupo | Módulos |
|---|---|
| General | Dashboard: bienvenida, KPIs, accesos rápidos, ingresos 7 días, próximas salidas |
| Catálogo | Atracciones (tarjetas agrupadas, formulario por secciones, fotos, estados de revisión con aprobar/rechazar) — para el operador, *Mis experiencias* de su empresa —, Categorías, Destinos, Operadores, Solicitudes de empresas |
| Operación | Reservas (confirmar pago, cancelar, exportar Excel), Disponibilidad (ocupación mensual, bloquear fechas) |
| Personas | Clientes, Usuarios y roles |
| Análisis | Reportes (gráficas + Excel), Reseñas (moderación), Mensajes |

## Cumplimiento de la plantilla / contrato (preparado para microservicios)

| Requisito | Implementación |
|---|---|
| API-First, prefijo `/api/v1`, Swagger | `main.ts`, documentación en `/api/docs` |
| Endpoints del contrato | `search` (POST + token `next_page`), `details` (batch, evita N+1, devuelve `metadata`), `health`, CRUD `/:id`, `/:id/availability`, `/:id/reservations`, `reservations/:id/cancel`, historial. El contrato documenta todos los parámetros reales y qué rutas son públicas |
| UUIDs | Todas las entidades usan `uuid`; reservas guardan `usuarioId` sin FK para no acoplar el dominio de Identidad |
| `Idempotency-Key` | La clave se **reserva de forma atómica** (`INSERT … ON CONFLICT DO NOTHING`) antes de ejecutar, con clave primaria `(key, usuario)`: dos peticiones simultáneas con la misma clave ejecutan la operación una sola vez (la otra recibe 409 «en curso»); una clave repetida devuelve la respuesta guardada y otra carga útil → 409. Los registros caducan a las 24 h |
| Errores RFC 7807 | `ProblemDetailsFilter` → `application/problem+json` con `errors[]` por campo y `request_id` |
| OAuth2 scopes | JWT con claim `scope` (`attractions:read/book/cancel/write/manage`, `admin:full`, todos declarados en el contrato) validado por `@Scopes()`. Los permisos se recalculan en cada petición desde el rol guardado en la base: desactivar un usuario o cambiarle el rol surte efecto al instante |
| Multiempresa | Un OPERADOR pertenece a una empresa (`operadorCodigo`) y solo ve y gestiona las reservas, fechas bloqueadas y métricas de sus atracciones |
| HATEOAS | `_links` en atracciones, reservas y listados; cada `href` ya incluye `/api/v1` (ruta absoluta respecto al host) |
| Cabeceras | `Location`, `X-API-Deprecation-Date`, `Cache-Control`, `X-Total-Count`, `X-Request-Id`, `Retry-After` |
| Concurrencia | Al reservar se bloquea la atracción (`FOR UPDATE`) y se leen precio y cupos **dentro** de la misma transacción; cancelar y confirmar también son transaccionales con bloqueo de la reserva; el código de reserva se reintenta con `SAVEPOINT` si colisiona |
| Seguridad | `helmet` (CSP, HSTS, nosniff, frame-ancestors), límite de peticiones (global 120/min; login 5/min; registro 5/h; contacto 5/10 min; subidas 30/h), cuerpos ≤ 100 kB, subida de imágenes validada por *magic bytes*, `trust proxy`, CORS con métodos y cabeceras explícitas |
| Extensiones | Solo campos **opcionales** añadidos (ej. `child_price`, `times`, `slots`): el contrato original sigue siendo válido |

Además se corrigieron dos fallas de la plantilla original en `atracciones.controller.ts`: rutas `PUT/PATCH/DELETE :id` duplicadas y `GET reservations` declarado después de `GET :id` (Express lo interpretaba como un UUID inválido).

## Diseño (skill ui-ux-pro-max)

- **Paleta "Andes y Selva"**: primario `#0F766E`, secundario `#14B8A6`, CTA `#F59E0B` (texto oscuro encima, contraste 9:1), fondo `#FAF7F2`, texto `#1C2B2A`.
- **Tipografía**: Poppins (títulos) + Open Sans (texto).
- Íconos SVG (lucide), sin emojis; foco visible; `prefers-reduced-motion`; objetivos táctiles ≥ 44 px; responsive 375–1440 px.
- **Gráficas**: paleta categórica validada con el script de la skill *dataviz* (daltonismo, contraste, croma); un solo eje; alternativa "Ver tabla".

## Heurísticas de usabilidad de Nielsen aplicadas

| # | Heurística | Dónde se aplica |
|---|---|---|
| 1 | Visibilidad del estado del sistema | Skeletons y spinners, toasts, pasos del checkout, "Quedan N cupos", contador de resultados, badges de pendientes en el sidebar |
| 2 | Relación con el mundo real | Español de Ecuador, USD, fechas `es-EC`, zona horaria de Guayaquil, destinos y regiones reales |
| 3 | Control y libertad | "Deshacer" en favoritos y ocultar atracción/reseña, chips de filtros removibles, "Limpiar todo", volver sin perder la selección, Esc cierra modales |
| 4 | Consistencia y estándares | Tokens de diseño únicos, mismo patrón de módulo en el admin, mismos estados (Confirmada/Pendiente/Cancelada) en todo el sistema |
| 5 | Prevención de errores | Días pasados y agotados deshabilitados, límite de participantes según cupo, confirmación antes de eliminar/cancelar, aviso de cambios sin guardar, idempotencia contra doble clic, no se elimina una atracción con reservas |
| 6 | Reconocer antes que recordar | Vistos recientemente, favoritos, resumen fijo en el checkout, selector visual de íconos, datalist de destinos, datos del perfil prellenados |
| 7 | Flexibilidad y eficiencia | Atajo `/` para buscar, accesos rápidos, filtros en la URL (compartibles), exportación a Excel, horario único seleccionado automáticamente |
| 8 | Diseño estético y minimalista | Jerarquía clara, una acción principal por pantalla (CTA dorado), información secundaria en acordeones y modales |
| 9 | Ayudar a reconocer y recuperarse de errores | Mensajes en español junto al campo, 409 de cupos con enlace "Elegir otro horario", estados de error con "Reintentar", sesión expirada con aviso |
| 10 | Ayuda y documentación | Centro de ayuda con FAQ, pistas bajo los campos, leyenda del calendario, tooltips en acciones con ícono |

## Accesibilidad

Revisado con axe-core (WCAG 2.1 A/AA): **0 violaciones** en Inicio, Explorar, Detalle, Checkout y todos los módulos del panel. Foco visible ≥ 3:1 en todo el sitio, menú móvil y filtros como diálogos con foco atrapado y Esc, foco en `<main>` al navegar, campos obligatorios con `required`/`aria-required`, alertas anunciadas, tablas con `caption`/`scope`, selector de estrellas con flechas y gráficas con descripción textual.

## Decisiones y deuda técnica documentadas

| Tema | Decisión |
|---|---|
| SEO de la SPA (WEB-003) | Pre-renderizado en el build (`scripts/prerender.mjs`): cada página pública y cada atracción tienen HTML propio con título, descripción, Open Graph, `schema.org` y contenido visible; `sitemap.xml` con todas las URLs |
| Token ligado al navegador (WEB-008) | DPoP (RFC 9449): llave ECDSA no exportable en IndexedDB; cada petición lleva una prueba firmada, así un token robado no sirve fuera del navegador. Sesión por pestaña (`sessionStorage`) y revocación inmediata en el servidor |
| `xlsx` desde el CDN de SheetJS (WEB-009) | La versión 0.20.3 (sin las vulnerabilidades de la 0.18) ya no se publica en npm; la URL fija la versión exacta |
| Bucket `uploads` privado (SEG-008) | Como en Sal y Canela, las fotos viven en Supabase Storage y la tabla guarda su ruta, pero el bucket es privado: la API (`/api/v1/media/…`) entrega solo las fotos en uso, con caché en el CDN, y las recién subidas con un enlace firmado de 2 h |
| Swagger y Redoc en producción (SEG-019) | *Opt-in* con `ENABLE_DOCS=true` (activado para la evaluación). Sus recursos se sirven desde `/vendor` del propio dominio, sin CDN de terceros |
| Dependencias | NestJS 11 / Express 5, Vite 8 y React Router 7: `npm audit` sin vulnerabilidades. CI falla ante cualquier `high` (incluidas las de desarrollo), corre CodeQL y revisa las dependencias de cada PR |
| `simple-json` y relaciones `eager` (DAT-004, DAT-007) | Resuelto con el modelo relacional: horarios, fotos, idiomas e inclusiones tienen tabla propia y la atracción se lee en una sola consulta |
| Carrito, cupones y direcciones | Las tablas existen en el modelo y se validan en `02_verificacion.sql`, pero la interfaz todavía reserva una experiencia por compra (sin carrito ni cupones) |
| Insignias (`badges`) | Se calculan a partir de los datos (ventas de 60 días, ocupación de 14 días, antigüedad); el campo del contrato se acepta pero se ignora al escribir |
| Verificación de correo al registrarse (SEG-016) | Requiere un proveedor de correo que el proyecto no tiene; el registro está limitado a 5 cuentas por hora por IP. Detalle de las correcciones de las auditorías V2 y V3 en [docs/CORRECCIONES-V2.md](docs/CORRECCIONES-V2.md) y [docs/CORRECCIONES-V3.md](docs/CORRECCIONES-V3.md) |

## Créditos de imágenes

Fotografías de Wikimedia Commons bajo licencias CC BY, CC BY-SA y CC0. El detalle por archivo está en `backend/public/img/CREDITOS.json`.
