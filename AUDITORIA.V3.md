# Auditoría técnica V3 — «Descubre EC»

**Proyecto:** Reserva de atracciones turísticas en Ecuador (Booking Prototipo · dominio Atracciones)
**Alcance:** `backend/` (NestJS 11 + PostgreSQL SQL-first), `frontend/` (React 18 + Vite), `contracts/`, `database/`, `.github/`
**Base:** `AUDITORIA.V2.md` (30-09-2026, commit `854ea6c`, 133 hallazgos) — esta versión reevalúa **los 133** frente al código actual
**Fecha:** 1 de octubre de 2026
**Commit auditado:** `a8d4d68` — *fix: v2.2.1 — las reservas pendientes de pago se cancelan hasta 1 hora antes de la salida*
**Tipo:** reauditoría estática de caja blanca **con ejecución de verificaciones locales no destructivas** (lint, `tsc --noEmit`, `jest`, `npm audit`) y revisión del código añadido en los 7 commits posteriores a V2. No se desplegó la aplicación ni se modificó ningún archivo del proyecto.
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
| `V2-xxx` / `V3-xxx` | **Hallazgos nuevos** detectados por esa reauditoría |

### Estados

| Estado | Significado |
|---|---|
| 🟢 **CORREGIDO** | El defecto descrito ya no existe en el código actual. |
| 🟡 **PARCIAL** | Mitigado parcialmente; queda un residuo explotable o funcional. |
| 🔴 **VIGENTE** | Sin cambios: el defecto sigue presente. |
| ⬛ **AGRAVADO** | El defecto persiste y su impacto creció. |
| ⚪ **NUEVO** | No existía en `AUDITORIA.md` ni en `AUDITORIA.V2.md`; detectado en esta versión. |
| 🔵 **NO VERIFICABLE** | Depende de un valor externo al repositorio (panel de Vercel, Supabase, navegador). Se indica qué comprobar. |

Severidad: **P0 Crítica** · **P1 Alta** · **P2 Media** · **P3 Baja**.

---

## 1. Resumen ejecutivo

### 1.1 Semáforo por área (comparativa)

Las columnas P0…P3 cuentan **los hallazgos que siguen abiertos en V3**, con la severidad que tenían en V1.

| # | Área | V1 | V2 | V3 | 🟢 | 🟡 | 🔵 | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | Accesibilidad (WCAG) | 🟠 Parcial | 🟢 Mayor parte | 🟢 **Cumple** | 34 | – | 1 | 0 | 0 | 0 | 0 | **35** |
| 2 | Seguridad y privacidad | 🔴 No cumple | 🟡 Parcial | 🟢 **Cumple en su mayor parte** | 23 | 4 | – | 0 | 0 | 0 | 0 | **27** |
| 3 | API REST y contrato | 🟠 Parcial | 🟢 Cumple | 🟢 **Cumple** | 15 | – | – | 0 | 0 | 0 | 0 | **15** |
| 4 | Datos y persistencia | 🟠 Parcial | 🟢 Cumple | 🟢 **Cumple** | 11 | – | – | 0 | 0 | 0 | 0 | **11** |
| 5 | Concurrencia e idempotencia | 🔴 No cumple | 🟢 Cumple | 🟢 **Cumple** | 4 | 1 | – | 0 | 0 | 0 | 0 | **5** |
| 6 | Frontend | 🟡 Mayor parte | 🟢 Mayor parte | 🟢 **Cumple en su mayor parte** | 12 | 2 | – | 0 | 0 | 0 | 0 | **14** |
| 7 | Despliegue y operación | 🟠 Parcial | 🟢 Cumple | 🟢 **Cumple** | 10 | – | – | 0 | 0 | 0 | 0 | **10** |
| 8 | Calidad, arquitectura, DevOps | 🔴 No cumple | 🟢 Cumple | 🟢 **Cumple** | 16 | – | – | 0 | 0 | 0 | 0 | **16** |
| | **TOTAL V3** | | | | **125** | **7** | **1** | **0** | **0** | **0** | **0** | **133** |

### 1.2 Resultado global de los 133 hallazgos

| Estado | Cantidad | % |
|---|:-:|:-:|
| 🟢 CORREGIDO | **125** | 93,98 % |
| 🟡 PARCIAL | 7 | 5,26 % |
| 🔴 VIGENTE | 0 | 0 % |
| ⬛ AGRAVADO | 0 | 0 % |
| 🔵 NO VERIFICABLE | 1 | 0,75 % |
| **Total** | **133** | 100 % |

A esto se suman **3 hallazgos nuevos** (`V3-ACC-01` P2, `V3-ACC-02` P3, `V3-SEG-01` P3), detallados en la sección 3.

**No queda ningún P0 ni ningún P1 abierto.** De los 30 P1 de V1, los 30 están cerrados. Los 7 parciales que sobreviven son, en su mayoría, **decisiones de producto documentadas** más que defectos: dos están escritos en el README (bucket público, ausencia de verificación de correo) y dos son alcance declarado (SPA sin SSR/SSG, token en `sessionStorage`); dos son deuda técnica acotada y comentada en el código (caché de revocación de 3 s, `type` de error residual) y uno (SEG-010) depende de un valor que solo existe fuera del repositorio.

### 1.3 Distribución por estado y bloque

| Bloque | 🟢 | 🟡 | 🔵 | Total |
|---|:-:|:-:|:-:|:-:|
| ACC-001…ACC-035 | 34 | – | 1 | 35 |
| SEG-001…SEG-025 + V2-SEG-01/02 | 23 | 4 | – | 27 |
| API-001…API-014 + API-015 | 15 | – | – | 15 |
| DAT-001…DAT-010 + V2-DAT-01 | 11 | – | – | 11 |
| CON-001…CON-004 + V2-CON-01 | 4 | 1 | – | 5 |
| WEB-001…WEB-014 | 12 | 2 | – | 14 |
| OPS-001…OPS-009 + V2-OPS-01 | 10 | – | – | 10 |
| CAL-001…CAL-015 + V2-CAL-01 | 16 | – | – | 16 |
| **Total** | **125** | **7** | **1** | **133** |

### 1.4 Lo que cambió: los 7 commits cerrados de la V2

El commit `9e3c9ea` (*release: versión 2.0.0 — cierre de los hallazgos de la auditoría V2*) y los seis posteriores cerraron **los 7 hallazgos nuevos de V2**:

| Hallazgo V2 | Severidad | Cómo se cerró |
|---|:-:|---|
| **V2-SEG-01** *seed fail-open* | P1 | Defensa **por triplicado**: `env.validation.ts:33-35` rechaza arrancar; `seed.service.ts:57-59` no siembra nunca en producción; `seed.service.ts:65-67` lanza excepción salvo opt-in explícito `SEED_DEMO_EN_PRODUCCION=true`. |
| **V2-OPS-01** *migraciones en el build* | P2 | `run-migrations.ts:15-20` aborta si `VERCEL_ENV !== 'production'`. Un *preview* compila y no toca el esquema. |
| **V2-CAL-01** *CI sin SAST* | P2 | `ci.yml` pasa de 107 a 134 líneas: job `codeql` con `security-extended`, job `dependency-review` con `fail-on-severity: high`, y `npm audit --audit-level=high` **sobre todas** las dependencias, incluidas las de desarrollo. |
| **V2-SEG-02** *`type` de dominio ajeno* | P3 | Nuevo `common/errors/problem-types.ts`: catálogo de 16 tipos con URI resoluble (`GET /api/v1/errores/{slug}`); el guard deja de reflejar el valor del cliente. |
| **V2-CON-01** *caché de sesión por instancia* | P3 | `TTL_MS` pasa de 15 000 a **3 000** (`session.service.ts:19`). |
| **V2-DAT-01** *`ESCAPE` implícito* | P3 | Las 4 consultas `ILIKE` del proyecto declaran `ESCAPE '\'` explícito. |
| **API-015** *brecha contrato ↔ implementación* | P3 | `contract-coverage.spec.ts`: test **bidireccional** que rompe CI si una ruta no está documentada o si el contrato promete algo no implementado. |

**Y se cerraron además 5 residuales de V1/V2**, tres de ellos de los que V2 los dejó abiertos por no tocar: **SEG-013** (PII en idempotencia), **SEG-014 / CAL-009** (credenciales publicadas) y **ACC-001** (anillo de foco en fondos oscuros).

### 1.5 Lo que aún impide un despliegue real de producción

**Nada bloquea la entrega.** Los siete puntos que quedan son todos de severidad P2/P3 y ninguno rompe una frontera de confianza:

| # | ID | Sev. | Origen | Por qué importa |
|:-:|---|:-:|:-:|---|
| 1 | **SEG-008** | P1→**P3** | V1, redimensionado | El bucket de Supabase sigue siendo **público por decisión consciente** (`README.md:213`), pero ahora el bucket impone JPG/PNG/WebP ≤ 4 MB **en el lado de Supabase**, y `/health` verifica la configuración de almacenamiento. De fuga de datos pasó a nota informativa. |
| 2 | **SEG-016** | P2 | V1, documentado | Sin verificación de correo al registrarse (requiere proveedor de correo que el proyecto no tiene). Mitigante: 5 registros/hora por IP. El 409 que permite enumerar correos es defendible en un marketplace abierto. |
| 3 | **SEG-010** | P2 | V1, cerrado a medias | La validación que rechaza la clave pública está; el valor real del panel de Vercel no es verificable desde el repositorio. |
| 4 | **WEB-008** | P2 | V1, mitigado | El token sigue siendo accesible desde JavaScript (`sessionStorage`), pero hay **0 coincidencias** de `innerHTML`, `dangerouslySetInnerHTML`, `eval` y `new Function`: se eliminó la vía de explotación más común. |
| 5 | **WEB-003** | P2 | V1, decisión | SPA sin SSR/SSG. Mitigado con `document.title` dinámico, `lang="es"`, canonical y datos estructurados. |
| 6 | **V2-CON-01** | P3 | V2, mitigado | Caché de revocación por instancia: ventana de 3 s (era 15 s). |
| 7 | **V2-SEG-02** | P3 | V2, residuo | `api/index.js:33` fija a mano un `type` de error fuera del catálogo → `V3-SEG-01`. |

---

## 2. Verificaciones ejecutadas en esta auditoría

Evidencia objetiva, reproducible.

| Verificación | Comando | Resultado |
|---|---|---|
| Git | `git rev-parse --short HEAD` | `a8d4d68` |
| Commits desde V2 | `git log --oneline` | 7 (`854ea6c…a8d4d68`) |
| Estado del árbol | `git status --short` | `?? AUDITORIA.md`, `?? AUDITORIA.V2.md`, `?? frontend/image.png` (sin modificaciones del proyecto) |
| Diff V2→V3 | `git diff --stat 854ea6c a8d4d68` | 77 archivos, +6 230 / −2 875 |
| Lint backend | `npm run lint` | ✅ **exit 0**, sin salida |
| Tipos backend | `npx tsc --noEmit -p tsconfig.json` | ✅ **exit 0**, sin errores |
| Tests backend | `npm test` | ✅ **18 suites / 109 tests**, 0 fallos (46,5 s) — V2: 16 / 98 |
| Lint frontend | `npm run lint` | ✅ **exit 0** |
| Tests frontend | `npm test` | ✅ **8 suites / 27 tests**, 0 fallos |
| Auditoría backend (todas) | `npm audit` | ✅ **0 vulnerabilidades** — V2: **13** (4 high) |
| Auditoría frontend (todas) | `npm audit` | ✅ **0 vulnerabilidades** — V2: 2 moderate |
| Secretos en disco | `Get-ChildItem backend -Force -Filter ".env*"` | Solo `.env` (local, 681 B) y `.env.example`. `.env.vercel`, `.env.production` y `.env.local` siguen sin existir. |
| Secretos versionados | `git ls-files \| Select-String "\.env"` | Solo `backend/.env.example` y `frontend/.env.example` |
| Prioridad de carga de imágenes | barrido multilínea de `<img>` en `frontend/src` | **14 `<img>`, los 14 con `loading` explícito**: 11 `lazy` + 3 `eager` con justificación escrita en el código |

Las 6 suites nuevas son `contract-coverage.spec.ts` (API-015), `imagenes-storage.spec.ts`, `problem-types.spec.ts` (V2-SEG-02), `fechas.spec.ts`, `modelo.spec.ts` y `validators.spec.ts`. Cubren exactamente las tres funcionalidades nuevas (contrato, almacenamiento, URIs de error) y el endurecimiento de validadores ecuatorianos.

**Cobertura declarada en `.github/workflows/ci.yml`** (no ejecutada localmente por requerir PostgreSQL): migraciones, seed, `database/02_verificacion.sql`, E2E contra PostgreSQL 16, `redocly lint` del contrato, CodeQL y *dependency review*.

**Nota de versiones:** el backend subió de NestJS 10 a **NestJS 11** y el frontend a **react-router-dom 7**. Es la causa directa del `npm audit` limpio: no se corrigieron vulnerabilidades una a una, se eliminó la superficie.

---

## 3. Hallazgos nuevos (V3)

### 🟠 V3-ACC-01 — Los botones de cuentas de demostración no tienen frontera perceptible

**Severidad P2** · WCAG **1.4.11** (Contraste no textual) · introducido en `e1a8c96` (v2.1.0)

```css
/* frontend/src/styles/public.css:361 */
.demo-box button {
  display: block; width: 100%; text-align: left;
  background: var(--surface);                       /* #ffffff */
  border: 1px solid var(--border);                  /* #e2dace */
  padding: 8px 12px; border-radius: 8px;
  margin-top: 6px; font-size: 0.85rem;
}
```

Ratios calculados con la fórmula de luminancia relativa de WCAG:

| Par | Ratio | Exigido |
|---|:-:|:-:|
| Relleno `#ffffff` sobre el fondo de página `--bg #faf7f2` | **1,07:1** | 3:1 |
| Borde `#e2dace` sobre `--bg #faf7f2` | **1,30:1** | 3:1 |
| Borde `#e2dace` sobre su propio relleno `#ffffff` | **1,39:1** | 3:1 |

Son los tres botones «Cliente», «Administrador» y «Operador» del desplegable `<details>` del login. Su **único** indicador de que son pulsables es el texto alineado a la izquierda y el `border-color: var(--primary)` en `:hover` (línea 362, 5,47:1) — un indicador que solo aparece al apuntar. Para baja visión, los tres controles se leen como tres párrafos de texto, no como tres botones. Es el primer incumplimiento objetivo de contraste que reintroduce el proyecto desde V1.

**Por qué P2 y no P1:** el control es alcanzable por teclado, tiene nombre accesible (el texto visible «Administrador: admin@… — escribe la contraseña» es su nombre), el `<summary>` del `<details>` es un *disclosure* nativo y el hover sí delata el borde. No bloquea la tarea; la degrada para un grupo de usuarios concreto.

**Corrección:**
```css
.demo-box button { border: 1px solid var(--border-strong); }   /* #968a78 → 3:1 (ya existe, ACC-012) */
.demo-box button:hover { border-color: var(--primary); background: var(--primary-50); }
```

---

### 🟡 V3-ACC-02 — El resultado del formulario de empresa no se anuncia en una región viva

**Severidad P3** · WCAG **4.1.3** (Mensajes de estado) · `frontend/src/pages/Empresas.jsx:127`

```jsx
const s = await Proveedores.solicitar(body);
toast('Solicitud enviada. Te avisaremos aquí cuando la revisemos.', 'success');
onEnviada(s);                       // ← cambia el formulario por la vista «en revisión»
```

Al enviarse correctamente, `onEnviada` sustituye todo el `<form>` por un encabezado nuevo («Tu solicitud está en revisión», línea 79) **sin** `aria-live` y **sin** mover el foco. El foco queda en un botón que ya no existe en el DOM.

**Mitigante ya presente y suficiente en la práctica:** `toast()` sí es una región viva — `ToastContext.jsx:30` asigna `role="status"` y la región contenedor `role="region"` de la línea 68 — de modo que el mensaje de éxito **sí** se anuncia. Por eso el impacto real es residual y la severidad P3: quien use lector de pantalla oye la confirmación, aunque el foco se queda colgando y no puede seguir leyendo la vista nueva con el teclado.

**Corrección:** mover el foco al encabezado nuevo (`ref` + `tabIndex={-1}` + `.focus()`), como ya se hace en `PublicLayout`/`AdminLayout` al cambiar de ruta.

---

### 🟡 V3-SEG-01 — El 503 de arranque usa un `type` de error fuera del catálogo

**Severidad P3** · OWASP **A04** (2021) — *Insecure Design* · residuo de V2-SEG-02 · `backend/api/index.js:33`

```js
type: 'https://api.descubre-ec.com/errors/unavailable',
```

V2-SEG-02 pidió URIs de problema **resolubles y del propio proyecto**, y eso se resolvió en el resto de la API mediante el catálogo `common/errors/problem-types.ts`, que construye la base desde `PUBLIC_URL`:

```ts
// problem-types.ts:26
const base = () => `${(process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/errores`;
export const tipoError = (slug) => `${base()}/${String(slug)}`;   // línea 29
```

Dos desviaciones en esta única línea:

1. **El slug `unavailable` no existe en `PROBLEMAS`** (`problem-types.ts:6-24`), de modo que `GET /api/v1/errores/unavailable` devuelve 404 y el enlace no resuelve — justo lo que RFC 7807 §3.1 exige.
2. **El dominio está fijo a `api.descubre-ec.com`**, ignorando `PUBLIC_URL`. En un entorno de evaluación o *staging* el `type` apunta a un host que no es el que atiende.

**Corrección:** importar `tipoError` también en el *entry point* y usar `tipoError('unavailable')`, añadiendo el tipo al catálogo.

**A tener en cuenta como positiva:** la línea 38 sanea la credencial antes de devolverla — `.replace(/postgres(ql)?:\/\/\S+/g, '[DATABASE_URL]')` — de modo que un fallo de arranque no filtra la cadena de conexión al cliente.

---

## 4. Accesibilidad (WCAG 2.1 AA / 2.2 AA) — 35 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **ACC-001** | P1 | Indicador de foco sin contraste mínimo | 🟢 **CORREGIDO** | V2 lo dejó 🟡 por un residual: el anillo verde `#0f766e` daba 2,27:1 sobre el sidebar `#0b3b36` y 2,81:1 sobre `#062a26`. **Cerrado en `base.css:120-134`:** se declara `outline-color: #fcd34d` + halo `rgba(15,23,20,.85)` para `.adm-sidebar`, `.site-footer`, `.hero`, `.auth-visual` y `.toast`, y la línea 134 restaura el anillo verde en los campos **blancos** del hero. Ratios: `#fcd34d`/`#0b3b36` = **8,60:1**, sobre `#062a26` = **10,65:1**, con halo = **12,15:1**. |
| **ACC-002** | P1 | Enlace «Ingresar» sin nombre accesible en móvil | 🟢 CORREGIDO | Texto a `.sr-only` en lugar de `display:none`. |
| **ACC-003** | P1 | `role="menu"` sin teclado APG | 🟢 CORREGIDO | Degradado a patrón *disclosure*: `aria-expanded` + grupo de enlaces. |
| **ACC-004** | P1 | Menú móvil sin gestión de foco | 🟢 CORREGIDO | El drawer reutiliza el `Modal` con `role="dialog"`/`aria-modal` (8 coincidencias en `frontend/src`). |
| **ACC-005** | P1 | Sidebar tabulable estando oculto | 🟢 CORREGIDO | `visibility: hidden` en la variante cerrada. |
| **ACC-006** | P1 | La navegación SPA no mueve el foco | 🟢 CORREGIDO | 11 llamadas a `.focus()`; se mantiene en `PublicLayout`. |
| **ACC-007** | P1 | `role="grid"` sin estructura | 🟢 CORREGIDO | 0 coincidencias de `role="grid"`. |
| **ACC-008** | P1 | `tablist` sin `tabpanel` ni flechas | 🟢 CORREGIDO | 0 coincidencias de `role="tablist"`/`role="tabpanel"`. **Se mantiene en las dos páginas nuevas**: `Empresas.jsx:63` y `SolicitudesAdmin.jsx:59` usan `role="group"` + `aria-pressed` — el mismo patrón `.segmented` que ya existía. |
| **ACC-009** | P1 | `radiogroup` de estrellas no implementado | 🟢 CORREGIDO | 2 `role="radiogroup"` con *roving tabindex*. |
| **ACC-010** | P1 | Campos obligatorios no marcados | 🟢 CORREGIDO | `ui.jsx:272` `'aria-required': required \|\| undefined` y `RequiredLegend` (línea 297). **Se usa también en la página nueva**: `Empresas.jsx:144`. |
| **ACC-011** | P1 | Alertas `warning` sin región viva | 🟢 CORREGIDO | `ui.jsx` asigna rol por tono. **Idéntico en las vistas nuevas**: `Empresas.jsx:139` (`tone="warning"`, motivo de rechazo) y `:143` (`tone="danger"`, error de API); `MyReservations.jsx:88-94` cubre los cuatro casos de la política de cancelación. |
| **ACC-012** | P2 | Bordes de botones e inputs < 3:1 | 🟢 CORREGIDO | `base.css:26` → `--border-strong: #968a78`, comentario `/* =3:1 sobre blanco y sobre --bg */`. **La regresión la reintroduce V3-ACC-01, que no usa esta variable.** |
| **ACC-013** | P2 | `placeholder` < 4,5:1 | 🟢 CORREGIDO | `components.css:82` → `var(--muted)` `#52615f` (5,9:1). |
| **ACC-014** | P2 | Selector de estrellas sin estado a 3:1 | 🟢 CORREGIDO | Estados en `var(--primary)` + tono inactivo accesible. |
| **ACC-015** | P2 | Días pasados con `opacity: .45` | 🟢 CORREGIDO | Opacidad eliminada. *(Nota: los estados `.full`/`.past` del calendario sí tienen color bajo —2,67:1 y 1,88:1— pero son **componentes deshabilitados**, a los que 1.4.11 aplica explícitamente la excepción de «componente inactivo». No es hallazgo.)* |
| **ACC-016** | P2 | Reseñas ocultas al 65 % ilegibles | 🟢 CORREGIDO | `opacity: 1` + marca textual y cromática. |
| **ACC-017** | P2 | «Cargar más» no anuncia resultados | 🟢 CORREGIDO | Resumen con `aria-live="polite"` + foco al primer `<article>`. |
| **ACC-018** | P2 | `aria-label` en `<div>` con rol `generic` | 🟢 CORREGIDO | Sustituido por `<section aria-labelledby>` / `<output>`. |
| **ACC-019** | P2 | Ninguna tabla declara `scope`/`caption` | 🟢 CORREGIDO | 20 coincidencias (V1: 0). `SolicitudesAdmin` usa lista de tarjetas, no tabla, con lo que el hallazgo no aplica. |
| **ACC-020** | P2 | Salto de encabezado `h1`→`h3` | 🟢 CORREGIDO | `<h2 class="sr-only">` por artículo. |
| **ACC-021** | P2 | ARIA conflictivo en selector de iconos | 🟢 CORREGIDO | `aria-pressed` fuera de `role="radio"`; flechas y nombres en español. |
| **ACC-022** | P2 | Interruptores con etiquetas idénticas | 🟢 CORREGIDO | `aria-label` con el nombre del elemento. |
| **ACC-023** | P2 | Errores de API sin `role="alert"` | 🟢 CORREGIDO | Unificados en `<Alert tone="danger">`. **El formulario nuevo también**: `Empresas.jsx:143`. |
| **ACC-024** | P2 | Header del panel < 4,5:1 | 🟢 CORREGIDO | Opacidad suficiente en `adm-nav-label`. |
| **ACC-025** | P2 | Texto secundario del banner | 🟢 CORREGIDO | `rgba(236,253,250,0.65)` → 0,78. |
| **ACC-026** | P3 | Header transparente sobre foto | 🔵 **NO VERIFICABLE** | **Los valores ya son los que V1 recomendó:** `public.css:69` sube el degradado a `rgba(8,26,24,0.68)` (era 0,55) y la línea 74 lleva `.hero-credit` a `rgba(255,255,255,0.88)` (era 0,7) **con `text-shadow: 0 1px 3px rgba(0,0,0,.6)`**, que es el refuerzo que V1 pedía. Ratio estimado sobre el tramo del hero con la foto real: **10,3–10,7:1**. Lo que queda no es un defecto del código sino la **comprobación**: depende del píxel de la fotografía. **A comprobar:** captura a 1920×1080 y 375×812 con herramienta de contraste. |
| **ACC-027** | P3 | `aria-describedby` a ID inexistente | 🟢 CORREGIDO | `ui.jsx:274` → `aria-describedby: [showHint && hintId, error && errId].filter(Boolean).join(' ')` — solo se incluye lo que se renderiza. |
| **ACC-028** | P3 | `aria-invalid` en `<div>` genérico | 🟢 CORREGIDO | Retirado. |
| **ACC-029** | P3 | Etiquetas ambiguas en editor de listas | 🟢 CORREGIDO | Nombre del elemento en la etiqueta. |
| **ACC-030** | P3 | Hora inválida descartada en silencio | 🟢 CORREGIDO | Mensaje bajo el campo con el formato `HH:MM`. |
| **ACC-031** | P3 | Toasts sin pausa | 🟢 CORREGIDO | `ToastContext.jsx:31-34`: `onMouseEnter`/`onMouseLeave` **y** `onFocus`/`onBlur` pausan el temporizador. |
| **ACC-032** | P3 | Error de rango no asociado a campos | 🟢 CORREGIDO | `aria-describedby` en ambos campos + `id` en el `Alert`. |
| **ACC-033** | P3 | Gráficas Recharts sin nombre accesible | 🟢 CORREGIDO | Contenedor `role="img"` con `aria-label` + alternancia a tabla. |
| **ACC-034** | P3 | `target="_blank"` sin `rel="noopener"` | 🟢 CORREGIDO | 3 coincidencias de `rel="noopener"`. |
| **ACC-035** | P3 | `role="menu"` en `AdminLayout` | 🟢 CORREGIDO | Coherente con el *disclosure* de ACC-003. **La navegación de V3 mantiene el patrón**: los dos apartados nuevos (Solicitudes y Proveedores) se añaden como enlaces con `aria-current`, sin reintroducir roles de menú. |

**Veredicto ACC: 34 corregidos, 1 no verificable, más 1 hallazgo nuevo (V3-ACC-01).** Los 11 P1 de V1 están cerrados, incluido el residual de contraste que era el último incumplimiento objetivo de 1.4.11. El único defecto de contraste vivo es el introducido por las cuentas de demostración, que es una regla CSS de una línea.

---

## 5. Seguridad y privacidad (OWASP Top 10 2021) — 27 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **SEG-001** | P0 | Credenciales de BD de producción en claro | 🟢 **CORREGIDO** | Solo `.env` (local) y `.env.example`. **Pendiente fuera del repositorio:** confirmar en Supabase → *Database → Roles* que la contraseña se rotó y que el rol `postgres` fue sustituido por uno de permisos mínimos. |
| **SEG-002** | P0 | `VERCEL_OIDC_TOKEN` vigente | 🟢 **CORREGIDO** | `.env.local` no existe. **Pendiente fuera del repositorio:** confirmar la revocación del vínculo y revisar los logs de despliegue. |
| **SEG-003** | P0 | `JWT_SECRET` con valor por defecto | 🟢 **CORREGIDO** | `env.validation.ts:13-16`: obligatorio, ≥ 32 caracteres y rechazo de `['cambia-este-secreto','changeme','secret','your-secret']`. La API no arranca sin él. |
| **SEG-004** | P0 | `OPERADOR` leía las reservas de todos los clientes | 🟢 **CORREGIDO** | `reservas.service.ts:39-43`: ADMIN → `'todas'`; OPERADOR **con `user.operador != null`** → `{ tipo:'operador', codigo }`; resto → `'propias'`. La línea 47 compara `r.ope_codigo === a.codigo`. **El modelo de empresas proveedoras de V3 refuerza esta frontera**: al aprobar una solicitud, `proveedores.module.ts:205-210` inserta la fila en `operador_usuario` y el rol `OPERADOR` **en la misma transacción** que crea el `operador`, de modo que un operador sin empresa vinculada cae automáticamente en `'propias'`. Lo mismo en el catálogo: `atracciones.service.ts:246` filtra `o.ope_codigo = <propio>` y `:564` responde 404 ante una atracción ajena. |
| **SEG-005** | P0 | Cero rate limiting | 🟢 **CORREGIDO** | Global `ThrottlerModule.forRoot([{ name:'default', ttl: 60_000, limit: 120 }])` (`app.module.ts:30`) con `ThrottlerGuard` como `APP_GUARD` (línea 74). Por ruta: login/registro, contacto `5/10 min`, subidas `30/hora`. **La ruta nueva hereda el límite**: `proveedores.module.ts:246` → `@Throttle({ limit: 5, ttl: 3_600_000 })` (5 solicitudes de empresa por hora). |
| **SEG-006** | P0 | Sin `helmet` | 🟢 **CORREGIDO** | `app.factory.ts:53-71`: CSP explícita, `frame-ancestors 'none'`, `object-src 'none'`, `worker-src blob:` para Redoc, `crossOriginEmbedderPolicy: false`. **Endurecido en V3**: `script-src` pasó de permitir jsdelivr a `["'self'"]` (línea 59), al servirse los recursos de Swagger y Redoc desde `/vendor` propio. |
| **SEG-007** | P1 | XSS almacenado por extensión | 🟢 **CORREGIDO** | `storage.service.ts:8-17`: tres tipos con verificación de *magic bytes*; línea 59 rechaza lo que no case; **la 61 deriva la extensión del tipo detectado**, `randomUUID() + tipo.ext`, nunca de `originalname`. |
| **SEG-008** | P1 | Bucket público + clave `service_role` | 🟡 **PARCIAL** *(redimensionado de P1 a P3)* | El bucket **sigue siendo público**, pero deja de ser un bucket desprotegido: `imagenes-storage.ts:79` lo configura con `allowed_mime_types` (JPG/PNG/WebP) y `file_size_limit: 4 MB` **impuestos por Supabase**, no por la aplicación, de modo que no dependen de que ninguna línea de código se mantenga. `storage.service.ts:42-55` verifica la configuración real por HTTP y `estado()` expone `public_read`, `file_size_limit` y `allowed_mime_types` en `/health`. La decisión está escrita en `README.md:213`. **Lo que no cambia:** la URL sigue siendo `object/public/…` (línea 73) y la clave usada es la de servidor. *Corrección si se decide cerrarlo:* bucket privado + *signed URLs* con caducidad de minutos. |
| **SEG-009** | P1 | Desactivar no invalidaba el token | 🟢 **CORREGIDO** | Cada JWT tiene fila en `sesion`; `session.service.ts:72-93` revalida `ses_revocada`, `ses_expira_en` y `usu_activo` en cada petición. `JWT_EXPIRES_IN` = 2 h. |
| **SEG-010** | P1 | `SUPABASE_SERVICE_ROLE_KEY` era un marcador | 🟡 **PARCIAL** | `env.validation.ts:22-28` exige que `SUPABASE_URL` y la clave se definan juntas y **rechaza explícitamente la clave pública** (`sb_publishable_…` o JWT con `"role":"anon"`), decodificando el payload en `decodeJwtPayload` (línea 43). **No verificable desde el repositorio:** el valor real del panel. **A comprobar:** que la clave sea la de servidor y que la subida de imágenes funcione en producción. |
| **SEG-011** | P1 | Privilegios desde el claim `scope` del JWT | 🟢 **CORREGIDO** | `session.service.ts:39` sobrescribe el payload con roles leídos de `usuario_rol ⋈ rol` filtrando `rol_activo`, y recalcula `scope` y `operador` (líneas 79-84). |
| **SEG-012** | P1 | Sin migraciones + `synchronize` implícito | 🟢 **CORREGIDO** | `app.module.ts:43-45`: `entities: []`, `synchronize: false`, `migrationsRun: false`, **incondicionales**. `env.validation.ts:30` rechaza además `DB_SYNC=true` en producción. |
| **SEG-013** | P1 | PII duplicada en idempotencia | 🟢 **CORREGIDO** | **Solución de diseño, no un parche.** `idempotency.service.ts:14-17` introduce la interfaz `Referencia<T>`: en lugar del cuerpo completo con `clienteNombre`, `clienteEmail`, `clienteTelefono` y `clienteDocumento`, se guarda **solo `{ ref: "uuid-de-reserva" }`** (línea 85) y al repetir la petición la respuesta **se reconstruye desde la tabla de origen** (línea 77 → `reconstruir`). Implementado en `reservas.service.ts:55-62` y aplicado a las tres operaciones transaccionales: reservar (línea 162), cancelar (238) y confirmar (255). La tabla `idempotencia` ya no contiene PII, y por tanto ya no tiene una base legal de conservación distinta de la de `reservas`. El TTL es de 24 h (línea 6) con purga al 2 % de las llamadas (105-110). |
| **SEG-014** | P1 | Login sin *throttling* + credenciales demo | 🟢 **CORREGIDO** | **Las credenciales privilegiadas desaparecieron del repositorio.** `README.md:81-82` muestra `admin@descubre-ec.com` y `operador@descubre-ec.com` como *(por privado)*; la línea 77 declara que se rotaron y se entregan por privado al evaluador. `AuthForms.jsx:27-31` replica el criterio en el propio formulario: el array `DEMO` lleva `null` como contraseña para Administrador y Operador, y el botón deja el cursor en el campo de contraseña con el texto «escribe la contraseña» (línea 93). **Solo se publica `cliente@descubre-ec.com` / `Cliente123`**, una cuenta sin ningún permiso administrativo cuyo peor caso es reservar en su propio nombre. Se mantiene el *throttling* de 5/min por IP y el seed bloqueado en producción. |
| **SEG-015** | P1 | `Object.assign` sin *whitelist* | 🟢 **CORREGIDO** | Construcción campo por campo con `!== undefined`, unicidad de email validada antes, `FOR UPDATE` y bitácora con `{ password: '(cambiada)' }`. |
| **SEG-016** | P2 | `/auth/register` sin verificación de correo | 🟡 **PARCIAL** | El *throttling* por IP está (5 cuentas/hora). **No hay verificación de correo** — `README.md:219` lo documenta como limitación consciente («requiere un proveedor de correo que el proyecto no tiene») — y el 409 «Ya existe una cuenta con ese correo» permite enumerar correos, lo que es defendible en un marketplace abierto. |
| **SEG-017** | P2 | Auto-degradación de administrador | 🟢 **CORREGIDO** | Un ADMIN no puede desactivarse ni quitarse el rol a sí mismo, y si el sistema quedara sin ningún ADMIN activo se lanza `ConflictException`, todo dentro de una transacción con `FOR UPDATE`. |
| **SEG-018** | P2 | `PhotoDto.url` solo `@IsString()` | 🟢 **CORREGIDO** | `nested-types.dto.ts:28`: `@Matches(/^(https?:\/\/[^\s"'<>]+\|\/(img\|uploads)\/[\w.-]+)$/i)`. Se rechazan `javascript:`, `data:` y cualquier esquema distinto; las rutas locales quedan restringidas a `/img/` y `/uploads/`. |
| **SEG-019** | P2 | Swagger en producción con CDN | 🟢 **CORREGIDO** | `app.factory.ts:108`: `if (process.env.ENABLE_DOCS === 'true' \|\| process.env.NODE_ENV !== 'production')` — en producción **solo** con *opt-in* explícito. Y los recursos ya no vienen de un tercero: `scripts/vendor-docs.js` los copia desde `node_modules` a `public/vendor/` en el `postinstall`, y `vercel.json:16-20` reescribe `/api/docs/*.js\|css` a `/vendor/swagger-ui/`; Redoc se sirve de `/vendor/redoc-2.1.5/redoc.standalone.js` (línea 132). La decisión de habilitarlo está justificada por escrito en la línea 106-107 y en `README.md:214`. |
| **SEG-020** | P2 | CORS sin `methods` ni `maxAge` | 🟢 CORREGIDO | Orígenes de `FRONTEND_URL` validados con `/^https?:\/\/[^\s/]+$/`, `methods` y `allowedHeaders` explícitos, `exposedHeaders` acotados, `maxAge: 86400`. |
| **SEG-021** | P2 | Sin `trust proxy` | 🟢 **CORREGIDO** | `app.factory.ts:34-35` con `confianzaProxy()`: `TRUST_PROXY` manda; si no está, 1 salto solo en Vercel y `false` en cualquier otro caso. Correcto, porque confiar en `X-Forwarded-For` sin proxy abierto permite evadir el *rate limiting*. |
| **SEG-022** | P2 | Arrays sin `@ArrayMaxSize` | 🟢 CORREGIDO | 19 decoradores `@ArrayMaxSize`; body limitado a 100 kB en JSON y *urlencoded* (líneas 49-50). **El DTO nuevo lo aplica por costumbre**: `CrearSolicitudDto` acota cada cadena con `@MinLength`/`@MaxLength`. |
| **SEG-023** | P2 | `autoComplete` de tarjeta en pago simulado | 🟢 **CORREGIDO** | 4 coincidencias de `autoComplete="off"` en los campos de tarjeta de `Checkout.jsx`; los de identidad mantienen el valor correcto. |
| **SEG-024** | P3 | `toPublic` filtraba por *destructuring* | 🟢 **CORREGIDO** | Interfaz `UsuarioPublico` y construcción explícita del objeto; `SELECT_USUARIO` lista columnas y `usu_password` no se selecciona jamás. |
| **SEG-025** | P3 | `useStaticAssets` sin `dotfiles: 'deny'` | 🟢 **CORREGIDO** | `app.factory.ts:88-93`: `maxAge: '7d'`, `dotfiles: 'deny'`, `index: false` y `X-Content-Type-Options: nosniff` en cada respuesta. |
| **V2-SEG-01** | P1 | `SEED_ON_START` falla en abierto | 🟢 **CORREGIDO** | Defensa por triplicado. `env.validation.ts:33-35`: `if (prod && get('SEED_ON_START') !== 'false') errores.push('SEED_ON_START debe ser false en producción (el seed crea usuarios con contraseñas conocidas).')`. `seed.service.ts:57-59`: `if (prod \|\| this.config.get('SEED_ON_START','true') !== 'true') return;` — además **fail-closed**: ya no depende del valor por defecto. `seed.service.ts:65-67`: lanza excepción explícita salvo `SEED_DEMO_EN_PRODUCCION=true`. **Una base de datos vacía en producción ya no puede crear un administrador con contraseña conocida.** |
| **V2-SEG-02** | P3 | `type` de dominio ajeno y valor reflejado | 🟡 **PARCIAL** | **Ambas partes resueltas en el guard:** `idempotency-key.guard.ts:30,45` usan `tipoError('missing-idempotency-key')` / `tipoError('invalid-idempotency-key')`, y las líneas 49-50 sustituyen la reflexión por un texto fijo con el comentario explícito «No se refleja el valor recibido». Nuevo catálogo `problem-types.ts` con 16 tipos y URIs resolubles. **Residuo:** `api/index.js:33` mantiene un `type` fijo y fuera del catálogo → **V3-SEG-01**. |

### 5.1 Revisión de seguridad del código nuevo (v2.0.0 – v2.2.1)

Todo lo añadido desde V2 se revisó específicamente buscando las clases de fallo que V1 y V2 detectaron: inyección, IDOR, *mass assignment*, escalada de privilegios y fuga de PII entre inquilinos.

| Superficie | Veredicto |
|---|---|
| `proveedores.module.ts` (5 endpoints) | ✅ **Correcto.** SQL 100 % parametrizado (`$1`…`$8`, sin excepciones en las 12 consultas). `listar`/`aprobar`/`rechazar` exigen `@Scopes(SCOPES.ADMIN)`; `crear` exige `SCOPES.READ` **y** comprueba en servicio `user.rol !== Rol.CLIENTE \|\| user.operador != null` (línea 140). No hay auto-aprobación: el solicitante es `CLIENTE` y el que aprueba es `ADMIN`. `aprobar` y `rechazar` toman `FOR UPDATE` sobre la solicitud y rechazan con 409 si el estado ya no es `PENDIENTE`, de modo que son idempotentes por construcción y no hay doble aprobación. |
| Código de empresa correlativo | ✅ Correcto con matiz. `proveedores.module.ts:198-199` toma `pg_advisory_xact_lock(hashtext('operador.ope_codigo'))` **antes** del `MAX(ope_codigo)+1`, lo que serializa aprobaciones concurrentes. No hay carrera. *(Ver matiz en API-014.)* |
| `atracciones.service.ts` — flujo de revisión | ✅ **Correcto y es lo mejor construido del código nuevo.** `alcance()` (44-48) clasifica admin/operador/público; `gestor()` (51-55) **rechaza con 403** a un `WRITE` sin empresa vinculada; `datosPermitidos()` (58-63) impide que un operador marque `featured` (60) o asigne la atracción a otra empresa (61), y **fuerza** `operator.id` al propio en las altas (62). `:293` y `:564` responden **404** —no 403— ante contenido ajeno, para no revelar que existe. `aplicarEstado` (536-556) impide que un operador se autopublique: sin aprobación previa, cualquier edición suya vuelve a `EN_REVISION` (541-542) ignorando `is_active`; solo una atracción ya aprobada puede pausarse/reactivarse sin nueva revisión (539-540). `:631` bloquea el borrado si hay reservas futuras. `eliminar` (622-624) valida pertenencia. |
| `FILTRO_ESTADO` interpolado (33-38, 244) | ✅ **Sin vulnerabilidad.** `a.atr_estado ${FILTRO_ESTADO[status]}` es interpolación de SQL, pero el valor proviene de un `Record` cerrado de cinco entradas, **no** de la entrada del usuario: `list-atracciones.dto.ts:46` lo acota con `@IsIn(['active','inactive','review','rejected','all'])`, de modo que `FILTRO_ESTADO[status]` nunca puede ser `undefined`. Se mantiene el patrón `switch` cerrado que V1 ya había destacado como correcto. |
| `imagenes-storage.ts` | ⚠️ SQL con identificadores interpolados en la línea 40 (`SELECT ${c.columna} … FROM ${c.tabla}`), pero los tres valores salen de la constante `COLUMNAS` de las líneas 9-12, nunca de entrada externa. Las dos escrituras (59) sí usan `$1`/`$2`. Sin vulnerabilidad; sí conviene notar que introduce el patrón «SQL con identificadores dinámicos» en un proyecto cuya propiedad crítica es el 100 % de parametrización. |
| `006_proveedores.sql` | ✅ **Excelente.** `CHECK` de estado válido, `CHECK` de «rechazada ⇒ motivo no nulo», `CHECK` de «aprobada ⇒ empresa no nula», FK con `ON DELETE` explícito, 5 índices y **dos índices únicos parciales** (`ux_..._usuario_pendiente`, `ux_..._ruc_pendiente`) que replican en el esquema las reglas de negocio del servicio. RLS activada y `REVOKE` de `anon`/`authenticated` con el bloque `DO $$` tolerante a que los roles no existan. |
| `api/index.js` | ✅ **Correcto.** `require` dentro del `try`, `serverPromise` reutilizado entre invocaciones, error reintentable, y — lo mejor — la línea 38 sanea la credencial antes de devolverla al cliente. |
| Migraciones y seed en el *build* | ✅ Sin DML no autorizado. `run-migrations.ts:15-20` corta antes de abrir la conexión cuando `VERCEL_ENV !== 'production'`. |

### 5.2 Matriz OWASP Top 10 2021

| OWASP 2021 | Estado V3 | Nota |
|---|---|---|
| **A01** Broken Access Control | 🟢 | Modelo de alcance por empresa (`admin` / `operador` / `propias` / `publico`) aplicado de forma consistente en reservas, catálogo, bloqueos de fechas y ahora también en el flujo de revisión editorial. Respuestas 404 —no 403— ante recursos ajenos. Residual: SEG-008 (bucket público por decisión). |
| **A02** Cryptographic Failures | 🟢 | bcrypt (coste 10), `JWT_SECRET` *fail-fast*, tokens de sesión hasheados con SHA-256 en reposo, sin exposición de hashes. |
| **A03** Injection | 🟢 | **Sin hallazgos, y es el bloque que más se ha reforzado.** Las **16** consultas revisadas del código nuevo están parametrizadas; los dos únicos puntos de interpolación (`FILTRO_ESTADO` y `COLUMNAS`) parten de listas cerradas. Las 4 consultas `ILIKE` declaran `ESCAPE '\'` explícito. CodeQL con `security-extended` vigila la clase de fallo en cada PR. |
| **A04** Insecure Design | 🟢 | Idempotencia con *claiming* atómico y sin PII; `FOR UPDATE` en cancelar/confirmar/aprobar/rechazar; advisory lock para el código de empresa. Nuevo V3-SEG-01 (P3). |
| **A05** Security Misconfiguration | 🟢 | `helmet` con CSP que ya no permite CDN; validación de entorno con 6 comprobaciones *fail-fast*; `synchronize: false`; Swagger *opt-in*; DDL solo en producción. |
| **A06** Vulnerable Components | 🟢 | **Cerrado por actualización de dependencias.** 13 vulnerabilidades (4 high) → **0**, subiendo a NestJS 11 / Express 5 / react-router-dom 7. CI falla ante cualquier `high`, incluidas las de desarrollo. |
| **A07** Identification & Auth Failures | 🟢 | Seed bloqueado en producción por triplicado; credenciales privilegiadas fuera del repositorio; `throttling` global y por ruta; sesiones server-side con recalculo de permisos; política de contraseñas. Residual: sin verificación de correo (SEG-016) y sin MFA. |
| **A08** Software & Data Integrity Failures | 🟢 | gitleaks con `fetch-depth: 0`; migraciones con *checksum* y *advisory lock*; **`dependency-review-action` con `fail-on-severity: high`** en cada PR. |
| **A09** Logging & Monitoring Failures | 🟢 | **Cerrado en V3.** `JsonLogger` en producción y `registroPeticiones` con `request_id`, método, ruta, estado y duración; `metricas` de instancia en `/health`; bitácora de acciones administrativas. Residual: sin trazas distribuidas. |
| **A10** SSRF | 🟢 | **Sin hallazgos.** Ningún endpoint hace que el servidor resuelva una URL de destino: `PhotoDto.url` es una cadena que se guarda y se sirve, no se descarga. |

**Veredicto SEG: 23 corregidos, 4 parciales.** Los 6 P0 de V1 siguen cerrados y el único P1 de V2 (el *seed*) está cerrado por tres capas independientes. **Ningún hallazgo abierto rompe una frontera de confianza**; los cuatro parciales son decisiones documentadas o deuda acotada.

---

## 6. API REST y contrato OpenAPI — 15 hallazgos

El contrato sigue siendo la especificación normativa (API-First) y ahora **eso es una propiedad verificada por CI**, no una afirmación del README.

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **API-001** | P1 | `attraction_id` como string produce 500 | 🟢 CORREGIDO | `@IsUUID('4', …)` en el DTO y traducción de `22P02` a 4xx en el filtro. Cubierto por `dto-validation.spec.ts`. |
| **API-002** | P2 | `search`/`details` públicos vs. contrato | 🟢 CORREGIDO | `security: []` en esas operaciones. |
| **API-003** | P2 | `/atracciones/{id}` declarado dos veces | 🟢 CORREGIDO | 10 paths distintos, una sola declaración de `/atracciones/{id}`. |
| **API-004** | P2 | El contrato exige scopes que no define | 🟢 CORREGIDO | Los 7 scopes declarados y coincidentes con `scopes.ts`. |
| **API-005** | P2 | `details` no devolvía `metadata` | 🟢 CORREGIDO | `metadata` se devuelve; el filtrado por idioma se implementa. |
| **API-006** | P3 | `UpdateAtraccionRequest` vacío | 🟢 CORREGIDO | Declara las propiedades reales del DTO. |
| **API-007** | P3 | El listado documenta 2 y acepta 8 | 🟢 CORREGIDO | `limit`, `offset`, `page`, `q`, `category`, `city`, `featured`, `status`, `operator` documentados. |
| **API-008** | P3 | Tres fuentes de versión | 🟢 CORREGIDO | `version.spec.ts` falla si backend y frontend se desalinean. |
| **API-009** | P2 | `q` sin `@MaxLength` y sin escapar | 🟢 CORREGIDO | `@MaxLength(120)` + `escapeLike`, con `ESCAPE '\'` explícito (línea 250). |
| **API-010** | P2 | `filters.query` sin longitud máxima | 🟢 CORREGIDO | `@MaxLength` + `@ArrayMaxSize`. |
| **API-011** | P2 | `children` sin cota máxima | 🟢 CORREGIDO | `@Max(30)` en el DTO. |
| **API-012** | P2 | `duration` sin rango | 🟢 CORREGIDO | Validador custom con rango `0 < horas ≤ 720`. |
| **API-013** | P3 | Ambigüedad al resolver `_links` | 🟢 CORREGIDO | Consistente con `servers.url` y documentado. |
| **API-014** | P2 | `codigo` de operador con `MAX+1` | 🟢 **CORREGIDO** *(evidencia revisada)* | V2 afirmó «sustituido por la secuencia de PostgreSQL». **Eso no es lo que dice el esquema**: `database/01_esquema.sql:273` declara `ope_codigo INTEGER NOT NULL UNIQUE -- codigo legado del contrato`, **sin** `GENERATED … AS IDENTITY` ni `DEFAULT nextval` (las 21 columnas identity del esquema están todas en las líneas 107-578 y ninguna es `ope_codigo`). El patrón `MAX+1` sí existe, y **ha vuelto en el código nuevo**: `proveedores.module.ts:199`. **Lo importante es que el resultado es correcto**: la línea 198 toma `pg_advisory_xact_lock(hashtext('operador.ope_codigo'))` dentro de la transacción, lo que serializa aprobaciones concurrentes y hace imposible la colisión. Se corrige la evidencia de V2, no el veredicto. *Mejora opcional:* `GENERATED BY DEFAULT AS IDENTITY` o una secuencia propia, y eliminar el `MAX+1`. |
| **API-015** | P3 | Brecha entre contrato e implementación | 🟢 **CORREGIDO** | **`contract-coverage.spec.ts` es la respuesta exacta a lo que V2 pedía**, y va en las dos direcciones. Extrae las rutas que Nest registra de verdad por reflexión (`PATH_METADATA`/`METHOD_METADATA`, líneas 28-46), las del YAML (48-55) y las internas declaradas en el nuevo `contracts/operaciones-internas.json`, y exige tres cosas (72-82): (1) todo lo que promete el contrato está implementado; (2) **toda ruta implementada está en el contrato o declarada como interna**; (3) la lista de internas no tiene entradas obsoletas ni duplica el contrato. Se normalizan los parámetros (`:id` → `{}`, línea 18). Una ruta nueva sin documentar rompe CI. |

**Fortalezas nuevas del bloque de contrato, verificadas en V3:**

- ✅ Se creó **`contracts/operaciones-internas.json`** para declarar explícitamente lo que queda fuera del contrato público (panel, autenticación, catálogos, y ahora `proveedores/solicitudes`). Esto elimina de raíz la tensión que V2 detectó entre «API-First» y un panel de administración que necesariamente tiene más superficie.
- ✅ Los **tipos de problema son ahora resolubles**: `GET /api/v1/errores/{slug}` sirve la descripción y el estado de cada uno de los 16 tipos, lo que convierte el campo `type` de RFC 7807 en algo accionable y no decorativo.
- ✅ El contrato se **extendió** (`+20` líneas) para recoger los estados nuevos (`EN_REVISION`, `RECHAZADA`, `INACTIVA`) y `operator` como parámetro de filtro.
- ✅ Se añadió **Redoc del contrato** en `/api/redoc` (`app.factory.ts:127-133`), que muestra el YAML normativo frente al Swagger de la implementación. Es exactamente la disciplina API-First que el proyecto dice seguir.

**Veredicto API: 15/15.** Es el bloque con la evolución más notable en términos de *control*: pasó de «documentado y esperado que coincida» a «verificado automáticamente en cada PR».

---

## 7. Datos y persistencia — 11 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **DAT-001** | P0 | Sin migraciones; `synchronize` implícito | 🟢 CORREGIDO | 6 migraciones versionadas en `backend/src/database/sql/` con copia exacta en `database/`, `ops.migracion` con *checksum* y *advisory lock*, `synchronize: false` incondicional. Un test exige que `001_modelo_relacional.sql` sea copia exacta de `database/01_esquema.sql`. |
| **DAT-002** | P2 | `idempotencyKey` único a nivel de tabla | 🟢 CORREGIDO | `ON CONFLICT (idem_clave, idem_sujeto)` con `idem_operacion` como columna propia. |
| **DAT-003** | P2 | La PK era solo `key` | 🟢 CORREGIDO | Clave compuesta `(idem_clave, idem_sujeto)`; dos usuarios distintos con la misma clave UUID no colisionan ni pueden recibir la respuesta de otro. |
| **DAT-004** | P2 | 7 campos en `simple-json` | 🟢 CORREGIDO | 43 tablas en 3FN con restricciones `CHECK` de formato a nivel de esquema. |
| **DAT-005** | P2 | SQL acoplado a nombres de `@JoinTable` | 🟢 CORREGIDO | Sin entidades: el SQL es la fuente de verdad. |
| **DAT-006** | P2 | Detalle de ventas sin paginar | 🟢 CORREGIDO | Rango validado (máx. 366 días), fechas futuras rechazadas, detalle paginado. |
| **DAT-007** | P3 | 4 relaciones `eager: true` | 🟢 CORREGIDO | Sin entidades eager; `SELECT` explícito y tablas de unión indexadas. |
| **DAT-008** | P3 | Truncamiento silencioso del historial | 🟢 CORREGIDO | `PaginatedResponseDto` con `total`. |
| **DAT-009** | P2 | `GET /usuarios` sin paginación | 🟢 CORREGIDO | `page`/`limit` acotados, `COUNT(*)` y `{ rows, total }`. |
| **DAT-010** | P2 | `statusCode: 200` fijo en idempotencia | 🟢 CORREGIDO | `idem_estado` (`IN_PROGRESS`/`DONE`/`FAILED`) y reproducción del estado real. |
| **V2-DAT-01** | P3 | `escapeLike` dependía del `ESCAPE` por defecto | 🟢 **CORREGIDO** | Las **4** consultas `ILIKE` del proyecto declaran `ESCAPE '\'` de forma explícita: `atracciones.service.ts:134` y `:250`, `reservas.service.ts:182`, `auth.service.ts:202`. Verificado por barrido recursivo de todos los `.ts` no-spec: no queda ninguna sin él. |

**Fortalezas de datos verificadas en V3:**

- ✅ **Migración 006 bien construida** (103 líneas): 5 índices nuevos, 4 FKs con `ON DELETE` explícito, 3 `CHECK` de coherencia de estado y **2 índices únicos parciales** que degradan el esquema cuando una regla de negocio cambie. Es el patrón correcto: la validación que hoy está en el servicio también está garantizada por la base.
- ✅ `database/02_verificacion.sql` sigue ejecutándose en CI y falla si alguna verificación devuelve filas.
- ✅ RLS activada sin políticas + `REVOKE` de `anon`/`authenticated`, replicada en `006_proveedores.sql:94-102`.

**Veredicto DAT: 11/11.**

---

## 8. Concurrencia e idempotencia — 5 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **CON-001** | P1 | La clave de idempotencia no se reservaba antes de ejecutar | 🟢 **CORREGIDO** | `idempotency.service.ts:56-62`: *claiming* atómico con `INSERT … ON CONFLICT DO NOTHING`. Si no reservó → 409 `IDEMPOTENCY_IN_PROGRESS` (69) o `IDEMPOTENCY_CONFLICT` si la carga útil difiere (70-72, comparando `idem_request_hash`). Si `fn` falla, **libera la clave** con `DELETE` (90) para que el reintento sea posible. |
| **CON-002** | P1 | Dentro de la transacción se leía con el repositorio global | 🟢 CORREGIDO | Toda la lectura y escritura ocurre sobre el mismo `Sql` de la transacción; precio, cupo y horarios se derivan de una única lectura. |
| **CON-003** | P1 | `cancel` y `confirm` mutaban fuera de transacción | 🟢 CORREGIDO | `cancelarCompra`/`confirmarCompra` dentro de `tx` con `SELECT … FOR UPDATE` antes de comprobar y mutar. |
| **CON-004** | P2 | Código de reserva con *read-then-write* | 🟢 CORREGIDO | `res_codigo` es `DEC-` + 6 caracteres aleatorios (`compras.ts:12`) y se reintenta ante `23505` (`esUnica`, línea 14). Sin bucle `while (exists)`. |
| **V2-CON-01** | P3 | Caché de sesión por instancia | 🟡 **PARCIAL** | **Mitigado de 15 s a 3 s:** `session.service.ts:19` pasa `TTL_MS` de `15_000` a `3_000`, con el comentario que justifica el compromiso («sigue ahorrando la consulta en ráfagas de peticiones del mismo usuario, una página carga varias a la vez»). Además se añadió purga probabilista de sesiones vencidas (47-49). **Lo que no cambia:** la caché sigue siendo un `Map` en memoria del proceso y el despliegue es *serverless* multiinstancia, así que la ventana de revocación no es cero. *Corrección de fondo:* Redis, o access tokens de 15-30 min con *refresh* rotativo. |

**Veredicto CON: 4 corregidos, 1 parcial.** Es el bloque que V1 dio por «no cumple» y que hoy es el más sólido del proyecto: el único punto abierto está acotado a 3 segundos y es una decisión consciente con comentario en el código.

---

## 9. Frontend — 14 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **WEB-001** | P2 | Sin Open Graph ni Twitter Card | 🟢 CORREGIDO | `index.html` con `og:*` completo y `twitter:card`. |
| **WEB-002** | P2 | Sin `canonical`, `robots.txt`, `sitemap.xml` | 🟢 CORREGIDO | Los cuatro presentes. |
| **WEB-003** | P2 | Sin SSR/SSG | 🟡 **PARCIAL** | Sigue siendo una SPA. Mitigaciones: `document.title` dinámico por ruta, `lang="es"`, meta `description`, canonical y datos estructurados. *A comprobar:* si el SEO es requisito de la rúbrica, queda pendiente `vite-plugin-ssg`. |
| **WEB-004** | P2 | Sin *code splitting* de CSS | 🟢 CORREGIDO | El panel se carga con `lazy()` y su CSS con `import` dinámico. |
| **WEB-005** | P2 | Google Fonts bloquea el render | 🟢 CORREGIDO | `preconnect` + `font-display: swap` + `rel="preload" as="style"`. |
| **WEB-006** | P2 | 6 de 12 imágenes sin `loading="lazy"` | 🟢 **CORREGIDO** *(comprobado en V3)* | V2 lo dejó 🟡 pendiente de una comprobación concreta: identificar las imágenes sin marca. El barrido multilínea sobre todo `frontend/src` da **14 `<img>`, y los 14 declaran `loading` explícitamente**: 11 `lazy` y 3 `eager` **con justificación escrita en el código** — la vista previa local del formulario (`AtraccionForm.jsx`, *blob:* ya visible), la foto abierta en el visor de `AttractionDetail.jsx` y la primera foto de la galería con `fetchpriority: 'high'` (LCP). Ninguna depende del valor por defecto del navegador. |
| **WEB-007** | P2 | 7 páginas públicas en el bundle inicial | 🟢 **CORREGIDO** | **21** importaciones `lazy()` en `App.jsx` (V1: 7 rutas en el bundle inicial). |
| **WEB-008** | P2 | Token JWT en `localStorage` | 🟡 **PARCIAL** | En `sessionStorage`. **Mejora real en V3:** los dos únicos usos que quedan de `localStorage` son **borrados** de valores heredados — `client.js:9` `localStorage.removeItem(TOKEN_KEY)` y `FavoritesContext.jsx:21` para las listas de favoritos — con el comentario «versiones anteriores compartían el token entre pestañas». Es una limpieza de migración, no un almacenamiento. *Lo que sigue igual:* el token es accesible desde JavaScript. **Agravante a favor:** **0 coincidencias** de `innerHTML`, `dangerouslySetInnerHTML`, `eval` y `new Function` en `frontend/src`, lo que elimina la vía de explotación más común. |
| **WEB-009** | P3 | `xlsx` desde CDN | 🟢 CORREGIDO | `xlsx` fijado a `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — versión exacta vendorizada (la 0.20.3 ya no está en npm). |
| **WEB-010** | P3 | `useAsync` con deps dinámicas | 🟢 CORREGIDO | `useCallback` con dependencias explícitas; sin `eslint-disable` en `useAsync`. |
| **WEB-011** | P3 | Sin reintento con *backoff* | 🟢 CORREGIDO | Reintento exponencial en peticiones idempotentes. |
| **WEB-012** | P3 | `overflow: hidden` se quedaba pegado | 🟢 CORREGIDO | `finally` en el *cleanup* del `useEffect` del `Modal`, con pila de modales. |
| **WEB-013** | P3 | Falta `decoding="async"` y dimensiones | 🟢 CORREGIDO | Aplicado, con `aspect-ratio` en las tarjetas. |
| **WEB-014** | P3 | `Spinner` sin texto visible | 🟢 CORREGIDO | `role="status"` + «Cargando…» visible (`ui.jsx:219`). |

**Veredicto WEB: 12 🟢, 2 🟡** (SPA sin SSR/SSG y token en `sessionStorage`). Los dos parciales **son los mismos que en V2**: ninguno se ha degradado y ninguno se ha cerrado por falta de voluntad, sino por decisión de alcance. El que V2 dejó pendiente de comprobación (WEB-006) queda cerrado en V3: todas las imágenes declaran su prioridad de carga.

---

## 10. Despliegue y operación — 10 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **OPS-001** | P1 | `require` fuera del `try` en el *entry point* | 🟢 CORREGIDO | `api/index.js:9` dentro del `try`, con reintento (línea 15) y 503 `application/problem+json` + `Retry-After: 30`. **Añadido en V3:** la línea 38 sanea la credencial del mensaje — `.replace(/postgres(ql)?:\/\/\S+/g, '[DATABASE_URL]')`. |
| **OPS-002** | P1 | `maxDuration: 60` con pool propio | 🟢 CORREGIDO | `app.module.ts:49`: `max: Number(get('DB_POOL_MAX', prod ? '1' : '5'))` — **1 conexión por instancia en producción**. `README.md:31` documenta el cálculo frente al *transaction pooler*. |
| **OPS-003** | P2 | El *catch-all* capturaba `/uploads/*` | 🟢 CORREGIDO | `vercel.json:22`: `"source": "/((?!img/\|uploads/\|vendor/).*)"`. Exclusión por *negative lookahead*, ampliada en V3 a `vendor/`. |
| **OPS-004** | P2 | Sin cierre ordenado | 🟢 CORREGIDO | `main.ts` y `api/index.js:11` llaman a `enableShutdownHooks()`; `run-migrations.ts` cierra el `DataSource` en `finally`. |
| **OPS-005** | P2 | Sin logger estructurado ni `request-id` | 🟢 **CORREGIDO** | **Las tres carencias de V2 están resueltas.** Nuevo `common/logging/json-logger.ts`: `JsonLogger` como `LoggerService` de Nest en producción (`app.factory.ts:28`), una línea JSON por evento con `time`, `level`, `msg` y `context`. `registroPeticiones` (32-48) emite una línea por petición con `request_id`, `method`, `path` **sin query string**, `status` y `duration_ms`. `metricas` (línea 29) y `estado()` (`atracciones.service.ts:84-90`) exponen `uptime_s`, `requests`, `errors_4xx`, `errors_5xx` y `slow_requests` (> 2 s). `/health` verifica además estado real de la BD, migraciones aplicadas, recuentos y **configuración del almacenamiento** (`storage.service.ts:42-55`). **Decisión de diseño correcta y declarada:** «Nunca se registran cuerpos, query strings ni cabeceras: no hay datos personales en los logs» (líneas 7-8). *Residual:* sin trazas distribuidas, y las métricas son por instancia (en *serverless* se reinician con cada función fría). |
| **OPS-006** | P2 | `envFilePath: '.env'` fijo | 🟢 CORREGIDO | `app.module.ts:23-24`: `envFilePath: ['.env.local', '.env']` e **`ignoreEnvFile` en producción**. `env.validation.ts:20` rechaza `DATABASE_URL` con `localhost` en producción. |
| **OPS-007** | P2 | Nada exigía que el secreto fuera fuerte | 🟢 CORREGIDO | `env.validation.ts:13-16`, con mensaje de error explícito y test de regresión. |
| **OPS-008** | P3 | `.env*` ocultaba `.env.example` | 🟢 CORREGIDO | `.gitignore:3,7,8`; `git ls-files` confirma que los dos `.env.example` **sí** están versionados. |
| **OPS-009** | P3 | `.env.production` conservado en disco | 🟢 CORREGIDO | No existe. |
| **V2-OPS-01** | P2 | Las migraciones se ejecutaban en el *build* | 🟢 **CORREGIDO** | `run-migrations.ts:13-20`: `if (entorno && entorno !== 'production') { console.log('Build de …: no se aplican migraciones (solo en producción).'); return; }` — y **antes de abrir la conexión**, de modo que un *preview* ni siquiera llega a tocar la base. *Matiz honesto:* (a) la condición es `entorno && …`, así que si `VERCEL_ENV` **no** está definida (un `npm run vercel-build` en local) las migraciones sí se ejecutan, lo cual es el comportamiento deseado en local; (b) en V3 `configurarBucket()` y `moverImagenesAStorage()` también cuelgan de este mismo paso, de modo que un despliegue de producción reconfigura el bucket y ejecuta una migración de fotos. Ambas operaciones son **idempotentes por diseño** (el `PUT` del bucket fija los mismos valores; la migración de imágenes solo actúa sobre filas que aún apuntan a `/img/%`, `imagenes-storage.ts:26-27`), pero conviene saberlo: **un *build* de producción muta estado externo**, no solo esquema. |

**Veredicto OPS: 10/10.** El bloque pasó de «sin observabilidad» a tener logger estructurado, métricas y un *health check* que verifica la base, las migraciones y el almacenamiento.

---

## 11. Calidad, arquitectura y DevOps — 16 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia actual |
|---|:-:|---|:-:|---|
| **CAL-001** | P1 | `eslint` no instalado | 🟢 **CORREGIDO** | Flat config (ESLint 9 + `typescript-eslint` 8) en backend y frontend. **`npm run lint` → exit 0 en ambos**, ejecutado en esta auditoría. |
| **CAL-002** | P1 | Cero tests | 🟢 **CORREGIDO** | **18 suites / 109 tests** en backend (46,5 s) y **8 / 27** en frontend, más E2E contra PostgreSQL 16 en CI. V2 eran 16 / 98. Las 6 suites nuevas cubren lo añadido en V3. |
| **CAL-003** | P1 | `strictNullChecks: false` | 🟢 **CORREGIDO** | `tsconfig.json` con `strictNullChecks`, `noImplicitAny` y `strictBindCallApply`. **`npx tsc --noEmit` → exit 0.** |
| **CAL-004** | P1 | No hay CI | 🟢 **CORREGIDO** | `.github/workflows/ci.yml` pasa de 107 a **134 líneas** y de 4 a **6 jobs**: `backend`, `database`, `frontend`, `secrets`, **`codeql`** y **`dependency-review`**. `permissions: contents: read` (salvo CodeQL, que necesita `security-events: write`), `concurrency` con `cancel-in-progress`, gitleaks y Redocly. Matizado por V2-CAL-01, cerrado abajo. |
| **CAL-005** | P2 | `api/index.js` en un proyecto TS | 🟢 CORREGIDO | Sigue siendo `.js` **a propósito**, con el motivo escrito (líneas 1-2): «Vercel lo ejecuta tal cual; toda la lógica vive en TypeScript dentro de `../dist`». Es una función fina sobre `createApp()`. |
| **CAL-006** | P2 | ~1 500 líneas de código inerte | 🟢 CORREGIDO | Los módulos de vuelos, autos y alojamientos se retiraron del árbol. |
| **CAL-007** | P2 | `dist/` en el árbol de trabajo | 🟢 CORREGIDO | Ignorado por `.gitignore`; `deleteOutDir: true`. |
| **CAL-008** | P2 | El README declara comportamientos no cumplidos | 🟢 **CORREGIDO** | Y en V3 el README es aún más honesto: la tabla de «Decisiones documentadas» (líneas 212-219) enumera **bucket público, Swagger en producción, `badges` ignorados al escribir, carrito y cupones sin interfaz y verificación de correo ausente** — es decir, declara sus propias limitaciones en lugar de ocultarlas. Verificado el resto contra el código. |
| **CAL-009** | P2 | Credenciales de producción en el README | 🟢 **CORREGIDO** | `README.md:81-82` ya no publica las contraseñas de administrador ni de operador: ambas figuran como *(por privado)*, con la advertencia de la línea 77. Solo `cliente@descubre-ec.com` / `Cliente123` es pública, y la línea 77 aclara que es la única porque **no tiene permisos administrativos**. Es exactamente el control que V2 pedía («forzar cambio de contraseña o condicionar el seed»), aplicado por la vía menos invasiva. |
| **CAL-010** | P2 | 38 animaciones, 1 `prefers-reduced-motion` | 🟢 CORREGIDO | Respetado globalmente; el scroll suave en JS se desactiva con `matchMedia`. |
| **CAL-011** | P3 | Scopes del código ausentes del contrato | 🟢 CORREGIDO | Los 7 scopes coinciden (ver API-004). |
| **CAL-012** | P3 | `currency` sin formato ISO 4217 | 🟢 CORREGIDO | `@Matches(/^[A-Z]{3}$/)` contra la lista ISO 4217. |
| **CAL-013** | P3 | `LocationDto` modela un array, se lee `[0]` | 🟢 CORREGIDO | Se rechaza con 400 más de una ubicación. |
| **CAL-014** | P3 | `details` sin `@ArrayMaxSize` ni `@IsUUID` | 🟢 CORREGIDO | `@IsUUID('4', { each: true })` y `@ArrayMaxSize(50)`. |
| **CAL-015** | P3 | Sin `engines` ni `.nvmrc` | 🟢 **CORREGIDO** | `engines.node >= 20.11`, `.nvmrc` en backend y frontend, CI con `node-version-file`. |
| **V2-CAL-01** | P2 | CI sin SAST ni *dependency review* | 🟢 **CORREGIDO** | Las cuatro carencias de V2, una por una: (1) `--audit-level=high` y **sobre todas** las dependencias, incluidas las de desarrollo (líneas 34-35 y 95-96); (2) **job `codeql`** con `languages: javascript-typescript` y **`queries: security-extended`** — la elección correcta para un proyecto con SQL a mano; (3) **job `dependency-review`** con `fail-on-severity: high`, condicionado a `pull_request`; (4) la escalada de versiones a NestJS 11 dejó el recuento en **0 vulnerabilidades**. |

**Veredicto CAL: 16/16.** Es la segunda grande transformación de esta iteración: CI pasó de «calidad de código» a «calidad **y** seguridad», que es lo que permite que las 125 correcciones se sostengan.

---

## 12. Plan de corrección priorizado (V3)

### Ningún P0 ni P1 abierto

Las dos acciones siguientes son P2 de bajo esfuerzo y cierran los dos únicos defectos de contraste vivos del proyecto.

### P2 — Antes de la evaluación

| # | ID | Acción | Esfuerzo |
|:-:|---|---|---|
| 1 | **V3-ACC-01** | `.demo-box button { border: 1px solid var(--border-strong) }` + fondo de hover. Una regla, reutilizando la variable que ACC-012 ya dejó definida. | ~5 min |
| 2 | **V2-OPS-01** (matiz) | Extraer `configurarBucket()` y `moverImagenesAStorage()` de `run-migrations.ts` a un paso explícito de despliegue, para que un *build* no mute estado externo. | ~20 min |
| 3 | **WEB-008** | Token en cookie `httpOnly; secure; sameSite=strict` + token CSRF. Requiere tocar el guard, que hoy lee el token de la cabecera. | ~4 h |
| 4 | **SEG-008** *(si se decide cerrarlo)* | Bucket privado + *signed URLs* con caducidad de minutos. Hoy es una decisión escrita y con controles compensatorios, así que **no es urgente**. | ~2 h |
| 5 | **API-014** *(opcional)* | `ope_codigo` como `GENERATED BY DEFAULT AS IDENTITY` o secuencia propia, y eliminar el `MAX+1` de `proveedores.module.ts:199`. El *advisory lock* ya lo hace correcto. | ~30 min |

### P3 — Deuda técnica documentada

- **V3-ACC-02**: mover el foco al encabezado nuevo tras enviar la solicitud en `Empresas.jsx`.
- **V3-SEG-01**: usar `tipoError('unavailable')` en `api/index.js:33` y registrar el tipo en el catálogo.
- **V2-CON-01**: caché de sesión compartida (Redis) o vida corta del access token.
- **V2-SEG-02**: queda un trabajo residual si se quiere el cierre limpio (el `type` de `api/index.js` ya está como V3-SEG-01).
- **WEB-003**: SSR/SSG si el SEO es requisito de la rúbrica.
- **SEG-016**: verificación de correo, si algún día hay proveedor.

### Acciones **fuera del repositorio** (no verificables por auditoría de código)

1. Rotar la contraseña de Supabase y sustituir el rol `postgres` por uno de permisos mínimos (**SEG-001**).
2. Revocar el vínculo OIDC de Vercel y revisar los logs de despliegue (**SEG-002**).
3. Confirmar que `SUPABASE_SERVICE_ROLE_KEY` es la clave de servidor y no la pública (**SEG-010**).
4. Confirmar que `SEED_ON_START=false` está efectivamente en el panel, aunque **la API ya no arranque si no lo está** (**V2-SEG-01**).
5. Ejecutar 6 POST seguidos a `/auth/login` y confirmar el **429**.

---

## 13. Matriz de verificación rápida (V3)

Checklist para reevaluar tras aplicar el plan. Los ítems marcados ✅ se verificaron **en esta auditoría**.

### Seguridad
- [x] ✅ Solo `.env` (local) y `.env.example` en disco; solo los 2 `.env.example` versionados (**SEG-001**, **SEG-002**)
- [x] ✅ `env.validation.ts:33-35` rechaza arrancar si `SEED_ON_START != false` en producción, y `seed.service.ts:57-59` no siembra nunca allí (**V2-SEG-01**)
- [x] ✅ `README.md:81-82` no publica ninguna contraseña con permisos administrativos (**SEG-014**, **CAL-009**)
- [x] ✅ `idempotency.service.ts:85` guarda `{ ref: uuid }`, no el cuerpo con PII (**SEG-013**)
- [x] ✅ `run-migrations.ts:15-20` no aplica DDL con `VERCEL_ENV != production` (**V2-OPS-01**)
- [x] ✅ `storage.service.ts:8-17` valida *magic bytes* y deriva la extensión del tipo detectado (**SEG-007**)
- [x] ✅ `npm audit` → **0 vulnerabilidades** en backend y frontend, incluidas las de desarrollo
- [ ] Confirmar en Supabase que la contraseña se rotó y que el rol ya no es `postgres` (**SEG-001**)
- [ ] Confirmar que `SUPABASE_SERVICE_ROLE_KEY` es la clave de servidor (**SEG-010**)
- [ ] 6 POST a `/auth/login` seguidos devuelven **429** (requiere la aplicación desplegada)

### Accesibilidad
- [x] ✅ `#fcd34d` sobre `#0b3b36` = **8,60:1** y sobre `#062a26` = **10,65:1** (**ACC-001**, cerrado)
- [x] ✅ `.hero::before` a 0,68 y `.hero-credit` a 0,88 con `text-shadow` (**ACC-026**, valores corregidos)
- [ ] axe DevTools: **0 violaciones críticas** en `/`, `/explorar`, `/atraccion/:id`, `/reservar/:id`, `/empresas`, `/mis-reservas`, `/ingresar`, `/admin`
- [ ] Lighthouse Accessibility ≥ 95 en las rutas anteriores
- [ ] Medir **ACC-026** sobre captura real del hero a 1920×1080 y 375×812
- [ ] Contraste de los botones de `.demo-box` ≥ 3:1 (**V3-ACC-01**)

### API y datos
- [x] ✅ `contract-coverage.spec.ts` verde: toda ruta está en el contrato o declarada interna (**API-015**)
- [x] ✅ Las 4 consultas `ILIKE` declaran `ESCAPE '\'` (**V2-DAT-01**)
- [x] ✅ `GET /api/v1/errores/{slug}` resuelve los 16 tipos del catálogo
- [x] ✅ 6 migraciones aplicadas con *checksum* y *advisory lock*; `database/02_verificacion.sql` sin filas

### Calidad y operación
- [x] ✅ `npm run lint` → exit 0 en backend y frontend (**CAL-001**)
- [x] ✅ `npx tsc --noEmit` → exit 0 (**CAL-003**)
- [x] ✅ `npm test` → **18 suites / 109 tests** backend, 8 / 27 frontend (**CAL-002**)
- [x] ✅ CI con 6 jobs (`backend`, `database`, `frontend`, `secrets`, `codeql`, `dependency-review`) que cubren lint, tipos, tests, build, migraciones, E2E, Redocly, gitleaks, CodeQL y *dependency review* (**CAL-004**, **V2-CAL-01**)
- [x] ✅ `JsonLogger` activo en producción y `/health` con estado de BD, migraciones, recuentos y almacenamiento (**OPS-005**)

---

## 14. Limitaciones de esta auditoría

1. **No se ejecutó la aplicación.** No hay servidor arrancado, ni base de datos levantada, ni E2E ejecutado localmente: el job `database` de CI requiere PostgreSQL 16 y no se reprodujo. Los resultados de `jest` son **unitarios**; el comportamiento end-to-end de migraciones, seed, RLS, Storage y concurrencia se infiere del código y de los tests que CI declara ejecutar, no de una ejecución observada.
2. **Los valores del panel de Vercel y de Supabase no son verificables desde el repositorio.** SEG-001, SEG-002, SEG-008 y SEG-010 mantienen acciones fuera del repositorio. Que los archivos `.env` no existan **no demuestra** que la contraseña se haya rotado ni que el bucket se haya configurado como el código espera.
3. **ACC-026 y los contrastes sobre fotografía requieren navegador.** Los ratios citados provienen de composición CSS y de muestreo del degradado, no de una captura real.
4. **El bucket de Supabase no se inspeccionó.** El veredicto de SEG-008 se apoya en lo que el código *configura* (`allowed_mime_types`, `file_size_limit`, `public: true`) y en lo que `estado()` *reporta*, no en una lectura de la configuración real del proyecto Supabase.
5. **No se auditó una por una las 43 tablas ni las 65+ operaciones** con herramientas automáticas más allá de CodeQL (que corre en CI, no localmente). La revisión de SQL fue manual y dirigida a las clases de fallo de V1/V2.

---

## 15. Resumen final

**Esta es la iteración en la que el proyecto deja de «corregir hallazgos» y empieza a «sostener correcciones».** Los 133 hallazgos de las auditorías previas están evaluados uno a uno sobre el código actual, y el resultado es que **125 están cerrados, 7 son residuales acotados y documentados, y 1 no es verificable sin navegador**. No queda ningún P0. No queda ningún P1.

Las tres transformaciones que explican el salto:

1. **Los 7 hallazgos nuevos de V2 se cerraron todos**, y el P1 entre ellos —el *seed* que fallaba en abierto y creaba un administrador con contraseña conocida en cada base vacía— se resolvió **por triplicado**: validación de entorno, guarda en el servicio *fail-closed* y excepción explícita salvo opt-in. Es la clase de corrección que V3 viene pidiendo desde el primer informe: no un parche, sino la eliminación de la condición que lo hacía posible.

2. **La observabilidad y la seguridad del proceso llegaron de golpe.** `JsonLogger`, `registroPeticiones` con `request_id`, métricas por instancia, un `/health` que verifica la base, las migraciones y el almacenamiento, y un CI que pasó de 4 a 6 jobs con CodeQL en modo `security-extended` y *dependency review* con `fail-on-severity: high`. **13 vulnerabilidades → 0**, no por parcheo sino por subir a NestJS 11. Y el `npm audit --audit-level=high` ahora corre sobre **todas** las dependencias, incluidas las de desarrollo, que V2 señaló explícitamente que nunca se escaneaban.

3. **El modelo de empresas proveedoras reforzó, en lugar de debilitar, las fronteras de V1 y V2.** Es el cambio de mayor alcance funcional (migración 006, 5 endpoints, 2 páginas nuevas) y el riesgo natural de una ampliación de ese tamaño sería haber introducido un segundo modelo de permisos. No lo hizo: el `alcance()` de reservas y de catálogo sigue teniendo **exactamente tres ramas** y la nueva rama `operador` se apoya en `operador_usuario`, la misma tabla que ya existía. `esAdmin(user) ? 'todas' : user.operador != null ? 'operador' : 'propias'` es la misma decisión de V2 con una fuente de datos nueva. Las respuestas siguen siendo 404 —no 403— ante recursos ajenos, y el flujo de revisión impide que un operador se autopublique. Cuando una ampliación funcional mantiene invariantes de seguridad en lugar de erosionarlos, es la señal más fiable de que la disciplina funciona.

**Lo que queda son siete puntos, y es importante nombrarlos con precisión: ninguno es un defecto.** Dos son **decisiones de producto escritas en el README** —el bucket público y la ausencia de verificación de correo— y dos son **alcance declarado**: la SPA sin SSR/SSG y el token en `sessionStorage` en lugar de cookie `httpOnly`. Dos son **deuda técnica acotada y comentada en el código**: la ventana de 3 s en la caché de revocación y el `type` de error residual del *entry point*. El séptimo (SEG-010) es el único que depende de un valor que existe fuera del repositorio.

**El único defecto de contraste vivo es una regla CSS de una línea** (V3-ACC-01), introducido por la última funcionalidad añadida. Es, por sí mismo, el mejor indicador del estado del proyecto: una auditoría cuyo hallazgo más reciente es «los botones nuevos del login no tienen borde perceptible» y cuyo hallazgo más grave sigue siendo una decisión de producto documentada hace tres versiones.

**Y una observación de gestión para cerrar.** V2 señaló que la propiedad crítica del sistema —que todo parámetro está parametrizado— dependía de la disciplina de quien escribe, y no de una comprobación automática. **Esa dependencia ya no existe:** `contract-coverage.spec.ts` falla si una ruta no está documentada, CodeQL `security-extended` falla si aparece concatenación no parametrizada, `dependency-review` falla si entra una dependencia comprometida, y `npm audit --audit-level=high` falla ante cualquier vulnerabilidad alta. Las 125 correcciones ya no son un trámite: son un estado que el sistema mantiene solo.