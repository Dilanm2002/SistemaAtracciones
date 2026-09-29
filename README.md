# Descubre EC · Reserva de atracciones turísticas en Ecuador

Plataforma web para buscar, reservar y administrar tours, entradas y paquetes turísticos en Ecuador (Andes, Costa, Amazonía y Galápagos). Es el **dominio de Atracciones** del sistema *Booking Prototipo* y está construida sobre la plantilla oficial [`Plantilla-Integracion-Sistemas`](https://github.com/semestre5grupal-ops/Plantilla-Integracion-Sistemas), respetando su contrato `contracts/atracciones-openapi.yaml` para la futura migración a microservicios y Apollo Federation.

```
Proyecto Ecommerce/
├── backend/    NestJS 10 + TypeORM + PostgreSQL + Swagger (plantilla, módulo Atracciones habilitado)
└── frontend/   React 18 + Vite + CSS propio (sitio público + panel de administración)
```

## Cómo ejecutarlo

Requisitos: Node 20+, Docker Desktop.

```bash
# 1. Base de datos (PostgreSQL en el puerto 5433 del host)
cd backend
cp .env.example .env
docker compose up -d

# 2. API  →  http://localhost:3000/api/v1   ·   Swagger: http://localhost:3000/api/docs
npm install
npm run start:dev          # la primera vez carga datos de demostración automáticamente

# 3. Frontend  →  http://localhost:5173
cd ../frontend
npm install
npm run dev
```

> El contenedor usa el puerto **5433** porque en muchos equipos ya existe un PostgreSQL local en el 5432. Se cambia con `DB_PORT` en `backend/.env`.

### Cuentas de prueba

| Rol | Correo | Contraseña | Acceso |
|---|---|---|---|
| Administrador | admin@descubre-ec.com | Admin123 | Panel completo |
| Operador | operador@descubre-ec.com | Operador123 | Dashboard, Reservas, Disponibilidad |
| Cliente | cliente@descubre-ec.com | Cliente123 | Reservar, Mis reservas, reseñas |

Tarjeta de prueba para el pago simulado: `4111 1111 1111 1111`, cualquier fecha futura y CVV.

## Páginas

**Sitio público**: Inicio (buscador, categorías, destacadas, regiones, destinos, vistos recientemente) · Explorar (filtros por destino, región, categoría, precio, duración, tipo, calificación y cancelación gratis; orden; paginación por token) · Detalle (galería, calendario de disponibilidad real, horarios con cupos, adultos/niños, mapa, reseñas) · Checkout en 3 pasos (login dentro del flujo, datos, pago con tarjeta/transferencia/en sitio) · Confirmación (código, .ics, imprimir) · Mis reservas (próximas/pasadas/canceladas, cancelar, reseñar) · Favoritos · Destinos · Ayuda (FAQ) · Contacto · Ingresar/Registro · Perfil · 404.

**Panel de administración** (misma estructura que Sal y Canela: sidebar agrupado, topbar, módulos):

| Grupo | Módulos |
|---|---|
| General | Dashboard: bienvenida, KPIs, accesos rápidos, ingresos 7 días, próximas salidas |
| Catálogo | Atracciones (tarjetas agrupadas, formulario por secciones, fotos), Categorías, Destinos, Operadores |
| Operación | Reservas (confirmar pago, cancelar, exportar Excel), Disponibilidad (ocupación mensual, bloquear fechas) |
| Personas | Clientes, Usuarios y roles |
| Análisis | Reportes (gráficas + Excel), Reseñas (moderación), Mensajes |

## Cumplimiento de la plantilla / contrato (preparado para microservicios)

| Requisito | Implementación |
|---|---|
| API-First, prefijo `/api/v1`, Swagger | `main.ts`, documentación en `/api/docs` |
| Endpoints del contrato | `search` (POST + token `next_page`), `details` (batch, evita N+1), `health`, CRUD `/:id`, `/:id/availability`, `/:id/reservations`, `reservations/:id/cancel`, historial |
| UUIDs | Todas las entidades usan `uuid`; reservas guardan `usuarioId` sin FK para no acoplar el dominio de Identidad |
| `Idempotency-Key` | Guard de la plantilla + tabla `idempotency_records`: la misma clave repite la respuesta, otra carga útil → 409 |
| Errores RFC 7807 | `ProblemDetailsFilter` → `application/problem+json` con `errors[]` por campo |
| OAuth2 scopes | JWT con claim `scope` (`attractions:read/book/cancel/write/manage`, `admin:full`) validado por `@Scopes()` |
| HATEOAS | `_links` en atracciones, reservas y listados paginados |
| Cabeceras | `Location`, `X-API-Deprecation-Date`, `Cache-Control` |
| Concurrencia | Bloqueo pesimista al reservar: no se venden más cupos que la capacidad |
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

## Créditos de imágenes

Fotografías de Wikimedia Commons bajo licencias CC BY, CC BY-SA y CC0. El detalle por archivo está en `backend/public/img/CREDITOS.json`.
