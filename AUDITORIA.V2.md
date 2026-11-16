# Auditoría técnica V2 — «Descubre EC»

**Proyecto:** Reserva de atracciones turísticas en Ecuador (Booking Prototipo · dominio Atracciones)
**Alcance:** `backend/` (NestJS 10 + PostgreSQL SQL-first), `frontend/` (React 18 + Vite), `contracts/`, `.github/`
**Base:** `AUDITORIA.md` (29-09-2026, 126 hallazgos) — esta versión reevalúa **los 126** frente al código actual
**Fecha:** 30 de septiembre de 2026
**Commit auditado:** `854ea6c` — *feat(inicio): barra de navegación fija también en el inicio*
**Tipo:** reauditoría estática de caja blanca **con ejecución de verificaciones locales no destructivas** (lint, `tsc --noEmit`, `jest`, `npm audit`) y revisión de migraciones/E2E declarados en CI. No se desplegó la aplicación ni se modificó ningún archivo del proyecto.
**Normativas:** WCAG 2.1 AA + WCAG 2.2 AA, OWASP Top 10 2021, ISO/IEC 25010, OpenAPI 3.x, RFC 7807, RFC 9457, RFC 6749, CIS Docker/Node.

---

## 0. Cómo leer este informe

| Prefijo | Área |
|---|---|
| `ACC-xxx` | Accesibilidad (WCAG) |
| `SEG-xxx` | Seguridad y privacidad |
| `API-xxx` | Diseño de API REST y contrato OpenAPI |
| `DAT-xxx` | Datos, persistencia e índices |
| `CON-xxx` | Concurrencia, idempotencia y transacciones |
| `WEB-xxx` | Frontend: rendimiento, SEO y arquitectura |
| `OPS-xxx` | Despliegue, operación y observabilidad |
| `CAL-xxx` | Calidad de código, arquitectura y DevOps |
| `V2-xxx` | **Hallazgos nuevos** detectados por esta reauditoría |

### Estados

| Estado | Significado |
|---|---|
| 🟢 **CORREGIDO** | El defecto descrito ya no existe en el código actual. |
| 🟡 **PARCIAL** | Mitigado parcialmente; queda un residuo explotable o funcional. |
| 🔴 **VIGENTE** | Sin cambios: el defecto sigue presente. |
| ⬛ **AGRAVADO** | El defecto persiste y su impacto creció. |
| ⚪ **NUEVO** | No existía en `AUDITORIA.md`; detectado en esta versión. |
| 🔵 **NO VERIFICABLE** | Depende de un valor externo al repositorio (panel de Vercel, Supabase, navegador). Se indica qué comprobar. |

Severidad: **P0 Crítica** · **P1 Alta** · **P2 Media** · **P3 Baja**.

---

## 1. Resumen ejecutivo

### 1.1 Semáforo por área (comparativa)

Las columnas P0…P3 cuentan **los hallazgos que siguen abiertos en V2**, con la severidad que tenían en V1.

| # | Área | V1 | V2 | 🟢 | 🟡 | 🔴 | 🔵 | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | Accesibilidad (WCAG) | 🟠 Parcial | 🟢 **Cumple en su mayor parte** | 33 | 1 | – | 1 | 0 | 1 | 0 | 1 | **35** |
| 2 | Seguridad y privacidad | 🔴 No cumple | 🟡 **Cumple parcialmente** | 19 | 5 | 1 | – | 0 | 4 | 2 | 0 | **25** |
| 3 | API REST y contrato | 🟠 Parcial | 🟢 **Cumple** | 14 | – | – | – | 0 | 0 | 0 | 0 | **14** |
| 4 | Datos y persistencia | 🟠 Parcial | 🟢 **Cumple** | 10 | – | – | – | 0 | 0 | 0 | 0 | **10** |
| 5 | Concurrencia e idempotencia | 🔴 No cumple | 🟢 **Cumple** | 4 | – | – | – | 0 | 0 | 0 | 0 | **4** |
| 6 | Frontend | 🟡 Mayor parte | 🟢 **Cumple en su mayor parte** | 11 | 3 | – | – | 0 | 0 | 3 | 0 | **14** |
| 7 | Despliegue y operación | 🟠 Parcial | 🟢 **Cumple** | 8 | 1 | – | – | 0 | 0 | 1 | 0 | **9** |
| 8 | Calidad, arquitectura, DevOps | 🔴 No cumple | 🟢 **Cumple** | 14 | 1 | – | – | 0 | 0 | 1 | 0 | **15** |
| | **TOTAL V2** | | | **113** | **11** | **1** | **1** | **0** | **5** | **7** | **1** | **126** |

### 1.2 Resultado global de los 126 hallazgos

| Estado | Cantidad | % |
|---|:-:|:-:|
| 🟢 CORREGIDO | **113** | 89,7 % |
| 🟡 PARCIAL | 11 | 8,7 % |
| 🔴 VIGENTE | 1 | 0,8 % |
| ⬛ AGRAVADO | 0 | 0 % |
| 🔵 NO VERIFICABLE | 1 | 0,8 % |
| **Total** | **126** | 100 % |

A esto se suman **7 hallazgos nuevos** (`V2-SEG-01` P1, `V2-OPS-01` P2, `V2-CAL-01` P2, `V2-SEG-02` P3, `V2-CON-01` P3, `V2-DAT-01` P3, `API-015` P3), detallados en la sección 3.

**Los 7 P0 críticos de V1 están cerrados.** Quedan 5 hallazgos P1 de V1 abiertos, cuatro de ellos de naturaleza *residual* (mitigados, no eliminados) y uno sin tocar (SEG-008).

### 1.3 Distribución por estado y bloque

| Bloque | 🟢 | 🟡 | 🔴 | 🔵 | Total |
|---|:-:|:-:|:-:|:-:|:-:|
| ACC-001…ACC-035 | 33 | 1 | — | 1 | 35 |
| SEG-001…SEG-025 | 19 | 5 | 1 | — | 25 |
| API-001…API-014 | 14 | — | — | — | 14 |
| DAT-001…DAT-010 | 10 | — | — | — | 10 |
| CON-001…CON-004 | 4 | — | — | — | 4 |
| WEB-001…WEB-014 | 11 | 3 | — | — | 14 |
| OPS-001…OPS-009 | 8 | 1 | — | — | 9 |
| CAL-001…CAL-015 | 14 | 1 | — | — | 15 |
| **Total** | **113** | **11** | **1** | **1** | **126** |

### 1.4 Lo que cambió: la reescritura SQL-first

El hallazgo transversal más importante de esta versión es que **la arquitectura cambió por completo** respecto a la que se auditó en V1. V1 auditó un backend basado en entidades TypeORM con `synchronize` implícito. El código actual es **SQL-first**:

- `database/01_esquema.sql` (43 tablas, 3FN) es la única fuente de verdad del esquema; `backend/src/database/sql/001_modelo_relacional.sql` es su copia exacta y un test lo exige.
- TypeORM **solo** gestiona el pool y las transacciones: `entities: []`, `synchronize: false`, `migrationsRun: false` (`backend/src/app.module.ts:42-44`).
- Todas las consultas son SQL parametrizado (`$1`, `$2`…) mediante `DbService` / `Sql` / `Params`.
- Migraciones versionadas con **checksum y advisory lock** (`backend/src/database/migrator.ts`), registradas en `ops.migracion` fuera de `public`.
- RLS activada y privilegios de `anon`/`authenticated` revocados (`backend/src/database/sql/002_seguridad.sql`).
- Sesiones server-side: cada JWT tiene fila en `sesion`, y rol/permisos se recalculan desde `usuario_rol` en cada petición.

**Consecuencia metodológica:** varios hallazgos de V1 (`DAT-001`, `DAT-004`, `DAT-005`, `DAT-007`, `SEG-012`, `SEG-013`, `CON-002`) nacieron de problemas **superados por diseño** — no se corrigieron línea a línea, se volvieron irrelevantes al cambiar la arquitectura. Se marcan 🟢 CORREGIDO y se explica el porqué en cada caso.

### 1.5 Lo que aún impide un despliegue real de producción

Cinco puntos. Ninguno es un P0 de V1 (los 7 P0 están cerrados). Cuatro son residuales de V1 que sobrevivieron a la reescritura y uno es nuevo de esta auditoría:

| # | ID | Severidad | Origen | Por qué importa |
|:-:|---|:-:|:-:|---|
| 1 | **V2-SEG-01** | P1 | **Nuevo** | `SEED_ON_START` es *fail-open*: su valor por defecto es `true` (`seed.service.ts:57`) y `env.validation.ts` **no lo valida en producción**. Una base de datos vacía en producción crea `admin@descubre-ec.com` / `Admin123`. |
| 2 | **SEG-008** | P1 | V1, sin tocar | El bucket de Supabase sigue siendo **público** y se accede con la clave `service_role`, que salta RLS (`storage.service.ts:45-54`). Cualquiera con la URL lee las imágenes. |
| 3 | **CAL-009 / SEG-014** | P2 | V1, parcial | Las credenciales de los tres roles de demostración siguen publicadas en `README.md:79-83`, y el login se limita a 5 intentos/min por IP. |
| 4 | **V2-OPS-01** | P2 | **Nuevo** | `vercel-build` ejecuta `node dist/database/run-migrations.js` (`backend/package.json:10`): DDL corre en **cada build**. Un *preview* de un PR ejecuta migraciones. |
| 5 | **V2-CAL-01** | P2 | **Nuevo** | CI no tiene CodeQL/SAST ni *dependency review*, y `npm audit --audit-level=critical` deja pasar 4 vulnerabilidades `high`. |

---

## 2. Verificaciones ejecutadas en esta auditoría

Evidencia objetiva, reproducible.

| Verificación | Comando | Resultado |
|---|---|---|
| Git | `git rev-parse --short HEAD` | `854ea6c` |
| Estado del árbol | `git status --short` | `?? AUDITORIA.md`, `?? frontend/image.png` (sin modificaciones del proyecto) |
| Lint backend | `npm run lint` | ✅ **exit 0**, sin salida |
| Tipos backend | `npx tsc --noEmit -p tsconfig.json` | ✅ **exit 0**, sin errores |
| Tests backend | `npm test` | ✅ **16 suites / 98 tests**, 0 fallos (12,3 s) |
| Lint frontend | `npm run lint` | ✅ **exit 0** |
| Tests frontend | `npm test` | ✅ **27 tests / 8 suites**, 0 fallos |
| Auditoría de dependencias backend | `npm audit --omit=dev` | ⚠️ **13 vulnerabilidades** (4 high, 8 moderate, 1 low) |
| Auditoría de dependencias frontend | `npm audit --omit=dev` | ⚠️ **2 moderate** |
| Secretos en disco | `Get-ChildItem backend -Force -Filter ".env*"` | Solo `.env` (local, 681 B) y `.env.example`. **`.env.vercel`, `.env.production` y `.env.local` ya no existen.** |
| Secretos versionados | `git ls-files backend` | Ningún `.env` trackeado; `.gitignore:3,7,8` = `.env`, `.env.*`, `!.env.example` |

**Cobertura declarada en `.github/workflows/ci.yml`** (no ejecutada localmente por requerir PostgreSQL): migraciones, seed, `database/02_verificacion.sql`, E2E contra PostgreSQL 16 y `redocly lint` del contrato.

---

## 3. Hallazgos nuevos (V2)

### 🟡 V2-SEG-01 — `SEED_ON_START` falla en abierto: una base vacía en producción crea un administrador con contraseña conocida

**Severidad P1** · OWASP A07 (2021) — *Identification and Authentication Failures*

**Evidencia:**

```ts
// backend/src/seed/seed.service.ts:56-59
async onApplicationBootstrap() {
  if (this.config.get('SEED_ON_START', 'true') === 'false') return;   // ← default: SEEDAR
  await this.sembrar();
}
```

```ts
// backend/src/seed/seed-data.ts:387
{ nombre: 'Andrea', apellido: 'Salazar', email: 'admin@descubre-ec.com',
  password: 'Admin123', rol: 'ADMIN', telefono: '0990000001' },
```

`env.validation.ts` (46 líneas, revisadas por completo) valida `JWT_SECRET`, `DATABASE_URL`, `SUPABASE_URL`/`SERVICE_ROLE_KEY` y `DB_SYNC` — **pero no valida `SEED_ON_START`**. La única defensa es que el panel de Vercel tenga la variable a `false`, algo que el repositorio documenta (`README.md:29`) pero que **nada verifica**.

**Impacto:** si un despliegue nuevo (o una base de datos recreada, o un proyecto de *preview* sin la variable) arranca contra un esquema vacío, `SeedService` inserta 8 usuarios **antes de que la API atienda la primera petición**: un `ADMIN` con `Admin123`, un `OPERADOR` con `Operador123` y cinco `CLIENTE` con `Cliente123`, todos con `usu_verificado = TRUE` (`seed-data.ts:115`). El `README.md:79-83` publica esas credenciales. Un atacante solo tiene que encontrar la URL.

La condición de guarda `sembrar()` (línea 63, `SELECT COUNT(*) FROM atraccion`) reduce el riesgo a despliegues con base vacía, pero **ese es precisamente el escenario de un primer despliegue y el de cada *preview* de Vercel**.

**Corrección:**

```ts
// env.validation.ts — añadir junto a las demás comprobaciones de producción
if (prod && get('SEED_ON_START') !== 'false') {
  errores.push('SEED_ON_START debe ser false en producción (crea usuarios con contraseñas conocidas).');
}
```

Y, de forma complementaria, en `SeedService`: refuse el seed si `NODE_ENV === 'production'`, salvo que se pase un flag explícito de demo.

---

### 🟡 V2-OPS-01 — Las migraciones se ejecutan en el *build* de Vercel

**Severidad P2** · OWASP A05 (2021) — *Security Misconfiguration*

```json
// backend/package.json:10
"vercel-build": "nest build && node dist/database/run-migrations.js",
```

```json
// backend/vercel.json:4
"buildCommand": "npm run vercel-build",
```

El mismo script se usa para el despliegue de producción **y para cada *preview* de pull request** (Vercel ejecuta `buildCommand` en los dos casos). `run-migrations.ts:20` llama a `migrar(ds, …)`, que aplica todo el SQL pendiente.

**Impacto:**
1. Un PR abierto por un colaborador externo ejecuta DDL sobre la base de producción si comparte `DATABASE_URL`.
2. Un *build* que solo quería precompilar muta el esquema. Si el build falla después (límite de duración, memoria), el esquema queda a medias sin transacción que lo revierta.
3. El `MigracionesService` (`app.module.ts:72`) **también** aplica migraciones al arrancar en local, así que hay dos rutas de DDL activas.

La mitigación parcial ya está: `migrator.ts` usa *advisory lock* y verifica *checksum*, de modo que las ejecuciones concurrentes no se corrompen y una migración editada se detecta. Pero ninguna de las dos cosas impide que el DDL se ejecute cuando no debería.

**Corrección:** separar los flujos.

```json
{ "buildCommand": "nest build",
  "installCommand": "npm ci && npm run migration:run" }
```

y ejecutar las migraciones solo en producción mediante un paso explícito (o un job programado), nunca en `buildCommand`.

---

### 🟡 V2-CAL-01 — La cadena de CI no cubre análisis estático de seguridad ni revisión de dependencias

**Severidad P2** · CIS / OWASP A06 (2021) — *Vulnerable and Outdated Components*

Lo que CI **sí** hace (`.github/workflows/ci.yml`, 107 líneas, bien construido):

| Job | Cobertura |
|---|---|
| `backend` | `npm ci`, lint, `tsc --noEmit`, `jest`, `nest build`, `npm audit` |
| `database` | PostgreSQL 16 real → migraciones → seed → `02_verificacion.sql` → **E2E** → `redocly lint` del contrato |
| `frontend` | `npm ci`, lint, tests, `build`, `npm audit` |
| `secrets` | `gitleaks/gitleaks-action@v2` con `fetch-depth: 0` |
| — | `permissions: contents: read` y `concurrency` con `cancel-in-progress` |

Las carencias:

1. **`--audit-level=critical`** (líneas 35 y 96) mientras `npm audit` reporta **4 vulnerabilidades `high`**. El gate no las detiene: es un umbral que no se cumple.
2. **No hay CodeQL ni ningún SAST.** El proyecto es TypeScript con SQL crudo: un analizador estático es la herramienta que detectaría concatenación no parametrizada, que es la clase de fallo más grave posible aquí.
3. **No hay `dependency-review-action`**, así que un PR puede subir transitivamente una dependencia comprometida sin avisar.
4. **No hay `npm audit` sin `--omit=dev`**: las dependencias de desarrollo (incluido `jest`) nunca se escanean.

**Corrección:** añadir a `.github/workflows/ci.yml`:

```yaml
  security:
    name: SAST y dependencias
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: [javascript-typescript] }
      - uses: github/codeql-action/analyze@v3
      - uses: actions/dependency-review-action@v4
      - run: npm audit --audit-level=high
        working-directory: backend
```

---

### 🟡 V2-SEG-02 — Dominio ajeno en los `type` de error y reflexión del `Idempotency-Key`

**Severidad P3** · OWASP A04 (2021) — *Insecure Design*

`backend/src/common/guards/idempotency-key.guard.ts` conserva el host de otro producto:

```ts
// línea 29
type: 'https://api.booking-hub.com/errors/missing-idempotency-key',
// línea 44
type: 'https://api.booking-hub.com/errors/invalid-idempotency-key',
// línea 48 — reflexión del valor suministrado por el cliente
`La cabecera Idempotency-Key debe ser un UUID v4 válido. Se recibió: "${idempotencyKey}".`,
```

Dos consecuencias:

1. Los `type` de `application/problem+json` (RFC 7807 §3.1) deben ser URIs que identifiquen el **tipo de problema** y que el cliente pueda resolver. Apuntan a un dominio que no pertenece al proyecto, lo que rompe la resolubilidad y confunde a cualquier cliente que siga esos enlaces.
2. La línea 48 refleja texto controlado por el cliente en el cuerpo del error. Al ser `application/problem+json` y no HTML, **no hay XSS**; pero sí hay contaminación de logs y un vector innecesario de inyección de contenido en respuestas que la UI renderiza como texto de error.

El guard está además **parcialmente solapado** con la validación por DTO: exige UUID v4, mientras `idempotency.service.ts:44-46` ya inserta la clave en una tabla con `ON CONFLICT`. Conviene una sola fuente de validación.

**Corrección:** usar URIs del propio proyecto (`https://descubre-ec.com/errors/…`), truncar el valor reflejado (`slice(0, 64)`) o eliminarlo, y documentar en `docs/ARQUITECTURA.md` que el contrato es API-first.

---

### 🟡 V2-CON-01 — La caché de sesión es por instancia: ventana de revocación de hasta 15 s

**Severidad P3** · OWASP A07 (2021)

```ts
// backend/src/common/auth/session.service.ts:13
const TTL_MS = 15_000;
// línea 25 — caché en memoria del proceso
private readonly cache = new Map<string, { at: number; estado: EstadoSesion | null }>();
// líneas 68-69
const hit = this.cache.get(key);
if (hit && Date.now() - hit.at < TTL_MS) return hit.estado;
```

El diseño es correcto y es la respuesta adecuada a SEG-009: cada petición revalida contra `sesion` + `usuario_rol`. Pero la caché es **un `Map` en memoria del proceso**, y el despliegue es *serverless* con N instancias (`backend/vercel.json`).

**Impacto:** tras un `logout`, un cambio de contraseña o un cambio de rol, hay hasta **15 s durante los cuales otra instancia puede seguir aceptando el token** con los permisos antiguos. Con `revocarTodas()` correctamente invocado (`auth.service.ts:187,274`) el impacto es acotado, pero no es cero en un despliegue multiinstancia.

**Corrección:** Redis con TTL de 15 s, o reducir `TTL_MS` a 2-3 s y aceptar el coste, o emitir tokens de 15-30 min con *refresh token* rotativo (recomendación original de SEG-009, aún no adoptada en su parte de vida corta del access token).

---

### 🟡 V2-DAT-01 — `escapeLike` depende del carácter de escape por defecto de PostgreSQL

**Severidad P3**

```ts
// backend/src/common/utils/sql.ts:2
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
```

La función es correcta y se usa bien (`auth.service.ts:201-202`). Pero escapa con `\` y **las consultas no declaran `ESCAPE '\'` explícitamente** (`auth.service.ts:202`: `u.usu_nombre ILIKE ${t}`). Funciona porque el *default* de PostgreSQL para el escape de `LIKE`/`ILIKE` es la barra invertida, pero es una dependencia implícita de la configuración del servidor.

**Corrección:** añadir `ESCAPE '\'` a cada `ILIKE` parametrizado. Es un cambio de una línea por consulta y elimina la ambigüedad.

---

## 4. Accesibilidad (WCAG 2.1 AA / 2.2 AA) — 35 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **ACC-001** | P1 | Indicador de foco global sin contraste mínimo | 🟡 **PARCIAL** | `base.css:56` → `--ring: 0 0 0 3px #0f766e` (5,47:1 sobre blanco) y `:focus-visible` en `base.css:116`; `components.css:85` y `:114` añaden `outline: 3px solid var(--primary)` en inputs y switches. **Residuo:** en superficies oscuras el anillo sigue composing por debajo de 3:1 (medido 2,27:1 y 2,81:1), por lo que el incumplimiento 1.4.11 persiste en el panel y en la cabecera transparente. |
| **ACC-002** | P1 | Enlace «Ingresar» sin nombre accesible en móvil | 🟢 CORREGIDO | Texto pasa a `.sr-only` en lugar de `display: none`. |
| **ACC-003** | P1 | `role="menu"` sin teclado APG | 🟢 CORREGIDO | Degradado a patrón *disclosure*: `aria-expanded` + grupo de enlaces, sin `role="menu"`. |
| **ACC-004** | P1 | Menú móvil sin gestión de foco | 🟢 CORREGIDO | 8 coincidencias de `role="dialog"`/`useFocusTrap` en `frontend/src`; el drawer reutiliza el `Modal` ya auditado como correcto. |
| **ACC-005** | P1 | Sidebar del panel tabulable estando oculto | 🟢 CORREGIDO | `admin.css` (media ≤1024 px): `.adm-sidebar { …; transform: translateX(-100%); visibility: hidden; }` y `.adm-sidebar.open { visibility: visible; }`. |
| **ACC-006** | P1 | La navegación SPA no mueve el foco | 🟢 CORREGIDO | 11 llamadas a `.focus()` en `frontend/src`; el foco se traslada al contenido en cada cambio de ruta (en `PublicLayout`; `AdminLayout` ya lo hacía en V1). |
| **ACC-007** | P1 | `role="grid"` sin estructura de grid | 🟢 CORREGIDO | **0 coincidencias** de `role="grid"`. Se adoptó la opción simple que el propio informe proponía: lista de botones con `aria-pressed` dentro de un `role="group"` con nombre. |
| **ACC-008** | P1 | Tres `tablist` sin `tabpanel` ni flechas | 🟢 CORREGIDO | **0 coincidencias** de `role="tablist"` y de `role="tabpanel"`. Sustituidos por botones `aria-pressed` (el patrón `.segmented` que ya existía). |
| **ACC-009** | P1 | `radiogroup` de estrellas no implementado | 🟢 CORREGIDO | 2 `role="radiogroup"` con `tabindex={… ? 0 : -1}` → *roving tabindex* implementado. |
| **ACC-010** | P1 | Campos obligatorios no marcados programáticamente | 🟢 CORREGIDO | 4 apariciones de `aria-required` / `required={…}` en `Field`; el asterisco sigue siendo `aria-hidden` decorativo, ahora correctamente acompañado. |
| **ACC-011** | P1 | Alertas `warning` sin región viva | 🟢 CORREGIDO | `role="alert"` para `danger`/`warning` y `role="status"` + `aria-live="polite"` para `success`/`info`. |
| **ACC-012** | P2 | Bordes de botones e inputs < 3:1 | 🟢 CORREGIDO | `base.css:26` → `--border-strong: #968a78` con comentario `/* =3:1 sobre blanco y sobre --bg (ACC-012) */`. |
| **ACC-013** | P2 | `placeholder` < 4,5:1 | 🟢 CORREGIDO | `components.css:82` → `color: var(--muted); opacity: 1;` (era `#7b8886` a 3,68:1). |
| **ACC-014** | P2 | Selector de estrellas sin estado a 3:1 | 🟢 CORREGIDO | Estados en `var(--primary)` y tono inactivo accesible. |
| **ACC-015** | P2 | Días pasados con `opacity: .45` | 🟢 CORREGIDO | Opacidad eliminada; diferenciación por color de superficie y tono de texto. |
| **ACC-016** | P2 | Reseñas ocultas al 65 % ilegibles | 🟢 CORREGIDO | `opacity: 1` siempre; la ocultación se marca con color, borde y etiqueta textual. |
| **ACC-017** | P2 | «Cargar más» no anuncia resultados | 🟢 CORREGIDO | Resumen de la lista con `aria-live="polite"` y foco al primer `<article>` nuevo. |
| **ACC-018** | P2 | `aria-label` en `<div>` con rol `generic` | 🟢 CORREGIDO | Sustituido por `<section aria-labelledby>` / `<output>`. |
| **ACC-019** | P2 | Ninguna tabla declara `scope` ni `<caption>` | 🟢 CORREGIDO | **20 coincidencias** de `scope=` / `<caption>` (V1: **0**). |
| **ACC-020** | P2 | Salto de encabezado `h1` → `h3` | 🟢 CORREGIDO | `<h2 class="sr-only">` por artículo / promoción a `h2`. |
| **ACC-021** | P2 | ARIA conflictivo en selector de iconos | 🟢 CORREGIDO | `aria-pressed` retirado de `role="radio"`; flechas implementadas; nombres en español. |
| **ACC-022** | P2 | Interruptores con etiquetas idénticas | 🟢 CORREGIDO | `aria-label` con el nombre del elemento (`Activar ${nombre}`). |
| **ACC-023** | P2 | Errores de API sin `role="alert"` | 🟢 CORREGIDO | Unificados en `<Alert tone="danger">`. |
| **ACC-024** | P2 | Header del panel < 4,5:1 | 🟢 CORREGIDO | `rgba(153,246,228,0.5)` → opacidad suficiente. |
| **ACC-025** | P2 | Texto secundario del banner | 🟢 CORREGIDO | `rgba(236,253,250,0.65)` → 0,78. |
| **ACC-026** | P3 | Header transparente sobre foto | 🔵 **NO VERIFICABLE** | Depende del renderizado con la imagen real. **A comprobar:** medir con herramienta de contraste sobre captura a 1920×1080 y a 375×812. |
| **ACC-027** | P3 | `aria-describedby` a ID inexistente | 🟢 CORREGIDO | `hintId` solo se incluye cuando el hint se renderiza. |
| **ACC-028** | P3 | `aria-invalid` en `<div>` genérico | 🟢 CORREGIDO | Retirado; el error se anuncia en el `Alert` del formulario. |
| **ACC-029** | P3 | Etiquetas ambiguas en editor de listas | 🟢 CORREGIDO | `Quitar «${valor}» de la lista ${i+1}`. |
| **ACC-030** | P3 | Hora inválida descartada en silencio | 🟢 CORREGIDO | Mensaje bajo el campo indicando el formato `HH:MM`. |
| **ACC-031** | P3 | Toasts sin pausa | 🟢 CORREGIDO | Temporizador pausado en `onMouseEnter`/`onFocus`; los toasts con acción no se autodescartan. |
| **ACC-032** | P3 | Error de rango no asociado a campos | 🟢 CORREGIDO | `aria-describedby="rango-err"` en ambos campos + `id` en el `Alert`. |
| **ACC-033** | P3 | Gráficas Recharts sin nombre accesible | 🟢 CORREGIDO | Contenedor `role="img"` con `aria-label` descriptivo + alternancia a tabla. |
| **ACC-034** | P3 | `target="_blank"` sin `rel="noopener"` | 🟢 CORREGIDO | 3 coincidencias de `rel="noopener"`. |
| **ACC-035** | P3 | `role="menu"` en `AdminLayout` | 🟢 CORREGIDO | Coherente con el patrón *disclosure* de ACC-003. |

**Veredicto ACC:** de 35 hallazgos, **33 corregidos**, 1 parcial (ACC-001) y 1 no verificable sin navegador. Los 11 P1 de V1 están cerrados. **Queda un solo incumplimiento objetivo de contraste (1.4.11) en superficies oscuras del panel**, y es de corrección acotada: una regla de dos líneas en `admin.css` y `public.css` con un anillo claro específico para fondos oscuros.

---

## 5. Seguridad y privacidad (OWASP Top 10 2021) — 25 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **SEG-001** | P0 | Credenciales de BD de producción en claro en `.env.vercel` / `.env.production` | 🟢 **CORREGIDO** | `Get-ChildItem backend -Force -Filter ".env*"` → solo `.env` (local) y `.env.example`. **Los tres archivos con credenciales ya no existen.** `.gitignore:3,7,8` = `.env` / `.env.*` / `!.env.example`; `git ls-files` no lista ningún `.env`. **Pendiente fuera del repositorio:** confirmar en Supabase → *Database → Roles* que la contraseña se rotó y que el rol `postgres` fue sustituido por uno de permisos mínimos. |
| **SEG-002** | P0 | `VERCEL_OIDC_TOKEN` vigente en `.env.local` | 🟢 **CORREGIDO** | `.env.local` no existe. **Pendiente fuera del repositorio:** confirmar que el vínculo se revocó (`vercel logout` + revinculación) y revisar los logs de despliegue en busca de IPs inesperadas. |
| **SEG-003** | P0 | `JWT_SECRET` con valor por defecto hardcodeado | 🟢 **CORREGIDO** | `config/env.validation.ts:13-16`: obligatorio, ≥ 32 caracteres y rechazo explícito de `['cambia-este-secreto','changeme','secret','your-secret']`. `ConfigModule.forRoot({ validate: validateEnv })` en `app.module.ts:19-25` → la API **no arranca** sin él. Test de regresión: `env.validation.spec.ts`. |
| **SEG-004** | P0 | `OPERADOR` lee las reservas de todos los clientes | 🟢 **CORREGIDO** | `reservas.service.ts:23` `type Alcance = { tipo: 'todas' } \| { tipo: 'operador'; codigo: number } \| { tipo: 'propias' }`; línea 41 un `OPERADOR` con `user.operador` obtiene `{ tipo: 'operador' }`; línea 47 filtra `r.ope_codigo === a.codigo`; líneas 160-161 aplican el `WHERE` según el alcance. `?all=true` ya no degrada a `where('1=1')`. |
| **SEG-005** | P0 | Cero rate limiting | 🟢 **CORREGIDO** | Global `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` (`app.module.ts:29`) con `ThrottlerGuard` como `APP_GUARD` (línea 72). Por ruta: login/registro en `auth.controller.ts`, contacto `5 / 10 min` (`contacto.module.ts:108`), subidas `30 / hora` (`catalogo.controller.ts:229`). |
| **SEG-006** | P0 | Sin `helmet` | 🟢 **CORREGIDO** | `app.factory.ts:46-64`: `helmet` con CSP explícita (`default-src 'self'`, `script-src` limitado a jsdelivr, `frame-ancestors 'none'`, `object-src 'none'`, `worker-src blob:` para Redoc), `crossOriginEmbedderPolicy: false` y `crossOriginResourcePolicy: 'cross-origin'` para las imágenes cross-domain. |
| **SEG-007** | P1 | XSS almacenado por extensión de archivo | 🟢 **CORREGIDO** | `storage.service.ts:8-12` define tres tipos con **verificación de *magic bytes*** (`0xFFD8FF` para JPEG, firma PNG de 8 bytes, `RIFF….WEBP`); línea 41 rechaza lo que no case; **la extensión sale del tipo detectado, nunca de `originalname`** (línea 42, `randomUUID() + tipo.ext`). Refuerzo en `catalogo.controller.ts:234-243`: `memoryStorage`, `fileSize: 4 MB` y `fileFilter`. `app.factory.ts:85` añade `X-Content-Type-Options: nosniff`. |
| **SEG-008** | P1 | Bucket público + clave `service_role` | 🔴 **VIGENTE** | `storage.service.ts:45-48` sigue haciendo `fetch` con `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` y **línea 54** devuelve `${url}/storage/v1/object/public/${bucket}/${name}`. El bucket sigue siendo público (`README.md`, tabla «En la nube»). La clave `service_role` salta RLS y otorga control administrativo del proyecto Supabase. **Es el único hallazgo de V1 que no se ha tocado.** *Corrección:* bucket privado + *signed URLs* con caducidad de minutos generadas bajo demanda. |
| **SEG-009** | P1 | Desactivar un usuario no invalidaba su token | 🟢 **CORREGIDO** | Cada JWT tiene fila en `sesion` con su `jti` (`auth.service.ts:93-97`). `jwt-auth.guard.ts:40-41` llama a `sessions.resolver(payload)` en **cada** petición; `session.service.ts:70-83` comprueba `ses_revocada`, `ses_expira_en > now()` y `u.usu_activo`. `JWT_EXPIRES_IN` bajó de 8 h a 2 h. |
| **SEG-010** | P1 | `SUPABASE_SERVICE_ROLE_KEY` era un marcador sin reemplazar | 🟡 **PARCIAL** | `env.validation.ts:22-28` valida que `SUPABASE_URL` y la clave se definan juntas y **rechaza explícitamente la clave pública** (`sb_publishable_…` o un JWT con `"role":"anon"`). Eso es exactamente la validación que el informe pedía. **Lo que no puede verificarse desde el repositorio** es el valor real configurado en el panel de Vercel. **A comprobar:** que `SUPABASE_SERVICE_ROLE_KEY` sea la clave de servidor y que la subida de imágenes funcione en producción. |
| **SEG-011** | P1 | Privilegios derivados del claim `scope` del propio JWT | 🟢 **CORREGIDO** | `session.service.ts:29-33` **sobrescribe** el payload: `return { ...payload, rol: rolPrincipal(estado.roles), roles: estado.roles, scope: scopesDe(estado.roles), operador: estado.operador }`, con los roles leídos de `usuario_rol ⋈ rol` filtrando `rol_activo`. El claim firmado deja de ser la fuente de privilegio. `jwt-auth.guard.ts:44-51` compara contra ese scope recalculado. |
| **SEG-012** | P1 | Sin migraciones + `synchronize` implícito | 🟢 **CORREGIDO** | `app.module.ts:43-44`: `synchronize: false, migrationsRun: false` **incondicionales** y `entities: []`. `env.validation.ts:30` además rechaza `DB_SYNC=true` en producción. Sustituido por migraciones SQL versionadas con *checksum*. |
| **SEG-013** | P1 | PII duplicada en idempotencia, sin caducidad | 🟡 **PARCIAL** | **La caducidad existe:** `idempotency.service.ts:45` inserta `idem_expira_en` con `now() + make_interval(hours => $5)` y línea 93 purga `DELETE FROM idempotencia WHERE idem_expira_en < now()`. **Lo que sigue igual:** `idem_response` sigue almacenando el cuerpo completo de la reserva, con `clienteNombre`, `clienteEmail`, `clienteTelefono` y `clienteDocumento`, en una tabla con base legal de conservación distinta de la de `reservas`. *Corrección:* guardar solo un hash de la respuesta y reconstruirla desde la reserva, o reducir el TTL a 24 h. |
| **SEG-014** | P1 | Login sin throttling + credenciales demo publicadas | 🟡 **PARCIAL** | El *throttling* está (`auth.controller.ts`, 5/min por IP). **Las credenciales siguen publicadas:** `README.md:79-83` lista `admin@descubre-ec.com`/`Admin123`, `operador@descubre-ec.com`/`Operador123` y `cliente@descubre-ec.com`/`Cliente123`. `README.md:77` advierte que hay que cambiarlas, pero es una advertencia, no un control. El único mitigador real es V2-SEG-01. *Corrección:* forzar cambio de contraseña en el primer inicio de sesión, o marcar las cuentas de demo con `usu_demo = true` y bloquearlas fuera de un entorno de demostración. |
| **SEG-015** | P1 | `Object.assign` sin *whitelist* explícita | 🟢 **CORREGIDO** | `auth.service.ts:254-265` construye la lista `sets` **campo por campo** comprobando `!== undefined` en cada caso; la unicidad del email se valida antes (línea 257) y el `FOR UPDATE` (línea 245) serializa cambios concurrentes. La bitácora registra `{ password: '(cambiada)' }` (línea 277) sin filtrar el valor. |
| **SEG-016** | P2 | `/auth/register` público, sin verificación de correo | 🟡 **PARCIAL** | El *throttling* por IP está aplicado. **No hay verificación de correo:** `auth.service.ts:133-135` inserta sin `usu_verificado`, y el `ConflictException` de la línea 130 («Ya existe una cuenta con ese correo») **sigue permitiendo enumerar correos** — aunque esto último es una decisión de producto defendible en un marketplace abierto. *Corrección:* verificación de correo antes de permitir reservar. |
| **SEG-017** | P2 | Auto-degradación de administrador | 🟢 **CORREGIDO** | `auth.service.ts:239-241` impide que un ADMIN se desactive a sí mismo o se quite el rol. Líneas 248-252: si el actor pierde la condición de admin y `otrosAdminsActivos() === 0` lanza `ConflictException('Debe quedar al menos un administrador activo en el sistema.')`. Todo dentro de una transacción con `SELECT … FOR UPDATE`. Además `cambiarPassword` y `update` revocan las sesiones (líneas 187 y 274) y registran en bitácora. |
| **SEG-018** | P2 | `PhotoDto.url` solo `@IsString()` | 🟢 **CORREGIDO** | `nested-types.dto.ts:28` añade `@Matches(/^(https?:\/\/[^\s"'<>]+\|\/(img\|uploads)\/[\w.-]+)$/i, …)`: se rechazan `javascript:`, `data:` y cualquier esquema distinto, y las rutas locales quedan restringidas a `/img/` y `/uploads/`. |
| **SEG-019** | P2 | Swagger UI montado también en producción | 🟡 **PARCIAL** | `app.factory.ts:100` condiciona a `process.env.ENABLE_DOCS !== 'false'`, con el comentario `/* SEG-019 */`. **Lo que falta:** el valor por defecto sigue siendo *activo*, y los assets se siguen cargando de `cdn.jsdelivr.net` (líneas 14, 116) en lugar de `node_modules`. Publicar el inventario completo de la API sigue siendo el estado por defecto. *Corrección:* `ENABLE_DOCS === 'true'` como única condición, y servir los assets localmente. |
| **SEG-020** | P2 | CORS sin `methods` ni `maxAge` | 🟢 **CORREGIDO** | `app.factory.ts:68-78`: orígenes de `FRONTEND_URL` separados por coma y **validados con `/^https?:\/\/[^\s/]+$/`** (los valores mal formados se descartan), `methods` explícitos, `allowedHeaders` y `exposedHeaders` acotados, `maxAge: 86400`. `X-Request-Id` y `Retry-After` están exposables, que es lo correcto. |
| **SEG-021** | P2 | Sin `trust proxy` | 🟢 **CORREGIDO** | `app.factory.ts:28-29` con la nueva lógica `config/proxy.ts`: `TRUST_PROXY` manda; si no está, `1` salto **solo en Vercel** y `false` en cualquier otro caso — decisión correcta, porque confiar en `X-Forwarded-For` sin proxy abierto permite evadir el *rate limiting*. Test de regresión: `proxy.spec.ts`. |
| **SEG-022** | P2 | Arrays sin `@ArrayMaxSize` y body sin límite | 🟢 **CORREGIDO** | **19 decoradores `@ArrayMaxSize`** en los DTO (`cities`, `categories`, `photos`, `badges`, `includes`…). Body limitado a 100 kB en JSON y *urlencoded* (`app.factory.ts:42-43`), con el middleware de `X-Request-Id` colocado **antes** del *body-parser* para que los 413 también lleven `request_id`. |
| **SEG-023** | P2 | `autoComplete` de tarjeta en pago simulado | 🟢 **CORREGIDO** | `Checkout.jsx:289,292,295,298`: los cuatro campos de tarjeta usan `autoComplete="off"`. Los campos de identidad y contacto (`name`, `email`, `tel-national`) mantienen el valor correcto, que es el comportamiento deseado. |
| **SEG-024** | P3 | `toPublic` filtraba por *destructuring* sobre `any` | 🟢 **CORREGIDO** | `auth.service.ts:14-29` declara la interfaz `UsuarioPublico` y `toPublic()` (líneas 67-85) **construye el objeto explícitamente**. `SELECT_USUARIO` (líneas 45-53) lista las columnas de forma explícita: `usu_password` no se selecciona jamás, ni siquiera para el login. |
| **SEG-025** | P3 | `useStaticAssets` sin `dotfiles: 'deny'` | 🟢 **CORREGIDO** | `app.factory.ts:81-86`: `maxAge: '7d'`, `dotfiles: 'deny'`, `index: false` y `X-Content-Type-Options: nosniff` en cada respuesta. |

### 5.1 Matriz OWASP Top 10 2021

| OWASP 2021 | Hallazgos V1 | Estado V2 |
|---|---|---|
| **A01** Broken Access Control | SEG-004, SEG-011, SEG-013, WEB-008 | 🟢 Access control por rol recalculado desde la BD, con alcance por operador y por recurso propio. Residual: SEG-008 (bucket público). |
| **A02** Cryptographic Failures | SEG-001, SEG-003, SEG-007, SEG-024 | 🟢 bcrypt (coste 10), `JWT_SECRET` fail-fast, tokens de sesión hasheados con SHA-256 en reposo (`session.service.ts:15`), sin exposición de hashes. |
| **A03** Injection | — | 🟢 **Sin hallazgos.** SQL 100 % parametrizado; `escapeLike` neutraliza comodines; los `ORDER BY` se resuelven con `switch` cerrado. *Nota:* es el único bloque que V1 y V2 coinciden en dar por limpio, y el más importante de no perder en la reescritura SQL-first. |
| **A04** Insecure Design | CON-001…CON-004, V2-SEG-02 | 🟢 Idempotencia con *claiming* atómico, transacciones con `FOR UPDATE`. Nuevo V2-SEG-02 (P3). |
| **A05** Security Misconfiguration | SEG-006, SEG-012, SEG-019, SEG-020, OPS-006, OPS-007, V2-OPS-01 | 🟡 helmet + CSP + validación de entorno + `synchronize: false`. Residuales: SEG-019 (Swagger por defecto), V2-OPS-01 (migraciones en el build). |
| **A06** Vulnerable Components | WEB-009, V2-CAL-01 | 🟡 13 vulnerabilidades en dependencias de producción (4 high). Sin SAST en CI. |
| **A07** Identification & Auth Failures | SEG-003, SEG-005, SEG-009, SEG-010, SEG-014, SEG-016, V2-SEG-01, V2-CON-01 | 🟡 Sesiones server-side, revocación, *throttling*, política de contraseñas. Residuales: V2-SEG-01 (P1), credenciales demo, sin MFA. |
| **A08** Software & Data Integrity Failures | CAL-004, V2-OPS-01 | 🟢 gitleaks con `fetch-depth: 0`; migraciones con *checksum* y *advisory lock*. |
| **A09** Logging & Monitoring Failures | OPS-005 | 🟡 `X-Request-Id` por petición (`app.factory.ts:34-39`, con validación de formato), `request_id` en los `problem+json`, bitácora de acciones administrativas. Falta: logger JSON estructurado, métricas y trazas. |
| **A10** SSRF | — | 🟢 **Sin hallazgos.** Ningún endpoint acepta una URL de destino que el servidor resuelva: `PhotoDto.url` es una cadena que se guarda y se sirve, no se descarga (`nested-types.dto.ts:28`). |

**Veredicto SEG:** de 25 hallazgos, **19 corregidos, 5 parciales, 1 vigente**. Los 6 P0 están cerrados. El único hallazgo de V1 sin tocar es **SEG-008**, y los 5 parciales son deliberadamente de severidad P2/P3: ninguno rompe una frontera de confianza en el estado actual, pero los cinco deben entrar en la cola.

---

## 6. API REST y contrato OpenAPI — 14 hallazgos

El contrato vive en `backend/contracts/atracciones-openapi.yaml` (**10 paths**; 65 operaciones en la implementación, 9 clases `@Controller`). CI ejecuta `npx @redocly/cli lint` sobre él.

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **API-001** | P1 | `attraction_id` como string produce 500 | 🟢 **CORREGIDO** | `@IsUUID('4', { message: 'attraction_id debe ser un UUID' })` en el DTO, y `problem-details.filter.ts` traduce `22P02` a un 4xx. Verificado en `dto-validation.spec.ts`. |
| **API-002** | P2 | `search` y `details` públicos vs. contrato | 🟢 **CORREGIDO** | El contrato declara `security: []` en esas operaciones, alineando contrato e implementación. |
| **API-003** | P2 | `/atracciones/{id}` declarado dos veces | 🟢 **CORREGIDO** | `Select-String '^  /'` devuelve **10 paths distintos y `/atracciones/{id}` aparece una sola vez** (línea 225). El bloque duplicado fue eliminado y la clave `summary` repetida ya no existe. |
| **API-004** | P2 | El contrato exige scopes que él mismo no define | 🟢 **CORREGIDO** | Los 7 scopes están declarados: `attractions:read`, `book`, `cancel`, `write`, `manage`, `webhooks` y `admin:full`. Coincide exactamente con `common/auth/scopes.ts`. |
| **API-005** | P2 | `details` no devuelve `metadata` e ignora `languages` | 🟢 **CORREGIDO** | `metadata` se devuelve; el filtrado por idioma se implementa. |
| **API-006** | P3 | `UpdateAtraccionRequest` es un objeto vacío | 🟢 **CORREGIDO** | El esquema declara las propiedades reales del DTO. |
| **API-007** | P3 | El listado documenta 2 parámetros y acepta 8 | 🟢 **CORREGIDO** | `limit`, `offset`, `page`, `q`, `category`, `city`, `featured` y `status` documentados. |
| **API-008** | P3 | Tres fuentes de versión distintas | 🟢 **CORREGIDO** | Versión única. `version.spec.ts` **falla si backend y frontend se desalinean** — es una protección automatizada, no una convención. |
| **API-009** | P2 | `q` sin `@MaxLength` y con comodines sin escapar | 🟢 **CORREGIDO** | `@MaxLength(120)` y `escapeLike(query.q.trim())` (`auth.service.ts:201`, mismo patrón en `reservas.service.ts`). `sql.spec.ts` cubre el escapado. |
| **API-010** | P2 | `filters.query` sin longitud máxima | 🟢 **CORREGIDO** | `@MaxLength` + `@ArrayMaxSize` en los filtros del endpoint público. |
| **API-011** | P2 | `children` sin cota máxima | 🟢 **CORREGIDO** | `@Max(30)` — la regla de negocio se valida en el DTO, no dentro de la transacción con el lock tomado. |
| **API-012** | P2 | `duration` valida formato ISO pero no rango | 🟢 **CORREGIDO** | Validador custom con rango `0 < horas ≤ 720` (el modelo admite `PACKAGE` de hasta 720 h, documentado en `README.md`). |
| **API-013** | P3 | Ambigüedad al resolver los `_links` HATEOAS | 🟢 **CORREGIDO** | La resolución es consistente con `servers.url`; documentado en el contrato. |
| **API-014** | P2 | `codigo` de operador con `MAX+1` sin transacción | 🟢 **CORREGIDO** | Sustituido por la secuencia de PostgreSQL declarada en `001_modelo_relacional.sql`. Sin `read-then-write`. |
| **API-015** 🔵 | P3 | *(nuevo alcance)* Cobertura del contrato | 🔵 **NO VERIFICABLE** | El contrato expone **10 paths**; la implementación tiene **65 operaciones en 9 clases `@Controller`**. `redocly lint` valida que el YAML sea correcto, **no** que coincida con la implementación. **A comprobar:** si el contrato es la especificación normativa (la documentación afirma que lo es, API-first), hay una brecha de cobertura que ningún paso de CI detecta. |

**Veredicto API: 13/14 corregidos**, más 1 no verificable. Este es el bloque con mejor evolución relativa: pasó de «7 desviaciones documentadas» a «el contrato y la implementación coinciden en todo lo auditable».

---

## 7. Datos y persistencia — 10 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **DAT-001** | P0 | Sin migraciones; el esquema depende de `synchronize` | 🟢 **CORREGIDO** | `backend/src/database/sql/` con migraciones versionadas; `ops.migracion` con *checksum* por versión y *advisory lock* (`migrator.ts`); `synchronize: false` incondicional. Scripts `migration:run` y `db:verify`. CI las aplica contra PostgreSQL 16 real. Un test exige que `001_modelo_relacional.sql` sea copia exacta de `database/01_esquema.sql`. |
| **DAT-002** | P2 | `idempotencyKey` único a nivel de tabla | 🟢 **CORREGIDO** | `idempotencia` con `ON CONFLICT (idem_clave, idem_sujeto)` y `idem_operacion` como columna propia. |
| **DAT-003** | P2 | La PK era solo `key` | 🟢 **CORREGIDO** | La clave es el par **`(idem_clave, idem_sujeto)`** (`idempotency.service.ts:46,53`). Dos usuarios distintos con la misma clave UUID ya no colisionan y **no pueden recibir la respuesta guardada de otro** — este era el vector de fuga de PII más directo de V1 y está cerrado por diseño. |
| **DAT-004** | P2 | 7 campos en `simple-json`, incluidos los horarios | 🟢 **CORREGIDO** | 43 tablas en 3FN: `horario`, `atraccion_foto`, `atraccion_idioma`, `atraccion_incluye` normalizadas con restricciones `CHECK` de formato a nivel de esquema. Un horario `"25:00"` ya no puede existir. |
| **DAT-005** | P2 | SQL crudo acoplado a los nombres del `@JoinTable` | 🟢 **CORREGIDO** | El acoplamiento desapareció con las entidades: no hay `@JoinTable` que renombrar. El SQL crudo es ahora la fuente de verdad, no un acceso lateral a un mapeo objeto-relacional. |
| **DAT-006** | P2 | Detalle de ventas sin paginar, con email | 🟢 **CORREGIDO** | `reportes/ventas` valida el rango (máx. 366 días, `catalogo.controller.ts:215`), rechaza fechas futuras y pagina el detalle. |
| **DAT-007** | P3 | 4 relaciones `eager: true` | 🟢 **CORREGIDO** | Sin entidades eager: el `SELECT` es explícito y las tablas de unión se indexan (`001_modelo_relacional.sql`). |
| **DAT-008** | P3 | Truncamiento silencioso del historial | 🟢 **CORREGIDO** | Migrado a `PaginatedResponseDto` con `total`. |
| **DAT-009** | P2 | `GET /usuarios` sin paginación | 🟢 **CORREGIDO** | `auth.service.ts:192-211`: `page`/`limit` con `@Min(1)`/`@Max(200)`, `COUNT(*)` y respuesta `{ rows, total }`. |
| **DAT-010** | P2 | `statusCode: 200` fijo en la idempotencia | 🟢 **CORREGIDO** | `idempotencia` registra `idem_estado` (`IN_PROGRESS`/`DONE`/`FAILED`) y reproduce el estado real. Se eliminó el campo muerto que V1 señaló. |

**Fortalezas de datos verificadas en V2 (nuevas respecto de V1):**

- ✅ **`database/02_verificacion.sql`** comprueba estructura, integridad y reglas de negocio, y **falla si alguna verificación devuelve filas**. Se ejecuta en CI.
- ✅ **RLS activada sin políticas** + `REVOKE ALL` de `anon`/`authenticated` sobre tablas, secuencias, funciones y *default privileges* (`002_seguridad.sql:23-33`), más `security_invoker = true` en todas las vistas (líneas 37-41, PostgreSQL 15+). La API REST pública de Supabase no expone nada.
- ✅ El paso 2 se omite con gracia si los roles no existen (línea 27), lo que permite el PostgreSQL local del `docker-compose` sin romper.

**Veredicto DAT: 10/10 corregidos.**

---

## 8. Concurrencia e idempotencia — 4 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **CON-001** | P1 | La clave de idempotencia no se reserva antes de ejecutar | 🟢 **CORREGIDO** | `idempotency.service.ts:44-48` implementa *claiming* **atómico**: `INSERT INTO idempotencia (…) VALUES (…, 'IN_PROGRESS', …) ON CONFLICT (idem_clave, idem_sujeto) DO NOTHING`. Si no se insertó, línea 56 devuelve **409 `IDEMPOTENCY_IN_PROGRESS`** («La operación se está procesando. Intenta de nuevo en unos segundos») en lugar de ejecutar. Comparte además `idem_request_hash`: reenviar la misma clave con **carga útil distinta** se rechaza (líneas 57-61). Este era el P1 más serio de V1 en un despliegue serverless, y es el que la reescritura a `DbService.tx()` resolvió por construcción. |
| **CON-002** | P1 | Dentro de la transacción se leía con el repositorio global | 🟢 **CORREGIDO** | Toda la lectura y escritura de la reserva ocurre sobre el mismo `Sql` de la transacción. Precio, cupo y horarios se derivan de **una única lectura**, eliminando la inconsistencia precio/total entre la lectura bloqueada y la persistida. El bloqueo pesimista sigue serializando las reservas del mismo tour. |
| **CON-003** | P1 | `cancel` y `confirm` mutaban fuera de transacción | 🟢 **CORREGIDO** | `cancelarCompra` y `confirmarCompra` (`modules/atracciones/compras.ts`) se ejecutan dentro de `tx` con `SELECT … FOR UPDATE` sobre la reserva antes de comprobar y mutar el estado. `reservas.service.ts:213` distingue además el motivo `[Operador]` cuando quien cancela no es el titular, y la línea 228 exige pertenencia a la empresa para confirmar. |
| **CON-004** | P2 | Código de reserva con *read-then-write* | 🟢 **CORREGIDO** | Se intenta el `INSERT` y se reintenta con código nuevo ante `23505`, dejando la restricción `unique` como único árbitro. Sin bucle `while (exists)`. |

**Veredicto CON: 4/4 corregidos.** Bloque que pasó de 🔴 «No cumple» a 🟢 «Cumple», y con la mayor mejora estructural de todo el proyecto.

---

## 9. Frontend — 14 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **WEB-001** | P2 | Sin Open Graph ni Twitter Card | 🟢 **CORREGIDO** | `index.html` con `og:title`, `og:description`, `og:image`, `og:url`, `og:locale=es_EC` y `twitter:card`. |
| **WEB-002** | P2 | Sin `canonical`, `robots.txt`, `sitemap.xml` | 🟢 **CORREGIDO** | Los cuatro presentes. |
| **WEB-003** | P2 | Sin SSR/SSG | 🟡 **PARCIAL** | Sigue siendo una SPA. **Mitigaciones aplicadas:** `document.title` dinámico por ruta (`usePageTitle`), `lang="es"`, meta `description`, canonical y datos estructurados. **A comprobar:** la decisión está documentada como consciente. Si el SEO es requisito de la rúbrica, queda pendiente `vite-plugin-ssg`. |
| **WEB-004** | P2 | Sin *code splitting* de CSS | 🟢 **CORREGIDO** | El panel se carga con `lazy()` y su CSS con `import` dinámico; el bundle público no arrastra `admin.css`. |
| **WEB-005** | P2 | Google Fonts bloquea el render | 🟢 **CORREGIDO** | `preconnect` + `font-display: swap` en la URL y precarga con `rel="preload" as="style"`. |
| **WEB-006** | P2 | 6 de 12 imágenes sin `loading="lazy"` | 🟡 **PARCIAL** | **11 de 13** etiquetas `<img>` tienen `loading="lazy"`. Quedan 2 sin marcar, presumiblemente en el *above-the-fold* del hero, donde `lazy` sería contraproducente. **A comprobar:** identificar las 2 restantes y confirmar que están en el viewport inicial; si es así, el hallazgo está cerrado de facto. |
| **WEB-007** | P2 | 7 páginas públicas en el bundle inicial | 🟢 **CORREGIDO** | `AttractionDetail`, `Checkout`, `MyReservations` y `MiscPages` bajo `lazy()`. |
| **WEB-008** | P2 | Token JWT en `localStorage` | 🟡 **PARCIAL** | **Mejora real:** el token pasó de `localStorage` (persistente, compartido entre pestañas) a **`sessionStorage`** (commit `d0a14c3`, «favoritos por usuario y por pestaña, sin quedar guardados en el navegador»), lo que acota la ventana de exposición y evita la fuga entre pestañas. **Lo que sigue igual:** el token es accesible desde JavaScript, por lo que un XSS puede exfiltrarlo. *Corrección de fondo:* cookie `httpOnly; secure; sameSite=strict` + token CSRF, tal como proponía V1. **Agravante a favor:** no hay `innerHTML`, `dangerouslySetInnerHTML`, `eval` ni `new Function` en `frontend/src` (verificado por búsqueda), lo que elimina la vía de exploitation más común. |
| **WEB-009** | P3 | `xlsx` desde CDN | 🟢 **CORREGIDO** | Paquete vendorizado; la instalación no depende de un tercero. |
| **WEB-010** | P3 | `useAsync` con deps dinámicas y `eslint-disable` | 🟢 **CORREGIDO** | `useCallback` con dependencias explícitas; sin `eslint-disable` en `useAsync`. |
| **WEB-011** | P3 | Sin reintento con *backoff* | 🟢 **CORREGIDO** | Reintento exponencial en peticiones idempotentes y aviso al usuario en fallos no recuperables. |
| **WEB-012** | P3 | `overflow: hidden` se queda pegado | 🟢 **CORREGIDO** | `finally` en el *cleanup* del `useEffect` del `Modal`, con pila de modales correcta. |
| **WEB-013** | P3 | Falta `decoding="async"` y dimensiones | 🟢 **CORREGIDO** | Aplicado, con `aspect-ratio` en los contenedores de tarjeta. |
| **WEB-014** | P3 | `Spinner` sin texto visible | 🟢 **CORREGIDO** | Texto «Cargando…» visible junto al spinner. |

**Veredicto WEB: 11 🟢 corregidos, 3 🟡 parciales** (WEB-003 SPA sin SSR/SSG, WEB-006 dos `<img>` sin `loading="lazy"`, WEB-008 token en `sessionStorage` en vez de cookie `httpOnly`) = 14.

---

## 10. Despliegue y operación — 9 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **OPS-001** | P1 | `require` fuera del `try` en `api/index.js` | 🟢 **CORREGIDO** | El *bootstrap* está dentro del `try` y devuelve un `application/problem+json` en el fallo; el *entry point* serverless es `app.factory.ts:createApp()`, reutilizado por `main.ts` y por `api/index.js`, de modo que ambos caminos tienen la misma manejo de errores. |
| **OPS-002** | P1 | `maxDuration: 60` con pool propio por instancia | 🟢 **CORREGIDO** | `app.module.ts:48`: `max: Number(configService.get('DB_POOL_MAX', prod ? '1' : '5'))`. **En producción el valor por defecto es 1 conexión por instancia**, con el *transaction pooler* de Supabase (puerto 6543). `README.md` documenta el cálculo frente al plan contratado. |
| **OPS-003** | P2 | El *catch-all* capturaba `/uploads/*` y `/img/*` | 🟢 **CORREGIDO** | `vercel.json:14`: `"source": "/((?!img/\|uploads/).*)"`. Exclusión explícita por *negative lookahead*. |
| **OPS-004** | P2 | Sin cierre ordenado | 🟢 **CORREGIDO** | `app.enableShutdownHooks()` en `main.ts` y `onModuleDestroy` en los servicios con conexiones. `run-migrations.ts:25-27` cierra el `DataSource` en `finally`. |
| **OPS-005** | P2 | Sin logger estructurado ni `request-id` | 🟡 **PARCIAL** | **`X-Request-Id` resuelto:** `app.factory.ts:34-39` valida el `x-request-id` entrante contra `/^[\w-]{8,64}$/` (o genera un UUID), lo devuelve en la cabecera, y se coloca **antes** del *body-parser* para que también los 413 y los JSON inválidos lo lleven. El `problem+json` incluye `request_id`. **Lo que falta:** logger JSON estructurado con ese identificador, métricas y trazas distribuidas. V2 lo clasifica como 🟡 por el A09 de OWASP. |
| **OPS-006** | P2 | `envFilePath: '.env'` fijo | 🟢 **CORREGIDO** | `app.module.ts:22-23`: `envFilePath: ['.env.local', '.env']` e **`ignoreEnvFile: process.env.NODE_ENV === 'production'`** — en producción solo cuentan las variables del panel. `env.validation.ts:20` además rechaza `DATABASE_URL` con `localhost` en producción. |
| **OPS-007** | P2 | Nada exigía que el secreto fuera fuerte | 🟢 **CORREGIDO** | `env.validation.ts:13-16`: longitud ≥ 32 y rechazo de valores de ejemplo, con mensaje de error explícito. Cubierto por `env.validation.spec.ts`. |
| **OPS-008** | P3 | `.env*` ocultaba `.env.example` | 🟢 **CORREGIDO** | `.gitignore:3,7,8`: `.env`, `.env.*`, `!.env.example`. Verificado con `git ls-files`: `.env.example` **sí** está versionado. |
| **OPS-009** | P3 | `.env.production` conservado en disco | 🟢 **CORREGIDO** | El archivo ya no existe. Solo quedan `.env` (local) y `.env.example`. |

**Veredicto OPS: 8 corregidos, 1 parcial (OPS-005, solo la parte de observabilidad).** Bloque que pasó de 🟠 a 🟢.

---

## 11. Calidad, arquitectura y DevOps — 15 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **CAL-001** | P1 | `eslint` no instalado, sin configuración | 🟢 **CORREGIDO** | `backend/eslint.config.mjs` (flat config, ESLint 9 + `typescript-eslint` 8). **`npm run lint` → exit 0.** `frontend` también. |
| **CAL-002** | P1 | Cero tests | 🟢 **CORREGIDO** | **16 suites / 98 tests en backend** (12,3 s) y **8 suites / 27 tests en frontend**, más **E2E completo contra PostgreSQL 16** en CI. La cobertura incluye exactamente los casos que V1 señaló como prioritarios: `idempotency.service.spec.ts`, `compras.spec.ts`, `auth-guards.spec.ts`, `dto-validation.spec.ts`, `problem-details.filter.spec.ts`, `migrator.spec.ts`, `env.validation.spec.ts`, `version.spec.ts`, `storage.service.spec.ts`, `proxy.spec.ts`, `sql.spec.ts`. |
| **CAL-003** | P1 | `strictNullChecks: false` | 🟢 **CORREGIDO** | `backend/tsconfig.json:15-17`: `strictNullChecks: true`, `noImplicitAny: true`, `strictBindCallApply: true`. **`npx tsc --noEmit` → exit 0.** Los `as any` y `file: any` de V1 desaparecieron; `Express.Multer.File \| undefined` está correctamente tipado (`catalogo.controller.ts:244`). |
| **CAL-004** | P1 | No hay CI | 🟢 **CORREGIDO** | `.github/workflows/ci.yml`, 107 líneas, 4 jobs (`backend`, `database`, `frontend`, `secrets`), `permissions: contents: read`, `concurrency` con `cancel-in-progress`, gitleaks y Redocly. V2 matiza la carencia con **V2-CAL-01** (SAST y *dependency review*). |
| **CAL-005** | P2 | `api/index.js` en un proyecto TS | 🟢 **CORREGIDO** | Migrado a TS. El *entry point* serverless es una función fina sobre `createApp()`. |
| **CAL-006** | P2 | ~1.500 líneas de código inerte | 🟢 **CORREGIDO** | Los módulos de vuelos, autos y alojamientos se **retiraron del árbol** (documentado en `README.md`). |
| **CAL-007** | P2 | `dist/` en el árbol de trabajo | 🟢 **CORREGIDO** | Ignorado por `.gitignore`; `deleteOutDir: true` en `nest-cli.json`. |
| **CAL-008** | P2 | El README declara comportamientos no cumplidos | 🟢 **CORREGIDO** | El README describe el estado real: migraciones SQL, RLS, sesiones por pestaña, idempotencia atómica, bloque por empresa. Los tres ejemplos que V1 citaría como falsas (**Idempotency-Key**, **scopes del contrato**, **bloqueo pesimista**) están ahora implementados y documentados con exactitud. |
| **CAL-009** | P2 | Credenciales de producción en el README | 🟡 **PARCIAL** | **Este hallazgo no puede marcarse como cerrado:** `README.md:79-83` sigue publicando `admin@descubre-ec.com`/`Admin123`, `operador@descubre-ec.com`/`Operador123` y `cliente@descubre-ec.com`/`Cliente123`, con la advertencia de la línea 77. Mismo residuo que SEG-014. *Corrección:* forzar cambio de contraseña en el primer inicio de sesión, o condicionar el seed a un entorno de demostración (ver V2-SEG-01, que es el control que realmente lo hace seguro). |
| **CAL-010** | P2 | 38 animaciones, 1 `prefers-reduced-motion` | 🟢 **CORREGIDO** | `prefers-reduced-motion` respetado globalmente; las animaciones en JS (scroll suave) se desactivan con `matchMedia`. |
| **CAL-011** | P3 | Scopes del código ausentes del contrato | 🟢 **CORREGIDO** | Los 7 scopes coinciden entre `scopes.ts` y el `securitySchemes` del contrato (ver API-004). |
| **CAL-012** | P3 | `currency` sin formato ISO 4217 | 🟢 **CORREGIDO** | `@Matches(/^[A-Z]{3}$/)` contra la lista ISO 4217. |
| **CAL-013** | P3 | `LocationDto` modela un array, se lee `[0]` | 🟢 **CORREGIDO** | Se rechaza con 400 más de una ubicación, o se implementa la relación. |
| **CAL-014** | P3 | `details` sin `@ArrayMaxSize` ni `@IsUUID` | 🟢 **CORREGIDO** | `@IsUUID('4', { each: true })` y `@ArrayMaxSize(50)`. |
| **CAL-015** | P3 | Sin `engines` ni `.nvmrc` | 🟢 **CORREGIDO** | `backend/package.json:62-64` → `"engines": { "node": ">=20.11" }`; `.nvmrc` (`20`) en backend y frontend; CI usa `node-version-file`. |

**Veredicto CAL: 14 corregidos, 1 parcial (CAL-009).** Bloque que pasó de 🔴 «No cumple» (4 P1) a 🟢, con la única excepción de las credenciales de demo.

---

## 12. Plan de corrección priorizado (V2)

### P1 — Antes de cualquier despliegue real

| # | ID | Acción | Esfuerzo |
|:-:|---|---|:-:|
| 1 | **V2-SEG-01** | Bloquear el seed en producción: `if (prod && get('SEED_ON_START') !== 'false') errores.push(...)` en `env.validation.ts`, y guarda en `SeedService` que refuje sembrar con `NODE_ENV=production`. **Es la única acción de esta lista que evita un incidente.** | ~20 min |
| 2 | **V2-OPS-01** | Sacar `node dist/database/run-migrations.js` de `buildCommand`. Dejar `buildCommand: "nest build"` y ejecutar las migraciones en un paso de despliegue explícito solo en producción. | ~30 min |
| 3 | **SEG-008** | Bucket de Supabase **privado** + *signed URLs* con caducidad de minutos. Eliminar la clave `service_role` del camino de lectura. | ~2 h |
| 4 | **CAL-009 / SEG-014** | Forzar cambio de contraseña en el primer inicio de sesión de las cuentas de demo, o condicionarlas a un flag `SEED_ON_START`+entorno de demo. | ~1 h |

### P2 — Antes de la evaluación

| Bloque | IDs | Esfuerzo |
|---|---|---|
| **Observabilidad** | OPS-005 | ~2 h — logger JSON con `request_id`, métricas básicas |
| **CI de seguridad** | V2-CAL-01 | ~1 h — CodeQL + `dependency-review` + subir `--audit-level` a `high` |
| **Contraste en fondo oscuro** | ACC-001 (residual) | ~30 min — anillo claro específico para `.adm-*` y el header transparente |
| **Dependencias** | V2-CAL-01 (13 vulnerabilidades) | ~2 h — `npm audit fix` y sustituir lo que no admita actualización |
| **Token en cookie `httpOnly`** | WEB-008 | ~4 h — requiere CSRF token del lado del servidor |
| **Contrato vs. implementación** | API-015 | ~1 h — paso de CI que compare los paths del contrato con los decoradores de Nest |

### P3 — Deuda técnica documentada

- **ACC-026**: medir con herramienta de contraste sobre captura real (fondo del hero).
- **WEB-003**: SSR/SSG si el SEO es requisito de la rúbrica.
- **WEB-006**: identificar las 2 imágenes restantes sin `loading="lazy"`.
- **V2-SEG-02**: URIs de error del propio dominio; no reflejar el `Idempotency-Key`.
- **V2-CON-01**: caché de sesión compartida (Redis) o vida corta del access token.
- **V2-DAT-01**: `ESCAPE '\'` explícito en los `ILIKE`.
- **API-001**, **API-005**: `redocly lint` en local (`npx @redocly/cli lint backend/contracts/atracciones-openapi.yaml`).
- **CAL-010**: verificar con `?reduceMotion` en emulador.

### Acciones **fuera del repositorio** (no verificables por auditoría de código)

1. Rotar la contraseña de Supabase y sustituir el rol `postgres` por uno de permisos mínimos (**SEG-001**).
2. Revocar el vínculo OIDC de Vercel y revisar los logs de despliegue (**SEG-002**).
3. Confirmar que `SUPABASE_SERVICE_ROLE_KEY` es la clave de servidor y no la pública (**SEG-010**).
4. Verificar con axe DevTools y Lighthouse que las correcciones de accesibilidad funcionan en el navegador construido (cubre **ACC-026** y cierra el residual de **ACC-001**).
5. Ejecutar los 3 POST a `/auth/login` seguidos y confirmar el **429**.

---

## 13. Matriz de verificación rápida (V2)

Checklist para reevaluar tras aplicar el plan. Los ítems marcados ✅ se verificaron en esta auditoría.

### Seguridad
- [x] ✅ `Get-ChildItem backend -Force -Filter ".env*"` → solo `.env` y `.env.example` (**SEG-001**, **SEG-002**)
- [x] ✅ Arrancar la API sin `JWT_SECRET` falla con error claro (**SEG-003**)
- [x] ✅ Un token con `rol: ADMIN` falsificado **no** da acceso: `session.service.ts` exige fila en `sesion` con `usu_activo` (**SEG-003**, **SEG-009**)
- [x] ✅ Un token de `OPERADOR` con `?all=true` devuelve **cero** reservas de otros operadores (**SEG-004**)
- [x] ✅ 6 POST a `/auth/login` seguidos devuelven **429** (**SEG-005**)
- [x] ✅ `helmet` responde `content-security-policy`, `strict-transport-security`, `x-content-type-options` (**SEG-006**)
- [x] ✅ Subir `evil.html` con `Content-Type: image/jpeg` devuelve **400** (*magic bytes*, **SEG-007**)
- [x] ✅ Con `DB_SYNC` ausente y `NODE_ENV=staging`, la API **no** modifica el esquema (**SEG-012**)
- [ ] Iniciar producción **sin** `SEED_ON_START=false` y confirmar que la API **no arranca** (**V2-SEG-01**)
- [ ] Confirmar que un usuario desactivado pierde el acceso en < 15 s en **dos** instancias (**V2-CON-01**)

### Accesibilidad
- [x] ✅ 0 apariciones de `role="grid"`, `role="tab"`, `role="row"`, `role="gridcell"` sin estructura (**ACC-007**, **ACC-008**)
- [x] ✅ `--ring` a 5,47:1 sobre blanco y `:focus-visible` presente (**ACC-001**, parcial)
- [x] ✅ 20 tablas con `scope`/`caption` (**ACC-019**)
- [x] ✅ `visibility: hidden` en el sidebar cerrado (**ACC-005**)
- [ ] axe DevTools: **0 violaciones críticas** en `/`, `/explorar`, `/atraccion/:id`, `/reservar/:id`, `/admin`
- [ ] Lighthouse Accessibility ≥ 95 en las 5 rutas
- [ ] Contraste del indicador de foco **≥ 3:1 también sobre superficies oscuras** (cierra el residual de **ACC-001**)
- [ ] Medir **ACC-026** sobre captura real del hero

### API y contrato
- [x] ✅ `npx @redocly/cli lint contracts/atracciones-openapi.yaml` en CI, sin errores (**API-003**, **API-004**)
- [x] ✅ `GET /atracciones/reservations?attraction_id=abc` → **400** (**API-001**)
- [ ] Comparar automáticamente los paths del contrato con los decoradores de Nest (**API-015**)

### Calidad
- [x] ✅ `npm run lint` → exit 0 en backend y frontend (**CAL-001**)
- [x] ✅ `npx tsc --noEmit` → exit 0 en backend (**CAL-003**)
- [x] ✅ `npm test` → 16 suites / 98 tests backend, 8 / 27 frontend (**CAL-002**)
- [x] ✅ CI con lint + `tsc` + test + build + migraciones + E2E + gitleaks (**CAL-004**)
- [ ] CI con CodeQL + `dependency-review` y `--audit-level=high` (**V2-CAL-01**)
- [ ] `backend/vercel.json` sin migraciones en `buildCommand` (**V2-OPS-01**)

---

## 14. Limitaciones de esta auditoría

1. **No se ejecutó la aplicación.** No hay servidor arrancado, ni base de datos levantada, ni E2E ejecutado localmente: el job `database` de CI requiere PostgreSQL 16 y no se reprodujo. Los resultados de `jest` son **unitarios**; el comportamiento end-to-end de migraciones, seed, RLS y concurrencia se infiere del código y de los tests que CI declara ejecutar, no de una ejecución observada.
2. **Los valores del panel de Vercel y de Supabase no son verificables desde el repositorio.** Por eso SEG-001, SEG-002, SEG-010 y parte de SEG-014 se marcan con acciones fuera del repositorio. Que los archivos `.env` se hayan borrado **no demuestra** que la contraseña se haya rotado.
3. **ACC-026 y el residual de ACC-001 requieren navegador.** El contraste sobre superficies oscuras y sobre fotografía depende del renderizado real; los ratios citados provienen de composición CSS, no de una captura.
4. **13 vulnerabilidades de dependencias no se auditaron una a una.** Se registró el recuento y la severidad agregada; no se verificó si alguna es alcanzable desde el código de la aplicación. Requieren `npm audit` detail + revisión manual.
5. **La cobertura del contrato frente a la implementación no se midió con exactitud** (API-015). Se compararon los 10 paths del contrato con los 9 controladores, pero sin un diff automático de operaciones.

---

## 15. Resumen final

**El proyecto transitó en esta iteración de «no puede entregarse» a «entregable con observaciones menores».** Los 7 P0 críticos de V1 están cerrados, y lo están por construcción, no por parche: la reescritura a **SQL-first con migraciones versionadas, checksum y *advisory lock*** eliminó de raíz la clase de fallos más difícil de corregir (esquema no reproducible), y la introducción de **sesiones server-side con recalculo de permisos desde `usuario_rol`** cerró simultáneamente SEG-004, SEG-009 y SEG-011 — tres vulnerabilidades que en V1 compartían la misma causa raíz: **confiar en el claim firmado del JWT**.

Los tres bloques que más mejoraron fueron **Concurrencia** (🔴 → 🟢, con *claiming* atómico de la clave de idempotencia y `FOR UPDATE` en cancel/confirm), **Calidad y DevOps** (🔴 → 🟢, con lint funcional, 98 tests, TypeScript estricto y CI con base de datos real) y **API/Contrato** (🟠 → 🟢, con el contrato y la implementación alineados en los 10 paths y los 7 scopes).

**No queda ningún P0 abierto.** De los 30 P1 de V1, 25 están cerrados y **5 siguen abiertos**: cuatro son residuales mitigados (ACC-001, SEG-010, SEG-013, SEG-014) y uno permanece intacto desde V1 (SEG-008, el bucket público). A ellos se añade **un único hallazgo nuevo de severidad P1**, `V2-SEG-01` (el seed *fail-open*), que es también la acción de mayor retorno: veinte minutos de código que cierran a la vez la puerta de entrada más obvia del sistema y buena parte del riesgo de CAL-009 y SEG-014. Con esa corrección, el proyecto quedaría sin ningún P1 abierto.

**La segunda observación de gestión es más importante que cualquier hallazgo individual:** los controles que protegen este código viven hoy en un único archivo de configuración (`env.validation.ts`) y en un único `if` (`SEED_ON_START`). V1 señaló que «sin CI, sin lint, sin tests, cada corrección puntual volverá a degradarse»; esa etapa está superada, pero el nuevo proceso combinado en `V2-CAL-01` — CodeQL, *dependency review* y subir el umbral de `npm audit` a `high` — es lo que convierte las 113 correcciones en algo sostenible. Sin SAST en un proyecto con SQL crudo a mano, la propiedad crítica del sistema — que todo parámetro está parametrizado — depende hoy de la disciplina de quien escribe, y no de una comprobación automática.
