# Descubre EC · Entrega del proyecto integrador (Reto 1)

Marketplace de tours y atracciones del Ecuador: catálogo, reservas con pago, panel de administración para empresas y administrador, APIs documentadas y contratos de integración.

## 1. Sistema desplegado en la nube

| Componente | Dirección |
|---|---|
| Sitio web (marketplace) | https://descubre-ec.vercel.app |
| Panel de administración (backoffice) | https://descubre-ec.vercel.app/admin |
| API REST | https://sistemaatracciones-backend.vercel.app/api/v1 |
| Swagger (probar las APIs) | https://sistemaatracciones-backend.vercel.app/api/docs |
| Redoc (contrato OpenAPI) | https://sistemaatracciones-backend.vercel.app/api/redoc |
| Contratos (OpenAPI, AsyncAPI, GraphQL, proto) | https://sistemaatracciones-backend.vercel.app/api/v1/contracts |
| Estado del sistema y de la base de datos | https://sistemaatracciones-backend.vercel.app/api/v1/atracciones/health |
| Repositorio | https://github.com/Dilanm2002/SistemaAtracciones |

**Cuenta de prueba (cliente):** `cliente@descubre-ec.com` / `Cliente123`.
Las cuentas de administrador y de operador se entregan aparte.

## 2. Contenido de esta carpeta

| Carpeta | Qué contiene |
|---|---|
| `frontend/` | Sitio web y panel de administración (React + Vite) |
| `backend/` | API REST (NestJS): `src/modules/*/*.controller.ts` son las APIs; los `*.service.ts`, la lógica |
| `backend/contracts/` | Contratos de integración: OpenAPI, AsyncAPI (eventos), GraphQL y gRPC (proto) |
| `database/` | **Base de datos**: esquema (`01_esquema.sql`), verificación (`02_verificacion.sql`) y migraciones `03` a `06` |
| `backend/src/seed/` | Datos iniciales del sistema: 22 atracciones, destinos, categorías, operadores y usuarios demo |
| `docs/` | Documentación técnica: arquitectura, modelo de datos, APIs, integración (`ARQUITECTURA.md`), guía de defensa y correcciones de auditorías |
| `README.md` | Cómo instalar y ejecutar el proyecto |
| `CHANGELOG.md` | Historial de versiones |

## 3. Tecnologías

| Capa | Tecnologías |
|---|---|
| Frontend | React 18, Vite, React Router, Leaflet (mapas), Recharts (gráficos) |
| Backend | NestJS 11 (Node.js), PostgreSQL con SQL propio (SQL-first), JWT con DPoP, Swagger |
| Base de datos y archivos | PostgreSQL y Storage en Supabase |
| Despliegue | Vercel (frontend y backend) |
| Calidad | GitHub Actions: pruebas unitarias y E2E, Playwright móvil, axe, CodeQL, gitleaks |

## 4. Cómo levantar la base de datos desde cero

Con una base PostgreSQL vacía (15 o superior) y su conexión en `backend/.env` (`DATABASE_URL`), desde `backend/`:

```bash
npm ci
npm run build
node dist/database/run-migrations.js   # aplica database/01_esquema.sql y las migraciones 002 a 006
node dist/seed/run-seed.js             # carga los datos de ejemplo (destinos, atracciones, usuarios demo)
npm run db:verify                      # ejecuta database/02_verificacion.sql (restricciones y reglas)
```

Son los mismos pasos que corre el CI en cada cambio. La base de datos en uso es PostgreSQL en Supabase (45 tablas) y su estado se ve en la URL de *health* de la sección 1.

## 5. Cómo ejecutar el proyecto en local

```bash
# Backend (API) — necesita backend/.env con DATABASE_URL, JWT_SECRET, etc. (ver backend/.env.example)
cd backend && npm ci && npm run start:dev      # http://localhost:3000/api/docs

# Frontend
cd frontend && npm ci && npm run dev           # http://localhost:5173
```
