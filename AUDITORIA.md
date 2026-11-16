# Auditoría técnica completa — «Descubre EC»

**Proyecto:** Reserva de atracciones turísticas en Ecuador (Booking Prototipo · dominio Atracciones)
**Alcance:** `backend/` (NestJS 10 + TypeORM + PostgreSQL) y `frontend/` (React 18 + Vite)
**Fecha:** 29 de septiembre de 2026
**Tipo de auditoría:** estática, de caja blanca, **sin ejecutar la aplicación y sin modificar ningún archivo**
**Normativas aplicadas:** WCAG 2.1 AA + WCAG 2.2 AA (criterio 2.5.8 incluido), OWASP Top 10 2021, ISO/IEC 25010, OpenAPI 3.x, RFC 7807, RFC 9457, RFC 6749 (OAuth2), CIS Docker/Node referencia.

---

## 0. Cómo leer este informe

| Prefijo | Área |
|---|---|
| `ACC-xxx` | Accesibilidad (WCAG) |
| `SEG-xxx` | Seguridad y privacidad |
| `API-xxx` | Diseño de API REST y cumplimiento del contrato OpenAPI |
| `DAT-xxx` | Datos, persistencia e índices |
| `CON-xxx` | Concurrencia, idempotencia y transacciones |
| `WEB-xxx` | Frontend: rendimiento, SEO y arquitectura de componentes |
| `OPS-xxx` | Despliegue, operación y observabilidad |
| `CAL-xxx` | Calidad de código, arquitectura y DevOps |

Severidad: **P0 Crítica** (bloquea la entrega o una puesta en producción) · **P1 Alta** · **P2 Media** · **P3 Baja**.

Todo hallazgo lleva referencia `archivo:línea` verificada sobre el código actual.

---

## 1. Resumen ejecutivo

### 1.1 Semáforo por área

| # | Área | Veredicto | P0 | P1 | P2 | P3 | Total |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| 1 | Accesibilidad (WCAG 2.1/2.2 AA) | 🟠 **Cumple parcialmente** | 0 | 11 | 14 | 10 | **35** |
| 2 | Seguridad y privacidad | 🔴 **No cumple** | 6 | 9 | 8 | 2 | **25** |
| 3 | API REST y contrato OpenAPI | 🟠 **Cumple parcialmente** | 0 | 1 | 9 | 4 | **14** |
| 4 | Datos y persistencia | 🟠 **Cumple parcialmente** | 1 | 0 | 7 | 2 | **10** |
| 5 | Concurrencia e idempotencia | 🔴 **No cumple** | 0 | 3 | 1 | 0 | **4** |
| 6 | Frontend (rendimiento, SEO, arquitectura) | 🟡 **Cumple en su mayor parte** | 0 | 0 | 8 | 6 | **14** |
| 7 | Despliegue y operación | 🟠 **Cumple parcialmente** | 0 | 2 | 5 | 2 | **9** |
| 8 | Calidad, arquitectura y DevOps | 🔴 **No cumple** | 0 | 4 | 6 | 5 | **15** |
| | **TOTAL** | | **7** | **30** | **58** | **31** | **126** |

### 1.2 Los 7 hallazgos que impiden entregar

| ID | Hallazgo | Por qué es bloqueante |
|---|---|---|
| **SEG-001** | La contraseña de la base de datos de **Supabase producción** está en claro en `backend/.env.vercel` y `backend/.env.production` | Control total de la BD de producción desde Internet (el pooler expone el 6543). Hay que **rotarla ya**. |
| **SEG-002** | Token OIDC de Vercel (`VERCEL_OIDC_TOKEN`, vigente) en `backend/.env.local` | Permite desplegar, leer logs y leer variables de entorno del servicio. |
| **SEG-003** | `JWT_SECRET` con valor por defecto hardcodeado en el código (`common.module.ts:19`) | Si la variable falta en el entorno, la API arranca y **falsifica tokens de administrador** sin credencial alguna. |
| **SEG-004** | Un usuario con rol `OPERADOR` puede listar **todas las reservas de todos los clientes** con nombre, email, teléfono y documento (`reservas.service.ts:138`) | Fuga masiva de datos personales. Un solo rol de la empresa tourismística extrae la base de clientes. |
| **SEG-005** | Cero rate limiting en toda la API | Fuerza bruta ilimitada contra `/auth/login` con credenciales de demo públicas; abuso del endpoint de mensajes y de subidas. |
| **SEG-006** | Sin `helmet`: no hay CSP, HSTS, `X-Content-Type-Options` ni `X-Frame-Options` | Se elimina una capa de defensa completa frente al XSS de SEG-007 y al clickjacking. |
| **DAT-001** | No existen migraciones; el esquema depende de `synchronize` implícito (`app.module.ts:33`) | Un entorno de *preview* puede ejecutar DDL sobre la base de producción. Sin reversión posible. |

### 1.3 Fortalezas reales del proyecto (lo que sí está bien)

Es importante decirlo: **la base es sólida y está por encima de la media de un proyecto académico**. En concreto:

- ✅ **Cero inyección SQL.** Todos los parámetros van parametrizados (`:id`, `:q`, `IN (:...cities)`, `$1`). El `ORDER BY` se resuelve con un `switch` sobre una lista cerrada de seis opciones (`atracciones.service.ts:88-95`), nunca por interpolación. **Verificado: no hay ningún caso vulnerable.**
- ✅ **`ValidationPipe` estricto** con `whitelist: true` + `forbidNonWhitelisted: true` (`app.factory.ts:29-35`): el mass assignment está bloqueado por diseño.
- ✅ **RFC 7807 global** con `application/problem+json` y campo `instance`; los errores de `class-validator` se convierten en `errors[]` con el campo responsable, y el `23505` de Postgres se traduce a un 409 con sentido.
- ✅ **Prevención de IDOR bien resuelta:** `getOwned` devuelve **404 en lugar de 403** para no revelar que el recurso existe, con el comentario explicando la decisión (`reservas.service.ts:156-164`).
- ✅ **Idempotency-Key obligatorio y validado como UUID** en las tres operaciones transaccionales, con `@ApiHeader` documentado.
- ✅ **Zona horaria del negocio explícita** (`America/Guayaquil`, fechas de reserva en UTC-5 fijo, reportes con `AT TIME ZONE`). Detalle que muchos proyectos omiten y aquí está resuelto.
- ✅ **Importes como `numeric(10,2)` con transformer** — sin errores de coma flotante en el cálculo de totales.
- ✅ **Modal accesible completo:** focus trap, `role="dialog"`, `aria-modal`, cierre con Esc, devolución del foco, `body` bloqueado y pila de modales (`ui.jsx:39-99`).
- ✅ **Componente `Field` bien construido:** label asociado, `aria-describedby` dinámico, `role="alert"` en el error, `useId()` para IDs estables.
- ✅ **`prefers-reduced-motion` respetado globalmente** en las 38 declaraciones de `animation`/`transition` del proyecto (`base.css:161-167`).
- ✅ **Objetivos táctiles por encima del mínimo:** `.btn` 44 px, `.icon-btn` 44/36 px, `.nav-link` 40/48 px, `.qty button` 40 px, `.slot` 52 px.
- ✅ **Panel de administración con *code splitting*:** los viajeros no descargan el código del admin.
- ✅ **Contraseñas con bcrypt (coste 10)**, `passwordHash` con `select: false`, política mínima de 8 caracteres con letra y número, emails normalizados a minúsculas.
- ✅ **Rutas estáticas declaradas antes de `:id`** con el motivo documentado (`atracciones.controller.ts:43-47`).
- ✅ **El calendario de disponibilidad es un buen ejemplo de accesibilidad**: cada día lleva un `aria-label` descriptivo con el estado (`BookingWidget.jsx:63`), lo que compensa que la leyenda sea `aria-hidden`.

---

# 2. ACCESIBILIDAD (WCAG 2.1 AA / 2.2 AA)

## 2.1 Cumplimiento por criterio

| Criterio | Nombre | Veredicto | Nº |
|---|---|---|:-:|
| 1.1.1 | Contenido no textual | 🟡 Parcial | 1 |
| 1.3.1 | Información y relaciones | 🟠 Parcial | 2 |
| 1.4.3 | Contraste (mínimo) | 🔴 No cumple | 6 |
| 1.4.10 | Reflujo | 🟢 Cumple | 0 |
| 1.4.11 | Contraste no textual | 🔴 No cumple | 3 |
| 2.1.1 | Teclado | 🔴 No cumple | 5 |
| 2.1.2 | Sin trampas de teclado | 🟢 Cumple | 0 |
| 2.2.1 | Tiempo ajustable | 🟡 Parcial | 1 |
| 2.4.1 | Evitar bloques | 🟢 Cumple | 0 |
| 2.4.3 | Orden del foco | 🔴 No cumple | 3 |
| 2.4.4 | Propósito del enlace | 🟠 Parcial | 1 |
| 2.4.6 | Encabezados y etiquetas | 🟠 Parcial | 1 |
| 2.4.7 | Foco visible | 🔴 No cumple | 2 |
| 2.5.5 | Tamaño del objetivo (2.5.8) | 🟢 Cumple | 0 |
| 3.3.1 | Identificación de errores | 🟠 Parcial | 2 |
| 3.3.2 | Etiquetas o instrucciones | 🟠 Parcial | 1 |
| 3.3.3 | Ayuda y redundancia | 🟢 Cumple | 0 |
| 3.3.4 | Confirmación | 🟢 Cumple | 0 |
| 4.1.2 | Nombre, rol, valor | 🔴 No cumple | 14 |
| 4.1.3 | Mensajes de estado | 🔴 No cumple | 4 |

Un hallazgo puede incumplir varios criterios a la vez (por ejemplo, ACC-003 y ACC-004 son simultáneamente 2.1.1, 2.4.3 y 4.1.2), por lo que la suma de esta columna es mayor que 35. ACC-034 se clasifica como *best practice* y no computa en ningún criterio.

## 2.2 Hallazgos P1 (Alta)

### ACC-001 — El indicador de foco global no alcanza el contraste mínimo
**Criterio WCAG:** 1.4.11 (Contraste no textual) y 2.4.7 (Foco visible)
**Archivos:** `styles/base.css:56`, `base.css:116-120`, `components.css:82,111`, `public.css:148`, `styles/admin.css:177`

`--ring: 0 0 0 3px rgba(20,184,166,.45)` compuesto sobre blanco produce `#95DFD7`, con un ratio de **1.52:1** cuando WCAG 2.1 AA exige **≥ 3:1** para el indicador de foco. Además, en inputs el borde de foco cambia a `--secondary` `#14b8a6`, que sobre blanco da **2.49:1**, y la regla global `outline: none` (base.css:117) elimina cualquier indicador de reserva.

**Impacto:** una persona que navega solo con teclado, o con baja visión, no puede localizar dónde está el foco. Es el incumplimiento de mayor impacto de todo el bloque de accesibilidad porque afecta a *todas* las pantallas.

**Corrección:**
```css
--ring: 0 0 0 3px #0f766e;                 /* 5.47:1 sobre blanco */
:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
.input:focus  { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(15,118,110,.35); }
```

---

### ACC-002 — El enlace «Ingresar» se queda sin nombre accesible en móvil
**Criterio:** 2.4.4, 4.1.2
**Archivo:** `components/PublicLayout.jsx:110-112` + `styles/public.css:49`

```jsx
<Link to="/ingresar" className="btn btn-sm btn-cta">
  <LogIn size={16} /> <span className="hide-xs">Ingresar</span>
</Link>
```
A ≤900 px, `.hide-mobile`/`.hide-xs` aplican `display: none !important` y ocultan el texto. El icono `<LogIn>` de lucide no aporta nombre (sin `aria-label`, sin `<title>`), así que el enlace **queda completamente sin nombre accesible**. Un lector de pantalla anunciará simplemente «enlace».

**Corrección:** `<Link ... aria-label="Ingresar">` o mover el texto a una clase `.sr-only` en lugar de `display:none`.

---

### ACC-003 — Menú de usuario con `role="menu"` sin teclado APG
**Criterio:** 2.1.1, 4.1.2
**Archivo:** `components/PublicLayout.jsx:42,47,53-58`

Se declara `aria-haspopup="menu"` en el disparador y `role="menu"` / `role="menuitem"` en los hijos, pero **no** se implementa el patrón de teclado del APG: sin flechas ↑↓, sin `Home`/`End`, sin `tabindex` rotatorio, sin foco inicial al abrir ni devolución del foco al cerrar. Además `<div className="dropdown-head">` (línea 49) y los dos `<hr>` (líneas 53 y 58) son hijos no válidos dentro de `role="menu"`, lo que produce una estructura ARIA inconsistente.

**Impacto:** quien use lector de pantalla espera el comportamiento de un menú y no lo encuentra; quien use teclado no puede moverse entre los ítems con las flechas que el rol promete.

**Corrección (dos opciones válidas):**
- *Degradar a patrón disclosure* (lo más simple y lo más robusto): quitar `role="menu"`/`role="menuitem"`/`aria-haspopup` y dejar un grupo de enlaces dentro de un contenedor normal con `aria-expanded` en el botón. Es lo que recomienda el propio WAI-ARIA para menús de acciones simples.
- *Implementar el patrón APG completo*: `role="menu"`, `tabindex={-1}` en todos los ítems, foco en el primer ítem al abrir, flechas ↑↓ / `Home` / `End` / `Esc`, foco devuelto al disparador, y mover la cabecera y los separadores fuera del contenedor `role="menu"`.

---

### ACC-004 — El menú móvil es un overlay que no gestiona el foco
**Criterio:** 2.1.1, 2.4.3, 4.1.2
**Archivos:** `components/PublicLayout.jsx:114-134`, `styles/public.css:51-61`; `pages/Explore.jsx:144-147` (mismo patrón en el drawer de filtros)

```jsx
{mobile && (
  <div className="mobile-nav" onClick={...}>
    <nav aria-label="Menú móvil"> ... </nav>
  </div>
)}
```
El overlay es `position: fixed; inset: 0` pero **no** tiene `role="dialog"`, `aria-modal`, `inert` sobre el resto del documento, ni desplazamiento del foco al abrir, ni retorno al cerrar, ni cierre con Escape. El contenido de fondo sigue siendo tabulable aunque esté visualmente tapado. El `aria-expanded` del disparador (línea 115) tampoco tiene `aria-controls` — siendo coherente que `AdminLayout.jsx:156` sí lo use.

**Corrección:** extraer el drawer a un componente reutilizable (igual que el `Modal` de `ui.jsx`, que ya lo resuelve bien) y aplicarle: `role="dialog" aria-modal="true"`, `inert` en el contenido hermano, foco al primer enlace, `Escape` para cerrar, y restauración del foco en `.menu-toggle` / `#filtros`.

---

### ACC-005 — El sidebar del panel es tabulable mientras está oculto
**Criterio:** 2.4.3, 2.4.7
**Archivos:** `styles/admin.css:117-119`, `admin/AdminLayout.jsx`

```css
@media (max-width: 1024px) {
  .adm-sidebar { position: fixed; left: 0; top: 0; bottom: 0; transform: translateX(-100%); }
  .adm-sidebar.open { transform: none; }
}
```
A ≤1024 px el sidebar se traslada fuera de pantalla **solo con `transform`**, lo que no lo saca del árbol de accesibilidad: sus ~12 enlaces siguen en el orden de tabulación y son alcanzables por teclado aunque el usuario no los vea. No hay `visibility: hidden`, ni `inert`, ni `aria-hidden`.

**Corrección:** `<aside inert={!open}>` (React 19) / `ref.current.inert = !open` (React 18) o `visibility: hidden` en la variante cerrada.

---

### ACC-006 — La navegación SPA pública no mueve el foco ni anuncia la página
**Criterio:** 2.4.3, 4.1.3
**Archivo:** `components/PublicLayout.jsx:188-196`

```jsx
useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
...
<main id="main" tabIndex={-1} className="site-main">
```
El `tabIndex={-1}` declara la intención de que `<main>` reciba el foco, pero **nadie lo enfoca**. Tras navegar, el foco permanece en el enlace que se pulsó (que ya no existe en pantalla si cambió de ruta) y el lector de pantalla no anuncia la vista nueva. Es un fallo de Focus Management en SPA. Contrasta con `admin/AdminLayout.jsx:102`, que **sí** enfoca `.adm-content` al navegar — la solución ya existe dentro del propio proyecto.

**Corrección:**
```jsx
const mainRef = useRef(null);
useEffect(() => { window.scrollTo(0, 0); mainRef.current?.focus(); }, [pathname]);
// <main ref={mainRef} id="main" tabIndex={-1}>
```
y quitar el `outline: none` inline / de `public.css:3`, ya que el foco programático no debe mostrar anillo.

---

### ACC-007 — El calendario declara `role="grid"` pero no tiene estructura de grid
**Criterio:** 2.1.1, 4.1.2
**Archivo:** `components/BookingWidget.jsx:49-70`

```jsx
<div className="cal-grid" role="grid" aria-label={...} aria-busy={!days}>
  {DOW.map((d) => <div className="cal-dow" aria-hidden="true">{d}</div>)}
  {Array.from({length: offset}, (_, i) => <div key={`e${i}`} />)}
  {(days ?? ...).map((d) => <button ... aria-pressed={value === d.date} />)}
</div>
```
El contenedor dice `role="grid"` pero **no existe ni un `role="row"` ni un `role="gridcell"`** en todo el proyecto (verificado: 0 coincidencias). Consecuencias: (a) el calendario no es navegable con flechas, lo que el rol `grid` promete; (b) cada día es un tabulador independiente, así que tabular un mes completo son ~31 pulsaciones de `Tab`; (c) los huecos del *offset* son `<div>` vacíos sin significado para la retícula.

**Corrección (dos opciones):**
- Implementar el patrón APG *Grid Layout* completo: `role="row"` + `role="gridcell"` + `role="columnheader"`, `tabindex` rotatorio con exactamente un `tabindex="0"`, flechas ←→↑↓, `PageUp`/`PageDown`, `Home`/`End`, `Ctrl+Home`/`Ctrl+End`.
- **O bien la opción simple y legítima**: quitar `role="grid"` y dejar una lista de botones con `aria-pressed` (que ya está en la línea 62) y un `role="group"` con nombre. El `aria-label` descriptivo de cada día (línea 63) ya aporta toda la información.

---

### ACC-008 — Tres `tablist` sin `tabpanel` ni teclado de flechas
**Criterio:** 2.1.1, 4.1.2
**Archivos:** `pages/Checkout.jsx:194-197`, `pages/MyReservations.jsx:121-126`, `admin/ReservasAdmin.jsx:106-107`

Los tres `role="tablist"` declaran `role="tab"` y `aria-selected`, pero no tienen `id` en el tab, ni `aria-controls`, ni ningún `role="tabpanel"` con su `aria-labelledby`, ni gestión de flechas/`Home`/`End`. Todos los tabs son tabulables, lo que multiplica la carga del teclado. Además, los de `Checkout` y `ReservasAdmin` **no tienen nombre accesible** para la `tablist` (solo el de `MyReservations` lo tiene).

**Corrección:** implementar el patrón Tabs del APG completo, o sustituir por `role="group"` con botones `aria-pressed` (igual que ya se hace en `.segmented`, `components.css:281`).

---

### ACC-009 — El selector de estrellas no implementa el `radiogroup` que declara
**Criterio:** 2.1.1, 4.1.2
**Archivo:** `components/Reviews.jsx:55-73`

```jsx
<div className="star-picker" role="radiogroup" aria-labelledby="rv-stars" onMouseLeave={...}>
  {[1,2,3,4,5].map((i) => (
    <button role="radio" aria-checked={rating === i} aria-label={`${i} estrellas: ${LABELS[i]}`} ...>
```
`role="radiogroup"` promete: (a) solo un elemento en el grupo es tabulable y el resto tiene `tabindex="-1"`; (b) las flechas ←→ cambian la selección. Ninguna de las dos cosas está implementada: los cinco botones son tabulables y no hay manejo de teclado. La asociación `aria-labelledby="rv-stars"` sí está correcta — ese acierto se mantiene.

**Corrección:** `tabindex={rating === i ? 0 : -1}` + handler de `ArrowLeft`/`ArrowRight` que mueva `rating` y el foco; **o** usar `<input type="radio">` nativos con `appearance: none` estilizado, que es la solución más robusta.

---

### ACC-010 — Los campos obligatorios no se marcan programáticamente
**Criterio:** 3.3.2, 4.1.2
**Archivo:** `components/ui.jsx:211,218`

```jsx
<label htmlFor={id}>
  {label}
  {required && <span className="req" aria-hidden="true">*</span>}
</label>
```
El asterisco es decorativo (`aria-hidden`) y **no se propaga `required` ni `aria-required`** al control. Esto afecta a **todos los formularios de la aplicación**: login, registro, checkout, perfil, contraseña, contacto y todo el panel de administración. Un lector de pantalla anunciará «Nombre completo, campo de texto» sin indicar que es obligatorio. Tampoco hay ninguna leyenda que explique el significado de `*`, lo que además rompe 3.3.2 (Etiquetas o instrucciones).

**Corrección:**
```jsx
{/* en Field, al construir el props del control */}
{ id, required, 'aria-required': required, 'aria-invalid': !!error, ... }
{/* y una vez por formulario */}
<p className="hint" id="req-legend">Los campos marcados con * son obligatorios.</p>
```

---

### ACC-011 — Las alertas `warning` no se anuncian a los lectores de pantalla
**Criterio:** 4.1.3 (Mensajes de estado)
**Archivo:** `components/ui.jsx:194`

```jsx
<div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
```
Solo `danger` recibe `role="alert"`. Los tonos `info`, `success` y **`warning`** no tienen rol ni región viva, de modo que un cambio de contenido no se anuncia. Casos afectados, todos de información crítica para la tarea:

| Ubicación | Mensaje que no se anuncia |
|---|---|
| `BookingWidget.jsx:159` | «No hay salidas para esta fecha. Prueba con otro día.» |
| `BookingWidget.jsx:173` | «Solo quedan N cupos a las HH. Reduce participantes…» |
| `Checkout.jsx:64` | Falta seleccionar fecha |
| `Checkout.jsx:185` | **«Los cupos cambiaron»** (el aviso más importante del checkout) |
| `MyReservations.jsx:56` | La reserva está fuera del plazo de cancelación |
| `ReportesAdmin.jsx:93` | El rango de fechas del reporte no es válido |
| `MiscPages.jsx:378` | Acceso restringido |

**Corrección:** `role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}` y `aria-live="polite"` en el contenedor de la familia `success`/`info`.

---

## 2.3 Hallazgos P2 (Media)

### ACC-012 — Los bordes de botones e inputs están por debajo de 3:1
**Criterio:** 1.4.11 · `styles/components.css:5,12,73` + `styles/base.css:26`

`--border-strong: #c9bfb0` sobre blanco `--surface` da **1.82:1** (hover `#a99d8b` → 2.66:1). WCAG 1.4.11 exige ≥3:1 para los límites que identifican un componente de interfaz. Como `.btn` (líneas 2-22) es un botón de contorno cuyo **único** indicador es `border: 1.5px solid var(--btn-border)`, y `.input`/`.select`/`.textarea` (línea 73) igual, todos los controles secundarios son ambiguos para baja visión.
**Corrección:** `--border-strong: #a89b8a` (≈3.1:1) o más oscuro.

### ACC-013 — El color de los `placeholder` está por debajo de 4.5:1
**Criterio:** 1.4.3 · `styles/components.css:80` — `#7b8886` sobre blanco = **3.68:1**.
**Corrección:** usar `--muted` `#52615f` (**6.49:1**).

### ACC-014 — En el selector de estrellas ningún estado alcanza 3:1
**Criterio:** 1.4.11 · `styles/components.css:169,173,174`
- Estrella no seleccionada `#d9d1c4` → **1.51:1**
- Estrella seleccionada `var(--cta)` `#f59e0b` → **2.15:1**

Como el estado del control se comunica por color, ambos deben alcanzar 3:1.
**Corrección:** estado activo `var(--primary)` (5.47:1) y estado inactivo ≥3:1. El texto `LABELS[hover || rating]` de `Reviews.jsx:73` ya comunica el valor, así que el color es refuerzo, pero debe ser legible.

### ACC-015 — Días pasados con `opacity: .45` rompen el contraste de datos
**Criterio:** 1.4.3 · `styles/admin.css:322` → `DisponibilidadAdmin.jsx`
`.occ-day` es un `<div>` de **datos** (ocupación, disponibles), no un control inactivo, así que **no** le aplica la excepción de «componente inactivo». Con `opacity: .45` el texto cae a ≈**2.67:1**.
**Corrección:** quitar la opacidad y diferenciar con color de superficie o con un tono de texto más oscuro.

### ACC-016 — Reseñas ocultas con 65 % de opacidad quedan ilegibles
**Criterio:** 1.4.3 · `admin/PeopleAdmin.jsx:183` — `style={{ opacity: r.visible ? 1 : 0.65 }}`
`--text-2` `#3d4d4b` al 65 % sobre blanco baja a ≈**3.49:1** (< 4.5:1). El estado sí se comunica con texto («Oculta»), por lo que no es 1.4.1, pero el contenido resulta ilegible.
**Corrección:** `opacity: 1` siempre y marcar la ocultación con color, borde o etiqueta.

### ACC-017 — «Cargar más experiencias» no anuncia los resultados nuevos
**Criterio:** 4.1.3 · `pages/Explore.jsx:311-318`
Tras pulsar, el foco se queda en el botón y las tarjetas nuevas se insertan sin anuncio. El `<span>Mostrando X de Y</span>` no es región viva. Ya hay un `aria-live` correcto en la línea 268 para el contador de búsqueda inicial, pero no para la paginación.
**Corrección:** mover el foco al primer `<article>` nuevo o añadir `aria-live="polite"` al resumen de la lista.

### ACC-018 — `aria-label` en `<div>` con rol `generic`
**Criterio:** 4.1.2 · `pages/Confirmation.jsx:61` y `admin/DisponibilidadAdmin.jsx:105`
`aria-label` no se expone en elementos de rol `generic`; el nombre se descarta en varias combinaciones de lector de pantalla. En `Confirmation.jsx` el código ya es texto visible, así que el `aria-label` es redundante.
**Corrección:** eliminarlo, o usar un elemento con rol semántico (`<output>`, `<section aria-labelledby>`).

### ACC-019 — Ninguna tabla de datos declara `scope` ni `<caption>`
**Criterio:** 1.3.1 · `admin/Dashboard.jsx`, `admin/CatalogAdmin.jsx:106,207,296`, `admin/PeopleAdmin.jsx:33,126`, `admin/ReservasAdmin.jsx:133`, `admin/DisponibilidadAdmin.jsx:95`
Verificado: **cero** apariciones de `scope=` o `<caption>` en todo `frontend/src`. En tablas de 6-9 columnas de datos numéricos, la pérdida de la asociación columna/fila es un problema real al navegar por celdas.
**Corrección:** `<caption className="sr-only">…</caption>` (o `aria-label` en el `<table>`) y `scope="col"` en cada `<th>` de cabecera, `scope="row"` en la primera celda de cada fila de datos.

### ACC-020 — Salto de nivel de encabezado `h1` → `h3` en «Mis reservas»
**Criterio:** 1.3.1, 2.4.6 · `pages/MyReservations.jsx:118` → `:151`
`<h1>Mis reservas</h1>` (118) seguido directamente de `<h3><Link>{r.attraction.name}</Link></h3>` (151) dentro de cada `<article>`. No hay ningún `<h2>` intermedio, y la `tablist` (121) no aporta jerarquía.
**Corrección:** añadir un `<h2 className="sr-only">` por artículo, o promover el nombre a `<h2>`.

### ACC-021 — ARIA conflictivo en el selector de iconos del panel
**Criterio:** 4.1.2 · `admin/CatalogAdmin.jsx:35,37`
El mismo botón declara `role="radio"` + `aria-checked` **y** `aria-pressed` — `aria-pressed` está **prohibido** en `role="radio"`. El `radiogroup` tampoco tiene flechas, y los `aria-label` son *slugs* técnicos (`aria-label={k}` → `"building-2"`, `"map-pin"`), que un usuario de lector de pantalla oye en inglés sin contexto.
**Corrección:** quitar `aria-pressed`, implementar flechas y usar nombres en español («Edificio», «Monumento»).

### ACC-022 — Interruptores con etiquetas idénticas dentro de las tablas
**Criterio:** 4.1.2 · `admin/CatalogAdmin.jsx:115,220,305`, `admin/PeopleAdmin.jsx`, `admin/ReservasAdmin.jsx`
Todos los `Switch` de columna usan `label={<span className="sr-only">Visible</span>}` o `"Activo"`. En una tabla de 12 filas el lector anuncia repetidamente «Visible, interruptor, activado» sin saber a qué fila pertenece.
**Corrección:** `aria-label={`Activar ${nombreDelElemento}`}`.

### ACC-023 — Errores de API renderizados sin `role="alert"`
**Criterio:** 4.1.3 · `admin/CatalogAdmin.jsx:63,170,272`, `admin/PeopleAdmin.jsx:80`, `admin/ReportesAdmin.jsx`
Se renderizan como `<p className="error-text">` sin región viva, a diferencia de `Field` y `AtraccionForm.jsx:206`, que sí usan `<Alert tone="danger">`. La inconsistencia dentro del mismo panel es el problema.
**Corrección:** unificar en `<Alert tone="danger">`.

### ACC-024 — Etiquetas de «Etiqueta transparente»: header del panel por debajo de 4.5:1
**Criterio:** 1.4.3 · `styles/admin.css:45`
`.adm-nav-label { color: rgba(153,246,228,0.5) }` sobre `--sidebar` `#0b3b36` compone `#52998D` → **3.72:1**. Es texto de 0.64 rem (≈10 px) en mayúsculas, es decir, **texto pequeño**: exige 4.5:1. Estos rótulos ("General", "Catálogo", "Operación", "Personas", "Análisis") son la única separación visual entre grupos del menú.
**Corrección:** `rgba(153,246,228,0.72)` → ≈5.4:1.

### ACC-025 — Texto secundario del banner de bienvenida del panel
**Criterio:** 1.4.3 · `styles/admin.css:173`
`.adm-welcome p { color: rgba(236,253,250,0.65) }` sobre el gradiente `linear-gradient(135deg,#04221f,#0b3b36,#0f5f57)`. En el tramo más claro (`#0f5f57`) compone `#9FC6C1` → **4.05:1**, por debajo de 4.5:1.
**Corrección:** subir a `rgba(236,253,250,0.78)` (≈5.2:1) u oscurecer el extremo claro del gradiente.

## 2.4 Hallazgos P3 (Baja / mejoras)

### ACC-026 — El header transparente sobre fotografía depende del contraste del fondo
**Criterio:** 1.4.3 (condicional) · `styles/public.css:13-15,89`
En la portada, `.site-header.transparent` pone los enlaces en `#fff` sobre la foto del hero. El degradado `hero::before` es `rgba(8,26,24,0.55)` en la banda superior, pero en las zonas claras de `hero-cotopaxi.jpg` el ratio puede bajar de 4.5:1. Lo mismo ocurre con `.hero-credit` (`rgba(255,255,255,0.7)`, línea 89).
**Nota:** depende del renderizado con la imagen real; **requiere verificación visual con herramienta de contraste sobre captura**.
**Corrección:** oscurecer el degradado superior a `rgba(8,26,24,0.68)` y subir `.hero-credit` a `rgba(255,255,255,0.85)`, o añadir `text-shadow` a los enlaces del header transparente.

### ACC-027 — `aria-describedby` puede apuntar a un ID inexistente
**Criterio:** 4.1.2 · `components/ui.jsx:211,222`
`aria-describedby` se construye incluyendo `hintId` siempre que haya `hint`, pero el hint **solo se renderiza si no hay error** (línea 222). Con hint + error a la vez, el IDREF queda colgando.
**Corrección:** incluir `hintId` solo cuando el hint se vaya a renderizar.

### ACC-028 — `aria-invalid` en un `<div>` genérico
**Criterio:** 4.1.2 · `admin/AtraccionForm.jsx:86` — `.tag-input`. El atributo no se expone sin rol. El error real ya se anuncia en la línea 256.
**Corrección:** eliminarlo, o moverlo al `input[type=time]`.

### ACC-029 — Etiquetas ambiguas en el editor de listas «Incluye / No incluye / Recomendaciones»
**Criterio:** 4.1.2 · `admin/AtraccionForm.jsx:68-69`
`aria-label={`${placeholder} ${i+1}`}` produce nombres como *«Ej. Transporte 1»* (derivados del *placeholder*, no del contenido), y el botón de borrado repite `aria-label="Quitar"` en cada fila.
**Corrección:** `aria-label={`Quitar «${valor || 'elemento'}» de la lista ${i+1}`}`.

### ACC-030 — Una hora con formato inválido se descarta en silencio
**Criterio:** 3.3.1 · `admin/AtraccionForm.jsx:80` — `if (!/^.../.test(t)) return;` sin ningún mensaje al usuario.
**Corrección:** mostrar un error bajo el campo indicando el formato esperado (HH:MM).

### ACC-031 — Los toasts se autodescartan sin pausa y pueden perder una acción
**Criterio:** 2.2.1 · `context/ToastContext.jsx:21`
4.5 s (info/éxito/advertencia) y 7 s (error), sin pausa al pasar el ratón ni al enfocar. El botón de acción (líneas 36-40) puede desaparecer **antes** de que una persona con movimiento reducido o baja visión pueda alcanzarlo con el puntero.
**Corrección:** pausar el temporizador en `onMouseEnter`/`onFocus` y extender la duración al enfocar. Alternativa simple y válida: eliminar el auto-descarte de los toasts que llevan acción y dejar que solo se cierren con el botón.

### ACC-032 — El error de rango de fechas no se asocia a los campos
**Criterio:** 3.3.1 · `admin/ReportesAdmin.jsx:93`
El `Alert` no indica qué campo corregir, y los dos `input` de fecha no reciben `aria-invalid` ni `aria-describedby`.
**Corrección:** `aria-describedby="rango-err"` en ambos campos + `id="rango-err"` en el `Alert`.

### ACC-033 — Las gráficas de Recharts no tienen nombre accesible
**Criterio:** 1.1.1 (riesgo residual) · `admin/charts.jsx`
El `<svg>` generado no lleva `role="img"` ni resumen. El riesgo está mitigado porque cada tarjeta ofrece alternancia a tabla («Ver tabla»), pero conviene reinforce.
**Corrección:** `<ResponsiveContainer>` envuelto en un `<div role="img" aria-label="Ingresos de los últimos 7 días.máximo 320 USD el jueves">`, o forzar la tabla como primera opción.

### ACC-034 — `target="_blank"` sin `rel="noopener noreferrer"`
**Criterio:** Best practice (no es incumplimiento AA) · `admin/PeopleAdmin.jsx:187`, `pages/Home.jsx:52`
Los navegadores modernos implican `noopener`, por lo que el riesgo es bajo, pero conviene ser explícito.

### ACC-035 — `role="menu"` en `AdminLayout` sin equivalente semántico
**Criterio:** 4.1.2 · `admin/AdminLayout.jsx:156` — el disparador sí usa `aria-controls`, pero conviene revisar que el submenú por rol siga el mismo criterio que ACC-003.

---

# 3. SEGURIDAD Y PRIVACIDAD

## 3.1 P0 — Críticos (bloquean la entrega)

### 🔴 SEG-001 — Credenciales de la base de datos de PRODUCCIÓN en claro en el disco
**Archivos:** `backend/.env.vercel:1`, `backend/.env.production:4`

**Evidencia verificada:**
```
.env.vercel:1      DATABASE_URL = postgresql://postgres.<proj-ref-supabase>:<CONTRASENA-REAL>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
.env.production:4  DATABASE_URL = "postgresql://postgres.<proj-ref-supabase>:<CONTRASENA-REAL>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
.env.production:2  # 1) Reemplaza <CONTRASENA-REAL> por la contraseña de la base de datos de Supabase.
```
El comentario de la línea 2 **instruye explícitamente** sustituir esa contraseña, y la sustitución nunca se hizo. La misma cadena aparece en ambos archivos. Por seguridad, el identificador del proyecto y la contraseña **no se reproducen aquí**; sí estaban en claro en los archivos del disco.

**Impacto:** control total de la base de datos de producción: lectura de `usuarios` (incluidos `passwordHash`), de `reservas` (cédula, teléfono, email, nombre) y de todo el catálogo. El *pooler* de Supabase expone el puerto 6543 a Internet, por lo que la credencial basta desde cualquier red y cualquier atacante que encuentre el archivo (copia de la carpeta, subida a un Drive, `git add -f`, repositorio compartido) la exploita de inmediato.

**Mitigación inmediata:** los archivos están correctamente ignorados por `.gitignore:37-41` (verificado con `git ls-files`: **solo `.env.example` está versionado**), así que **no está en el historial de Git**. El riesgo es local, no histórico.

**Plan de corrección:**
1. Rotar la contraseña en *Supabase → Dashboard → Database → Roles* (paso inmediato, antes de cualquier otra cosa).
2. Sustituir el rol `postgres` (superusuario) por un rol de permisos mínimos para la aplicación.
3. Eliminar la credencial de los archivos locales; distribuirla solo como variable cifrada del proyecto en Vercel (o Supabase Vault).
4. Añadir un escaneo de secretos (Gitleaks / `trufflehog`) como paso de CI.

---

### 🔴 SEG-002 — Token OIDC de Vercel vigente dentro del repositorio
**Archivo:** `backend/.env.local:2`

**Evidencia verificada:** `VERCEL_OIDC_TOKEN` es un JWT firmado de 1337 caracteres presente en el árbol de trabajo. Metadatos: `iss = https://oidc.vercel.com/dilan-s-projects10`, `aud = https://vercel.com/dilan-s-projects10`, `iat = 2026-09-29T14:40:46Z`, `exp = 2026-09-30T02:40:46Z` — **vigente en el momento de esta auditoría**. El valor no se reproduce en este informe.

**Impacto:** mientras esté vigente, permite obtener credenciales efímeras de Vercel para ese proyecto y, por extensión, desplegar código, leer los logs de ejecución y **acceder a las variables de entorno del servicio** (es decir, a la `DATABASE_URL` de SEG-001).

**Plan:** revocar el vínculo (`vercel logout` + revinculación del proyecto) para invalidar el token; borrarlo del disco; si llegó a formar parte de algún Secret, rotarlo; y revisar los logs de despliegue en busca de IPs inesperadas.

---

### 🔴 SEG-003 — `JWT_SECRET` con valor por defecto hardcodeado en el código
**Archivo:** `backend/src/common/common.module.ts:19`

```ts
secret: config.get<string>('JWT_SECRET', 'cambia-este-secreto-en-produccion'),
```
Si la variable de entorno no está definida, **la aplicación arranca con normalidad** y firma y valida tokens con una clave pública, escrita en el repositorio y documentada en `README.md:37-39` junto a las credenciales de prueba.

**Impacto:** forja trivial. Con `{"sub":"<uuid>","rol":"ADMIN","scope":["admin:full"]}` se obtienen `GET /usuarios`, `GET /reportes/ventas`, `GET /mensajes/stats`, el borrado de atracciones y la subida de archivos. Como el guard solo comprueba la firma (`jwt-auth.guard.ts:27`), no existe ninguna segunda barrera.

**Corrección:**
```ts
const secret = config.get<string>('JWT_SECRET');
if (!secret || secret.length < 32 || secret.includes('cambia-este-secreto'))
  throw new Error('JWT_SECRET ausente, débil o con valor de ejemplo');
```

---

### 🔴 SEG-004 — Un `OPERADOR` puede leer las reservas de TODOS los clientes (PII masiva)
**Archivos:** `backend/src/common/auth/scopes.ts:28`, `backend/src/modules/atracciones/reservas.service.ts:138`

```ts
// scopes.ts:28
[Rol.OPERADOR]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL, SCOPES.MANAGE],

// reservas.service.ts:138-139
if (!(query.all === 'true' && this.puedeGestionar(user))) qb.where('r.usuarioId = :uid', { uid: user.sub });
else qb.where('1=1');
```

`SCOPES_POR_ROL[OPERADOR]` incluye `attractions:manage`, así que `puedeGestionar()` devuelve `true` y la consulta pasa a `where('1=1')`, devolviendo **todas las reservas de todos los clientes** con `clienteNombre`, `clienteEmail`, `clienteTelefono` y `clienteDocumento` (`reserva.entity.ts:66-76`).

**Impacto:** un operador de **una sola** empresa tourismística extrae la base de clientes completa del marketplace con una sola petición:
```
GET /api/v1/atracciones/reservations?all=true
Authorization: Bearer <token-de-operador>
```
Es la fuga de PII más directa del sistema, y **el endpoint solo exige `attractions:read` a nivel de guard** (`atracciones.controller.ts:85`), no `manage` — es decir, hasta un `CLIENTE` que obtuviera ese scope por un bug lo lograría.

**Corrección:**
1. Añadir `operadorId` al claim del JWT y filtrar por `a.operador = :operadorId` en `list()`.
2. Reservar `?all=true` **exclusivamente** a `admin:full`, y mover el `@Scopes(SCOPES.MANAGE)` al nivel del guard, no solo a nivel de servicio.
3. Registrar en auditoría toda consulta con `all=true`.

---

### 🔴 SEG-005 — No hay rate limiting en ninguna ruta
**Archivo:** `backend/src/app.factory.ts` (ausente); `backend/package.json:17-32` (no incluye `@nestjs/throttler`)

**Impacto:** tres vectores abiertos de forma simultánea:
- **Fuerza bruta ilimitada** contra `POST /auth/login`, cuyas credenciales de demostración (`admin@descubre-ec.com`/`Admin123`, `operador@descubre-ec.com`/`Operador123`) están publicadas en el `README.md:37-39`.
- **Abuso de `POST /mensajes`** (el honeypot de `contacto.module.ts:72` solo detiene bots stereotyped, no un script).
- **Llenado del bucket de Supabase** vía `POST /uploads` (cada petición es una invocación facturable en Vercel).

**Corrección:**
```ts
// app.factory.ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])   // global
// por clase de ruta
@Throttle({ default: { limit: 5, ttl: 60000 } })     // login, por IP
@Throttle({ default: { limit: 3, ttl: 3600000 } })   // registro, por IP
@Throttle({ default: { limit: 5, ttl: 60000 } })     // mensajes
@Throttle({ default: { limit: 20, ttl: 3600000 } })  // uploads, por `sub`
```

---

### 🔴 SEG-006 — Sin `helmet`: faltan CSP, HSTS, `X-Content-Type-Options` y `X-Frame-Options`
**Archivo:** `backend/src/app.factory.ts:15-58`

**Impacto:** se elimina una capa de defensa completa frente al XSS de SEG-007 (que se sirve desde el propio dominio de la API) y frente al clickjacking del panel de administración. También se permite la degradación silenciosa de HTTPS.

**Corrección:**
```ts
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https://*.supabase.co'],
    scriptSrc: ["'self'", SWAGGER_CDN],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  }},
  crossOriginEmbedderPolicy: false,
}));
```

## 3.2 P1 — Altos

### 🟠 SEG-007 — XSS almacenado por extensión de archivo controlada por el cliente
**Archivos:** `backend/src/common/storage/storage.service.ts:28`, `backend/src/modules/atracciones/catalogo.controller.ts:214-223`

```ts
// storage.service.ts:28 — la extensión sale del NOMBRE que envía el cliente
const name = `${randomUUID()}${extname(file.originalname).toLowerCase() || '.jpg'}`;
// catalogo.controller.ts:219 — el filtro solo mira el mimetype DECLARADO
fileFilter: (_, file, cb) => /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(...)
```

Subir un archivo con `Content-Type: image/jpeg` y nombre `x.html` produce `/uploads/<uuid>.html`. En desarrollo (`storage.service.ts:43-46`) Express lo sirve como `text/html` por extensión: es **XSS almacenado servido desde el dominio de la propia API**, ejecutándose con la sesión del panel si el navegador lo interpreta. Un `.svg` con JavaScript embebido es el caso típico. El `mimetype` de Multer también es el declarado por el cliente, nunca verificado contra los bytes reales.

**Corrección:** derivar la extensión del `mimetype` ya validado (`image/jpeg → .jpg`), nunca del nombre; validar los *magic bytes* con `file-type`; y servir el bucket desde un dominio separado o con `Content-Disposition: attachment`.

### 🟠 SEG-008 — Bucket de Supabase tratado como público, con clave `service_role`
**Archivo:** `backend/src/common/storage/storage.service.ts:30-41`

El servicio construye `…/storage/v1/object/public/…` y lo devuelve al cliente, usando la clave `service_role`, que salta RLS por completo. Si el bucket es público (configuración por defecto en Supabase), cualquiera que conozca la URL puede leer las imágenes; y la `service_role` es exactamente la clave que un atacante intentaría robar, ya que otorga control administrativo completo del proyecto Supabase.

**Corrección:** bucket privado + *signed URLs* con caducidad de minutos, generadas bajo demanda; validar en el arranque que la clave usada no sea la `anon`.

### 🟠 SEG-009 — Desactivar un usuario no invalida su token (8 h de acceso persistente)
**Archivos:** `backend/src/common/auth/jwt-auth.guard.ts:27`, `backend/src/common/common.module.ts:20`

`req.user = await this.jwt.verifyAsync(token)` es la única comprobación: no hay consulta a `usuarios`, ni lista de revocación, ni verificación de `activo` ni del rol real.

**Impacto:** `PATCH /usuarios/:id { activo: false }` desactiva la cuenta, pero el token sigue siendo criptográficamente válido durante las **8 h** de `JWT_EXPIRES_IN` y conserva todos sus scopes. Un empleado desactivado —o cuya cuenta fue comprometida y desactivada— mantiene acceso total.

**Corrección:** validar `activo` y rol contra la BD en cada petición (con caché de pocos segundos para no castigar la latencia), emitir tokens de 15-30 min y añadir *refresh token* rotativo persistido.

### 🟠 SEG-010 — `SUPABASE_SERVICE_ROLE_KEY` es un marcador sin reemplazar
**Archivos:** `backend/.env.vercel:10`, `backend/.env.production:6`

El valor ocupa 41 caracteres y **no es un JWT** (un `service_role` real supera los 180 caracteres y tiene tres segmentos separados por dos puntos).

**Impacto:** `StorageService` entra en la rama de Supabase en cuanto detecta la variable (`storage.service.ts:30`), el `fetch` recibe 401, y **cada** intento de subida produce un 500. El panel de administración no puede cargar imágenes en producción.

**Corrección:** pegar la clave real y añadir en `StorageService` una validación de formato al arrancar que corte el despliegue con un error claro si el valor no parece una clave válida.

### 🟠 SEG-011 — Privilegios derivados del claim `scope` del propio JWT
**Archivos:** `backend/src/modules/atracciones/catalogo.controller.ts:41`, `atracciones.controller.ts:41`

```ts
const canWrite = (u?: AuthUser) => !!u?.scope?.includes(SCOPES.WRITE);
const verTodo = (q, u) => q.all === 'true' && !!u?.scope?.includes(SCOPES.WRITE);
```
La decisión de privilegio sale del claim firmado, no del estado real en la base de datos. Combinado con SEG-003 (secreto por defecto) o con un token filtrado, un atacante se autoproclama `attractions:write` y gana creación/edición/borrado del catálogo, subida de imágenes, moderación de reseñas y visibilidad de registros inactivos, **sin tocar la base de datos**.

**Corrección:** resolver el rol desde `usuarios` en cada petición administrativa y comparar con el rol real, no solo con el scope firmado.

### 🟠 SEG-012 — Sin migraciones + `synchronize` implícito (véase también DAT-001)
**Archivo:** `backend/src/app.module.ts:33`

```ts
synchronize: sync ? sync === 'true' : configService.get<string>('NODE_ENV') !== 'production',
```
Si `DB_SYNC` no está definido y `NODE_ENV` no es exactamente `'production'`, TypeORM **modifica el esquema real** en cada arranque. Con `autoLoadEntities: true` y entidades con `@DeleteDateColumn`, puede aplicar `ALTER TABLE`, crear índices o truncar columnas, sin migración, sin revisión y sin reversión.

**Corrección:** `synchronize: false` incondicional + migraciones reales (ver DAT-001).

### 🟠 SEG-013 — PII duplicada en `idempotency_records`, sin caducidad
**Archivo:** `backend/src/common/idempotency/idempotency-record.entity.ts:19-26`

`responseBody` es `jsonb` y almacena la reserva completa, incluidos `clienteNombre`, `clienteEmail`, `clienteTelefono`, `clienteDocumento` y `motivoCancelacion` (`atraccion.mapper.ts:118-128`). No hay `expiresAt` ni tarea de purga.

**Impacto:** (a) la tabla crece de forma indefinida; (b) se crea una **copia de la PII de todas las reservas** con una base legal de conservación distinta de la de la tabla `reservas` y sin mecanismo de borrado; (c) con `SEED_ON_START` desactivado y volumen real, es la tabla más grande de la base.

**Corrección:** `expiresAt` a 24-48 h con job de borrado, o almacenar solo un hash de la respuesta y reconstruirla desde la reserva.

### 🟠 SEG-014 — Login sin throttling, con credenciales de demo publicadas
**Archivo:** `backend/src/modules/auth/auth.service.ts:48-61`; `README.md:37-39`

El mensaje de error **es correcto** (no distingue usuario inexistente de contraseña incorrecta), pero no mitiga la fuerza bruta. Las credenciales de los tres roles de prueba están en el README del repositorio.

**Corrección:** throttling por IP + email con bloqueo progresivo y notificación al titular; marcar esas cuentas como «solo demo» y forzar cambio de contraseña en el primer inicio de sesión.

### 🟠 SEG-015 — `Object.assign` sin *whitelist* explícita en la actualización de usuarios
**Archivo:** `backend/src/modules/auth/auth.service.ts:113-115`

```ts
const { password, ...rest } = dto;
Object.assign(u, rest);
```
`UpdateUsuarioDto` hereda de `PartialType(CreateUsuarioDto)`, que incluye `email`. Dos consecuencias: (a) cambiar el email de otro usuario choca con la restricción `unique` y produce un `QueryFailedError` traducido a un 409 genérico «Registro duplicado», no a un mensaje útil; (b) cualquier campo nuevo que se añada al DTO se escribe automáticamente, sin revisión.

**Corrección:** construir el objeto de actualización campo por campo y validar la unicidad del email antes de guardar.

## 3.3 P2/P3 — Medios y bajos

| ID | Sev. | Ubicación | Hallazgo | Corrección |
|---|:-:|---|---|---|
| **SEG-016** | P2 | `auth.controller.ts:14-20` | `/auth/register` público, sin throttling, sin verificación de correo y con 409 que permite enumerar correos | Throttling por IP + verificación de correo antes de permitir reservar |
| **SEG-017** | P2 | `auth.service.ts:110-112` | La única protección anti-auto-degradación es `id === actorId`: un ADMIN puede desactivar al otro ADMIN, sin registro y sin impedir que el sistema se quede sin ningún ADMIN activo | Confirmación explícita + entrada de auditoría + bloquear el estado «cero ADMIN» |
| **SEG-018** | P2 | `nested-types.dto.ts:17-21` | `PhotoDto.url` es solo `@IsString()`: admite `javascript:`, `data:` y hosts externos. Si el frontend lo renderiza como `href`, es XSS; como imagen externa, fuga de IP | `@IsUrl({ protocols: ['http','https'], require_protocol: true })` + lista blanca de hosts |
| **SEG-019** | P2 | `app.factory.ts:53` | Swagger UI montado **también en producción**, con JS/CSS de un CDN de terceros: publica el inventario completo de la API | Montar solo si `ENABLE_DOCS === 'true'`, y servir los assets desde `node_modules` |
| **SEG-020** | P2 | `app.factory.ts:21-24` | CORS sin `methods`, sin `maxAge` y con la lista de orígenes sin validar | `methods`, `maxAge: 86400`, `allowedHeaders`, y validación de orígenes en el arranque |
| **SEG-021** | P2 | `app.factory.ts:17` | Sin `trust proxy`: detrás del proxy de Vercel, `req.ip` y `req.protocol` reportarán el proxy, lo que hace inservible cualquier rate limiting por IP y falsea los logs | `app.set('trust proxy', 1)` |
| **SEG-022** | P2 | `search-atracciones.dto.ts:119-127`, `create-atraccion.dto.ts:61-93` | Ningún array de entrada tiene `@ArrayMaxSize` (`cities`, `categories`, `badges`, `photos`…) | `@ArrayMaxSize(...)` en todos, y límite del tamaño del body < 100 kB |
| **SEG-023** | P2 | `Checkout.jsx:253-263` | Se usan tokens `autoComplete="cc-number"`, `cc-exp`, `cc-csc` y `cc-name` en un formulario de pago **simulado** | Usar `autoComplete="off"` en los campos simulados, para que el navegador no ofrezca ni guarde tarjetas reales del usuario |
| **SEG-024** | P3 | `auth.service.ts:19` | `toPublic` filtra por destructuring sobre `any`: si mañana se añade `mfaSecret` o `tokenRecuperacion`, se filtrarán automáticamente sin que ninguna revisión lo detecte | Mapear explícitamente las columnas públicas |
| **SEG-025** | P3 | `app.factory.ts:27` | `useStaticAssets` sin `dotfiles: 'deny'` ni `index: false`: cualquier archivo dejado en `public/` se publica con 7 días de caché | `{ dotfiles: 'deny', index: false }` |

### Verificaciones de seguridad **negativas** (comprobado y no encontrado)

- ✅ **Ninguna inyección SQL**, ni siquiera en el SQL crudo de `catalogo.service.ts:26-31,61-64` (usa `$1` parametrizado).
- ✅ **Ningún `ORDER BY` dinámico vulnerable** (se resuelve con un `switch` cerrado).
- ✅ **Path traversal imposible** en la subida: el nombre se genera con `randomUUID()`.
- ✅ **Mass assignment bloqueado** por `forbidNonWhitelisted: true`.
- ✅ **Sin CORS `origin: '*'`**: la lista viene de `FRONTEND_URL`.
- ✅ **Sin tokens en query strings ni en enlaces**.
- ✅ **Sin MD5/SHA1 para contraseñas** (bcrypt).
- ✅ **Secretos fuera del historial de Git** (verificado con `git ls-files`).
- ✅ **Los datos de tarjeta nunca llegan al backend**: el frontend solo envía `metodo` (`Checkout.jsx`); no hay exposición PCI.
- ✅ **Honeypot anti-spam** en el formulario de contacto, que devuelve éxito sin persistir y no filtra el dato al cliente.

---

# 4. API REST Y CONTRATO OPENAPI

## 4.1 Cumplimiento del contrato `contracts/atracciones-openapi.yaml`

| Aspecto | Estado | Nota |
|---|:-:|---|
| Prefijo `/api/v1` | ✅ | `app.factory.ts:19` |
| Swagger en `/api/docs` | ✅ |aunque con los problemas de SEG-019 |
| UUIDs en todas las entidades | ✅ | Verificado en las 7 entidades |
| `Idempotency-Key` en operaciones transaccionales | ✅ | Con la salvedad de CON-001 |
| Errores RFC 7807 (`application/problem+json`) | ✅ | `problem-details.filter.ts:78-81` |
| HATEOAS (`_links`) | ✅ | Con la ambigüedad de API-013 |
| Scopes OAuth2 | 🟠 | Faltan 3 scopes en el contrato (API-006) |
| Códigos HTTP | ✅ | 201+`Location`, 204, 200, 409, 404 — todos correctos |
| Cabeceras `X-API-Deprecation-Date`, `Cache-Control` | ✅ | `atracciones.controller.ts:144-145` |
| Rutas del contrato implementadas | ✅ | Las 8 del contrato existen |
| Documentación fiel a la implementación | 🔴 | 7 desviaciones (API-002 a API-008) |

## 4.2 Hallazgos

### API-001 — `attraction_id` como string produce **500** en vez de 400
**Severidad P1** · `dto/reservation.dto.ts:161-164` → `reservas.service.ts:148`

```ts
qb.andWhere('a.id = :aid', { aid: query.attraction_id });   // contra una columna uuid
```
`@IsString()` permite `?attraction_id=abc`. Postgres lanza `invalid input syntax for type uuid` (SQLSTATE 22P02). `ProblemDetailsFilter` solo traduce el código `23505` (`problem-details.filter.ts:61`), así que el error cae en la rama genérica: **HTTP 500** con «Ocurrió un error inesperado» en lugar de un 400. Bug reproducible.
**Corrección:** `@IsUUID('4', { message: 'attraction_id debe ser un UUID' })`.

### API-002 — `search` y `details` son públicos, pero el contrato exige `attractions:read`
**P2** · contrato `:43-45, :104-106` vs `atracciones.controller.ts:58-73`
Los dos handlers no aplican ningún guard, pero el contrato declara `security: - OAuth2Security: [attractions:read]`. La implementación es **más permisiva** que el contrato: cuando se conecte un API Gateway que sí exija el scope, ambas rutas empezarán a devolver 401 y el frontend tendrá que reautenticarse.
**Corrección:** decidir explícitamente si son públicas y reflejarlo en el contrato (quitar `security`), o añadir el guard.

### API-003 — El path `/atracciones/{id}` está declarado **dos veces** en el contrato
**P2** · contrato `:160-266` y `:383-460`
La primera definición incluye `get`, `put`, `patch` y `delete`; la segunda vuelve a declarar `put`, `patch` y `delete`. Además, dentro del primer bloque, `summary` aparece duplicado en `get` (líneas 162 y 168).
**Impacto:** documento OpenAPI ambiguo: validadores estrictos lo rechazan y los generadores de cliente pueden duplicar operaciones o descartarlas en silencio. Cualquier prueba de conformidad tendrá un resultado no determinista.
**Corrección:** eliminar el bloque duplicado (líneas 383-460) y la clave `summary` repetida.

### API-004 — El contrato exige un scope que él mismo no define
**P2** · contrato `:348-350` vs `:515-519`
`POST /atracciones/reservations/{id}/cancel` exige `attractions:cancel`, pero `securitySchemes.OAuth2Security` solo declara `attractions:read`, `book`, `write` y `webhooks`. Faltan también `attractions:manage` y `admin:full`, que el código **sí** usa (`scopes.ts:13,15`).
**Impacto:** un Authorization Server implementado a partir de este YAML no podría emitir ni validar esos scopes; la reserva sería rechazada en la integración real.
**Corrección:** completar la lista de scopes en el contrato.

### API-005 — `details` no devuelve `metadata` e **ignora** `languages`
**P2** · `atracciones.service.ts:125-133`; `dto/details-request.dto.ts:10-14`
El contrato declara `SearchAtraccionesResponse`, que incluye `metadata.total_results` y `next_page`. Además, `DetailsRequest.languages` se acepta en el DTO y **no se usa en ninguna parte**: quien solicite las fichas en `languages: ['en']` recibe exactamente el mismo contenido en español, creyendo que la API lo soportó. Es el incumplimiento funcional más silencioso del contrato.
**Corrección:** devolver `metadata` y/o implementar el filtrado por idioma; si no se va a implementar, eliminar `languages` del contrato y del DTO.

### API-006 — `UpdateAtraccionRequest` es un objeto vacío
**P3** · contrato `:744-746`
Es `type: object` sin propiedades. El DTO real (`update-atraccion.dto.ts`, `PartialType(CreateAtraccionDto)`) admite ~20 campos.
**Impacto:** los clientes generados no saben qué pueden enviar en `PATCH`, lo que empuja al uso de `PUT` completo y a la pérdida de datos parciales.

### API-007 — El listado documenta 2 parámetros y acepta 8
**P3** · contrato `:107-117` vs `dto/list-atracciones.dto.ts`
Documentados solo `limit`/`offset`; la implementación acepta además `page`, `q`, `category`, `city`, `featured` y `status`. Los filtros más usados por el frontend no son descubribles desde el contrato.

### API-008 — Tres fuentes de versión distintas
**P3** · `backend/package.json:3` (`1.0.0`), `app.factory.ts:47` (`1.2.0`), contrato `:18` (`1.2.0`)

### API-009 — `q` sin longitud máxima con comodines `ILIKE` sin escapar
**P2** · `dto/reservation.dto.ts:156-159` → `reservas.service.ts:149-152`
Sin `@MaxLength` y con `%${q}%` sin escapar. Un texto de miles de caracteres fuerza un seq scan con `LEFT JOIN`; y como `%` y `_` no se escapan, un cliente puede pasar `?q=%25` y obtener el **100 % de las reservas** — endpoint que, combinado con SEG-004, ya está abierto.
**Corrección:** `@MaxLength(120)`, escapar `\`, `%` y `_`, e índice `GIN` con `pg_trgm` sobre `codigo`, `clienteNombre` y `clienteEmail`.

### API-010 — `filters.query` sin longitud máxima
**P2** · `dto/search-atracciones.dto.ts:62-65` → `atracciones.service.ts:60-64`
`ILIKE` sobre 4 columnas en el **endpoint público más caro** de la API, sin throttling.
**Corrección:** `@MaxLength(120)` + índice trigram. (Las filas ya están limitadas a 100.)

### API-011 — `children` sin cota máxima
**P2** · `dto/reservation.dto.ts:50-54`
`@IsInt() @Min(0)` sin `@Max`. La regla de negocio se aplica tarde, dentro de la transacción y con el lock tomado (`reservas.service.ts:76`).
**Corrección:** `@Max(30, { message: 'children no puede superar 30' })`.

### API-012 — `duration` valida formato ISO pero no rango
**P2** · `dto/create-atraccion.dto.ts:41-44`
`@Matches(/^PT(\d+H)?(\d+M)?$/)` acepta `PT99999H`, que queda persistida y contamina los filtros por duración.
**Corrección:** validar `0 < horas ≤ 24` con un validador custom o un rango explícito.

### API-013 — Ambigüedad en la resolución de los `_links` HATEOAS
**P3** · `app.factory.ts:19,53` + `common/utils/hateoas.ts:1,8` + contrato `:23`
El contrato declara `servers: [{ url: /api/v1 }]` con paths sin prefijo, mientras que `link()` ya antepone `/api/v1`. Un cliente que resuelva los `_links` de forma relativa compondrá `/api/v1/api/v1/atracciones/<id>`.
**Corrección:** documentar que los `_links` son absolutos respecto al host, o emitir rutas relativas al `servers.url`.

### API-014 — `codigo` de operador con `MAX+1` sin transacción
**P2** · `catalogo.service.ts:124-132`
Dos altas concurrentes leen el mismo máximo y generan el mismo código; como `operadores.codigo` es `unique`, la segunda recibe un 409 «Ya existe un operador con el código N» que es un **falso positivo**: el cliente no ha creado nada y no sabe que debe reintentar.
**Corrección:** usar una secuencia de Postgres (`SERIAL`) o `SELECT ... FOR UPDATE` en transacción.

---

# 5. DATOS Y PERSISTENCIA

### 🔴 DAT-001 — No hay migraciones; el esquema depende de `synchronize`
**P0** · `app.module.ts:31` y ausencia del directorio `migrations/`
No existe carpeta de migraciones, ni `typeorm.config`, ni scripts de migración en `package.json:8-16`. Todo el esquema (11 tablas) se crea y se altera exclusivamente por `synchronize`.
**Impacto:** no hay forma de desplegar un cambio de esquema de forma reproducible entre entornos ni de revertirlo. Es el obstáculo principal para la migración a microservicios que el propio repositorio propone.
**Corrección:**
```bash
npx typeorm migration:generate src/migrations/Inicial -d src/data-source.ts
npx typeorm migration:run -d src/data-source.ts
```
y `migration:run` en el pipeline de Vercel **antes** del arranque.

### 🟠 DAT-002 — `idempotencyKey` único a nivel de tabla, no por operación
**P2** · `entities/reserva.entity.ts:87-88`
El servicio ya cualifica la operación (`reserve:${id}`, `cancel:${id}`, `confirm:${id}` en `reservas.service.ts:44,172,192`), pero la restricción `unique` no lo refleja. Hoy no rompe porque las claves son UUID distintos, pero impone una restricción más fuerte de la necesaria.
**Corrección:** índice no único, o mover la unicidad a `idempotency_records` con el par `(key, operacion)`.

### 🟠 DAT-003 — La PK de `idempotency_records` es solo `key`
**P2** · `idempotency-record.entity.ts:10-11`
No registra `usuarioId` ni `operacion` en la clave. Dos usuarios distintos que reutilicen la misma clave UUID (por ejemplo, un frontend que la derive de la hora en milisegundos) entran en conflicto: el segundo recibe **la respuesta guardada del primero** (`idempotency.service.ts:33`), que incluye nombre, email, teléfono y documento de otro cliente.
**Corrección:** componer la clave como `(usuarioId, operacion, key)` y usar esa combinación como PK.

### 🟠 DAT-004 — 7 campos en `simple-json`, incluidos los horarios
**P2** · `entities/atraccion.entity.ts:69-89`
`fotos`, `incluye`, `noIncluye`, `recomendaciones`, `insignias`, `idiomas` y **`horarios`** son `simple-json`. `horarios` se deserializa en **cada** cálculo de disponibilidad y en **cada** validación de reserva.
**Impacto:** no indexables ni consultables por contenido; sin validación de formato a nivel de esquema (un `horarios` con `"25:00"` llega hasta `atracciones.service.ts:70`).
**Corrección:** normalizar `horarios` a `atracciones_horarios(atraccion_id, hora, activo)` con `@Check`, e `incluye/not_incluye` a una tabla de ítems.

### 🟠 DAT-005 — SQL crudo acoplado a los nombres de tabla del `@JoinTable`
**P2** · `atracciones.service.ts:43-49`, `reportes.service.ts:98-102`, `catalogo.service.ts:26-31,61-64`
Escriben a mano los nombres que genera `atraccion.entity.ts:118-122` (`atracciones_categorias`, `atraccion_id`, `categoria_id`).
**Impacto:** son correctos hoy, pero crean un acoplamiento invisible: si se renombra el `@JoinTable`, el código **sigue compilando** (TypeScript no valida SQL) y falla en producción con `relation "atracciones_categorias" does not exist` — un 500 en los filtros de búsqueda y en los reportes de ventas, los dos endpoints más usados del panel.
**Corrección:** QueryBuilder con relaciones (`innerJoin(Atraccion.categorias, ...)`).

### 🟠 DAT-006 — Detalle de ventas sin paginar, con email del cliente
**P2** · `reportes.service.ts:110`
`getMany()` sin `skip`/`take` devuelve código, fecha, atracción, ciudad, adultos, niños, total, estado, método de pago, nombre y **email** del cliente de todas las reservas del rango.
**Impacto:** la respuesta puede alcanzar varios megabytes, se construye completa en memoria, y concentra la PII de la base de clientes en un único endpoint.
**Corrección:** paginar el detalle, mover el email a una vista de exportación separada y añadir caché de vida corta para los agregados.

### 🟡 DAT-007 — 4 relaciones `eager: true` en toda consulta
**P3** · `reserva.entity.ts:22`, `atraccion.entity.ts:111-117`
Cualquier `find()` carga siempre cuatro joins adicionales, incluso en listados paginados. `CatalogoService` tiene que escribir SQL a mano justamente para eludirlo.
**Corrección:** eliminar `eager` y declarar `leftJoinAndSelect` explícito donde haga falta.

### 🟡 DAT-008 — Truncamiento silencioso del historial de reservas
**P3** · `reservas.service.ts:130-136`
`.take(500)` fijo, sin `meta.totalItems`, y la respuesta es un array plano (a diferencia del resto de listados, que usan `paginate`). Un cliente con más de 500 reservas no tiene forma de saberlo.
**Corrección:** migrar a `PaginatedResponseDto`.

### 🟡 DAT-009 — `GET /usuarios` sin paginación
**P2** · `auth.service.ts:83-91`
`this.usuarios.find({ where, order })` sin `skip`/`take` devuelve la tabla completa con nombre, email y teléfono.
**Corrección:** extender `PaginationQueryDto` y devolver `PaginatedResponseDto`.

### 🟡 DAT-010 — `statusCode: 200` fijo en la idempotencia
**P2** · `idempotency.service.ts:37`
`POST /atracciones/:id/reservations` responde **201** (`atracciones.controller.ts:263`) y un `PUT` responde 204. El registro miente, y el `statusCode` almacenado **nunca se lee** (línea 33): es un campo muerto que induce a pensar que existe una reproducción de estado que en realidad no existe.
**Corrección:** eliminarlo, o derivarlo y reproducirlo en las ejecuciones repetidas.

---

# 6. CONCURRENCIA E IDEMPOTENCIA

### 🔴 CON-001 — La clave de idempotencia no se reserva antes de ejecutar (carrera)
**P1** · `idempotency.service.ts:20-39`

```ts
const existing = await this.repo.findOne({ where: { key } });
if (existing) { /* ... */ }
const result = await fn();                              // ← se ejecuta SIN reservar
await this.repo.save(this.repo.create({ key, ... }));   // ← reserva DESPUÉS
```

**Impacto:** dos peticiones concurrentes con la misma `Idempotency-Key` —un doble clic, un reintento del cliente, o **dos réplicas serverless en paralelo, que es el caso normal en Vercel**— pasan ambas el `findOne` y ejecutan `fn()`. Ambas crean una reserva y consumen cupo; la segunda falla al insertar por la PK, y el filtro traduce el `23505` a un 409 «Registro duplicado». El cliente cree que su reserva se perdió cuando en realidad **se creó dos veces** — y en un flujo con pago, el cobro se duplica.

La promesa central del contrato (`atracciones-openapi.yaml:14-15`: «evitar reservas o cancelaciones duplicadas») **no se cumple bajo concurrencia**.

**Corrección — *claiming* atómico antes de ejecutar:**
```sql
INSERT INTO idempotency_records (key, operacion, request_hash, status)
VALUES ($1,$2,$3,'in_progress')
ON CONFLICT DO NOTHING;
-- si no se insertó: leer con FOR UPDATE y devolver la respuesta almacenada
-- o un 409 «operación en curso»
```

### 🔴 CON-002 — Dentro de la transacción se lee la atracción con el repositorio **global**
**P1** · `reservas.service.ts:55`

```ts
const a = await manager.getRepository(Atraccion)          // ← con pessimistic_write, DENTRO de la transacción
  .createQueryBuilder('a').setLock('pessimistic_write')...
const full = await this.atraccionesService.getEntity(atraccionId);  // ← repositorio GLOBAL, FUERA
```

`getEntity` usa el repositorio global de `AtraccionesService` (`atracciones.service.ts:168`), es decir, **una conexión distinta** de la transacción en curso. Tres consecuencias:
1. La lectura **no respeta el bloqueo recién adquirido** → puede leer datos obsoletos.
2. No forma parte del snapshot transaccional → `atraccion` pudo cambiar entre la lectura bloqueada y la real.
3. **La entidad leída es la que se persiste en la reserva** (línea 101), de modo que la reserva puede guardar un `precioTicket` distinto del que se usó para calcular el `total` (línea 91), que sí viene de la lectura bloqueada.

Es una inconsistencia precio/total bajo concurrencia, y además mantiene el lock abierto durante una consulta externa a la transacción.

**Corrección:** leer con `manager.getRepository(Atraccion)` y derivar precio, cupo y horarios de esa misma lectura.

### 🔴 CON-003 — `cancel` y `confirm` mutan fuera de transacción, sin `FOR UPDATE`
**P1** · `reservas.service.ts:171-201`
Reciben la entidad con `findOne` (línea 157, sin `FOR UPDATE`), la mutan en memoria y hacen `save`, todo fuera de `dataSource.transaction`.

**Impacto:** dos cancelaciones simultáneas pasan ambas la comprobación `r.estado === CANCELLED` (línea 174) y ambas escriben, con la segunda pisando `motivoCancelacion` y `canceladaEn` de la primera. Peor: un `cancel` y un `confirm` concurrentes sobre la misma reserva pueden dejar un estado incoherente (`CANCELLED` sin `confirmadaEn`, o el motivo de un operador aplicado sobre una reserva confirmada). El cliente que recibe el 200 de una operación cree que el estado final es el suyo.

**Corrección:** envolver ambas en `dataSource.transaction` con `SELECT ... FOR UPDATE` sobre la reserva antes de comprobar y mutar el estado.

### 🟠 CON-004 — Código de reserva con *read-then-write* sin ajuste al índice único
**P2** · `reservas.service.ts:94-96`
```ts
let codigo = this.generarCodigo();
while (await repo.exist({ where: { codigo } })) codigo = this.generarCodigo();
```
El alfabeto de 32 caracteres excluye `0/O/1/I` y da ~1,07 mil millones de combinaciones, así que hoy el riesgo es **bajo**. Pero el patrón no está protegido: si dos reservas concurrentes colisionaran, la segunda recibiría un 409 «Registro duplicado» en lugar de reintentar, y el cliente perdería la reserva sin saber que fue un choque de códigos.
**Corrección:** intentar el `insert` y reintentar con código nuevo ante `23505`, dejando la restricción `unique` como único árbitro.

### ✅ Lo que sí está bien en concurrencia
- El bloqueo pesimista de escritura sobre la atracción **sí** serializa reservas concurrentes del mismo tour (`reservas.service.ts:47-53`).
- La verificación de cupos por horario **excluye canceladas** y se hace dentro de la transacción, con el lock tomado antes de leer los ocupados (`reservas.service.ts:80-88`, `atracciones.service.ts:281`).
- Existen índices funcionales en `reservas (atraccion, fecha, hora)` y `reservas.usuarioId` (`reserva.entity.ts:13,30`), exactamente en los accesos más frecuentes.

---

# 7. FRONTEND: RENDIMIENTO, SEO Y ARQUITECTURA

| ID | Sev. | Ubicación | Hallazgo | Corrección |
|---|:-:|---|---|---|
| **WEB-001** | P2 | `index.html:1-18` | **Sin metadatos de Open Graph ni Twitter Card.** Para un sitio de reservas turismo en Ecuador, esto destruye el valor de cualquier compartir en redes (que es el canal principal de descubrimiento del sector) | Añadir `og:title`, `og:description`, `og:image` (la foto del hero ya existe), `og:url`, `og:locale=es_EC` y `twitter:card=summary_large_image` |
| **WEB-002** | P2 | `index.html:1-18` | **Sin `canonical`**, sin `robots.txt`, sin `sitemap.xml`, sin `manifest.json` | Añadir `<link rel="canonical">`, y los ficheros correspondientes |
| **WEB-003** | P2 | `pages/*.jsx` | **Sin SSR/SSG ni pre-renderizado.** Es una SPA pura: los buscadores no indexan contenido, no hay datos estructurados, y el LCP depende de un triple salto de red (HTML → JS → API) | Si el SEO es un requisito de la rúbrica: `vite-plugin-ssg` o migrar a Next.js. Si no: documentarlo como decisión consciente |
| **WEB-004** | P2 | `src/styles/*` | **Sin *code splitting* de CSS.** `base.css`, `components.css`, `public.css` y `admin.css` (≈1.700 líneas) se importan todos en el bundle inicial | `import './admin.css'` dentro de los módulos `lazy()` del panel |
| **WEB-005** | P2 | `index.html:11` | **Google Fonts bloquea el render** (`<link rel="stylesheet">` sin `media="print" onload`), en un sitio que se presenta como optimizado | `preconnect` ya está; añadir `font-display: swap` en la URL y `rel="preload" as="style"` |
| **WEB-006** | P2 | 12 etiquetas `<img>` | **6 de 12 imágenes sin `loading="lazy"`** (`Checkout.jsx:146`, `MyReservations.jsx:145`, `AttractionDetail.jsx:29,141`, `AtraccionForm.jsx:312`, `CatalogAdmin.jsx:181,213`) | Añadir `loading="lazy"` y `decoding="async"` a las que están fuera del viewport inicial |
| **WEB-007** | P2 | `App.jsx:5-11` | Las **7 páginas públicas están en el bundle inicial**; solo el panel está partido. `/explorar`, `/atraccion/:id`, `/reservar/:id` y `/mis-reservas` son las de mayor peso y ninguna se carga bajo demanda | `lazy()` para `AttractionDetail`, `Checkout`, `MyReservations`, `MiscPages` |
| **WEB-008** | P2 | `api/client.js:2,41` | **Token JWT en `localStorage`.** vulnerable a XSS; no es envuelto en `HttpOnly` | Migrar a cookie `httpOnly; secure; sameSite=strict` (requiere CSRF token del lado del servidor). Aceptable para el prototipo, **debe documentarse como deuda técnica** |
| **WEB-009** | P3 | `admin/excel.js` + `package.json:17` | `xlsx` se importa desde una **URL de CDN en el `package.json`** (`https://cdn.sheetjs.com/...tgz`). La versión está fijada, pero la instalación depende de la red y de un tercero | Vendorizar el paquete o documentar el motivo (la versión `0.20.3` ya no está en npm público) |
| **WEB-010** | P3 | `useAsync` (`ui.jsx:23-36`) | El array de dependencias es `[...deps, tick]` con `eslint-disable` explícito: cualquier dependencia transitiva olvidada produce una **stale closure** silenciosa. Hay un `// eslint-disable-next-line react-hooks/exhaustive-deps` en 3 sitios | Preferir `useCallback` con dependencias explícitas, o migrar a SWR/React Query |
| **WEB-011** | P3 | `api/client.js:38-73` | **No hay reintento con backoff** ante fallos de red ni ante respuestas 5xx transitorios | Envolver con un reintento exponencial para peticiones idempotentes (GET) |
| **WEB-012** | P3 | `ConfirmProvider` (`ui.jsx:105-133`) | **`document.body.style.overflow` se restaura solo cuando no queda ningún modal en la pila.** Si `onClose` lanza o el componente se desmonta con modales abiertos, el `overflow: hidden` queda pegado y el documento deja de hacer scroll | `finally` en el cleanup del `useEffect` del `Modal` |
| **WEB-013** | P3 | `AttractionCard.jsx`, `Home.jsx` | Falta `decoding="async"` y, en `Home.jsx:134,156`, `width`/`height` en imágenes de tarjeta (aunque el `aspect-ratio` del contenedor mitiga CLS) | Añadir dimensiones explícitas |
| **WEB-014** | P3 | `ui.jsx:170` | `<Spinner role="status" aria-label="Cargando" />` sin texto visible: un sighted usuario con carga lenta no tiene ninguna señal más que la animación | Añadir texto «Cargando…» visible junto al spinner |

### Lo que sí cumple bien en el frontend

- ✅ **`document.title` dinámico y correcto** en cada ruta mediante `usePageTitle` (`ui.jsx:7-11`) y en el panel (`AdminLayout.jsx:117`).
- ✅ **`lang="es"`** declarado en `index.html:2` y **todo el contenido en español de Ecuador** (criterio 3.1.1).
- ✅ **`<meta name="description">`** presente y bien redactado.
- ✅ **Toasts con `role="region"` + `aria-label`**, y `role="alert"` para errores / `role="status"` para el resto (`ToastContext.jsx:29-33`): patrón correcto.
- ✅ **Manejo de sesión expirada** con evento global `auth:expired` y aviso al usuario (`AuthContext.jsx:30-38`, `client.js:63`).
- ✅ **Sin `console.log` ni `console.debug`** en todo `frontend/src`.
- ✅ **`useAsync` con estado `alive`** que evita el *setState* tras desmontar, y botón «Reintentar» en todos los estados de error (criterio 3.3.4).
- ✅ **Atajo `/` para enfocar el buscador** cuando el foco está en un campo de texto (`App.jsx:29-41`).
- ✅ **Filtros de Explorar reflejados en la URL**, por lo que son compartibles (criterio de usabilidad, no de accesibilidad).

---

# 8. DESPLIEGUE Y OPERACIÓN

| ID | Sev. | Ubicación | Hallazgo | Corrección |
|---|:-:|---|---|---|
| **OPS-001** | P1 | `backend/api/index.js:3` | El `require('../dist/app.factory')` está a **nivel de módulo, fuera del `try`** (líneas 19-41). Si `npm run build` falla o `dist/` no está en el paquete, el `require` lanza durante la carga del módulo y Vercel devuelve un **500 genérico**, no el cuerpo `application/problem+json` que el propio archivo construye | Mover el `require` dentro de `bootstrap()`, dentro del `try`, y devolver 503 |
| **OPS-002** | P1 | `backend/vercel.json:5-9` + `app.module.ts:36-37` | `maxDuration: 60` con un pool propio de 3 conexiones **por instancia**. Con el *transaction pooler* de Supabase (puerto 6543, correctamente usado), el límite es **por proyecto**: con N instancias, 3N conexiones. Un pico de tráfico agota el pool → 503 en toda la API, que `retryAttempts: 1` en producción convierte en error inmediato sin reintento | Bajar `DB_POOL_MAX` a 1-2, o usar el *session pooler*, o un `pgbouncer` externo. Documentar el cálculo frente al plan contratado |
| **OPS-003** | P2 | `backend/vercel.json:9` | El catch-all `/(.*)` → `/api` **también captura `/uploads/*` y `/img/*`**. En Vercel el sistema de archivos es de solo lectura y efímero: `StorageService` intentaría escribir en `public/uploads` y fallaría | Excluir explícitamente `/img` y `/uploads` del `rewrite` |
| **OPS-004** | P2 | `api/index.js:7-17`, `main.ts:3-6` | **Sin hooks de cierre ordenado**: `main.ts` no llama a `app.enableShutdownHooks()` y no hay `onModuleDestroy`. Un `SIGTERM` corta las conexiones de Postgres a mitad de una transacción de reserva | `app.enableShutdownHooks()` en `main.ts` y manejo explícito de la señal en el entrypoint serverless |
| **OPS-005** | P2 | `problem-details.filter.ts:70`, `api/index.js:25` | **Sin logger estructurado** (ni `pino` ni `winston`), sin `request-id` por petición, sin métricas ni trazas. El único registro es `logger.error(exception.stack)`. El `request_id` se genera en `search` y `details` pero **no se devuelve como cabecera** ni se propaga a los logs | Middleware que emita y devuelva `X-Request-Id`, logger JSON con ese identificador, y propagación al `cause` del problem+json |
| **OPS-006** | P2 | `app.module.ts:19` | `envFilePath: '.env'` fijo, sin resolución por `NODE_ENV`. Si un `.env` llegara a existir en el entorno de ejecución, sus variables prevalecerían sobre las del panel y apuntarían a `localhost` | `envFilePath: ['.env.local', '.env.${NODE_ENV}']` + validación en el arranque que rechace `DATABASE_URL` con `localhost` en producción |
| **OPS-007** | P2 | `.env.vercel:7` | El secreto de producción es plausible (64 chars), pero **nada exige que lo sea**: sin longitud mínima ni rechazo de valores de ejemplo. Una regresión silenciosa (alguien copia el valor de `.env.example`) solo se descubre cuando alguien falsifica un token | Validar longitud ≥ 32 y rechazo explícito de los valores de ejemplo (ver SEG-003) |
| **OPS-008** | P3 | `.gitignore:41` | El patrón `.env*` también ocultaría `.env.example`, `.env.template` o `.env.schema` | Usar `.env` y `.env.*` con la excepción `!.env.example` |
| **OPS-009** | P3 | `.env.production:5` | El archivo se conserva en disco tras migrar los secretos al panel de Vercel, manteniendo la referencia del proyecto Supabase | Eliminarlo una vez verificado el despliegue; o vaciar los valores si se conserva como plantilla |

---

# 9. CALIDAD, ARQUITECTURA Y DEVOPS

| ID | Sev. | Ubicación | Hallazgo | Corrección |
|---|:-:|---|---|---|
| **CAL-001** | P1 | `backend/package.json:15` | El script `"lint": "eslint ..."` existe, pero **`eslint` no está en `devDependencies`** ni hay `.eslintrc`/`eslint.config.js`. El comando falla siempre | `npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier` + configuración |
| **CAL-002** | P1 | todo el proyecto | **Cero tests.** No hay un solo archivo `*.spec.*` ni `*.test.*`, ni `jest`/`vitest` en devDependencies, ni script `test`. Para un sistema con pagos, control de cupos e idempotencia, es la brecha de calidad más seria | Empezar por: `IdempotencyService` (CON-001), `reserve` bajo concurrencia (CON-002), `cancel`/`confirm` (CON-003), y los validadores de DTO |
| **CAL-003** | P1 | `backend/tsconfig.json:12-13` | **`strictNullChecks: false` y `noImplicitAny: false`**: TypeScript no está protecting nada. Por eso `api/index.js:18` declara `const server: any`, `catalogo.controller.ts:224` declara `file: any`, y `auth.service.ts:18` hace `u as any` | Subir a `strict: true` de forma incremental (`strictNullChecks` primero) |
| **CAL-004** | P1 | raíz del repositorio | **No hay CI** (no existe `.github/`). Nada ejecuta build, lint, tests ni escaneo de secretos en cada `push` | GitHub Actions: `lint` + `test` + `build` + `gitleaks` + `npm audit` |
| **CAL-005** | P2 | `backend/api/index.js` | **Un archivo JavaScript dentro de un proyecto TypeScript**, con `require`, sin tipos y sin cobertura del tsconfig. Es el *entry point* de producción | Migrar a TS con un tsconfig separado, o documentar la excepción |
| **CAL-006** | P2 | `modules/alojamientos/`, `modules/autos/`, `modules/vuelos/` | ~1.500 líneas de código **inerte** (módulos comentados en `app.module.ts:6-9,51-54`) que siguen compilando y eliminando ruido. `dist/` incluye `alojamientos`, `autos` y `vuelos` completos | Mover a una rama `plantilla/` o eliminarlos del árbol de compilación |
| **CAL-007** | P2 | `dist/` versionado en el árbol de trabajo | El directorio `dist/` completo (~300 archivos `.js` + `.map`) está en el disco. `.gitignore` lo cubre, pero infla búsquedas, IDE y Copies de seguridad | Limpiar y asegurar que `deleteOutDir: true` (ya está en `nest-cli.json`) sea efectivo |
| **CAL-008** | P2 | `README.md:57-72` | El README **declara comportamientos que no se cumplen tal como están**: «Idempotency-Key: la misma clave repite la respuesta» (falso bajo concurrencia, CON-001); «OAuth2 scopes ... validado por `@Scopes()`» (los scopes del contrato están incompletos, API-004); «Concurrencia: bloqueo pesimista ... no se venden más cupos» (la lectura de precio se hace fuera de la transacción, CON-002) | Actualizar el README para que describa el estado real, o corregir el código |
| **CAL-009** | P2 | `README.md:37-41` | **Credenciales de producción en el README.** `admin@descubre-ec.com`/`Admin123` y `operador@descubre-ec.com`/`Operador123` están publicadas en el repositorio. Combinado con la ausencia de rate limiting (SEG-005), son un objetivo trivial | Marcar esas cuentas como solo-demo, forzar cambio de contraseña en el primer login, y añadir throttling |
| **CAL-010** | P2 | `styles/*.css` | **38 declaraciones de `animation`/`transition`** y solo **1** media query `prefers-reduced-motion` (`base.css:161`). La global cubre casi todo, pero las animaciones en JS (scroll suave en `Checkout.jsx:108`, `MiscPages.jsx:111`) no se respeta | Comprobar con `?reduceMotion` y documentar la limitación (2.3.3 es AAA, así que no es incumplimiento) |
| **CAL-011** | P3 | `common/auth/scopes.ts:13,15` vs contrato | `attractions:manage` y `admin:full` no existen en el `securitySchemes` del contrato (API-004) | Alinear ambos lados al migrar a un Authorization Server real |
| **CAL-012** | P3 | `dto/nested-types.dto.ts:6-9` | `currency` valida longitud 3 pero no formato ISO 4217: `"ABC"` se acepta y queda persistida en `varchar(3)` | `@Matches(/^[A-Z]{3}$/)` contra la lista ISO 4217 |
| **CAL-013** | P3 | `dto/nested-types.dto.ts:40-42` + `atracciones.service.ts:217-226` | `LocationDto` modela un array (`@ArrayMinSize(1)`) pero `aplicarDto` solo lee `locations[0]`: el resto se descarta **en silencio** | Rechazar con 400 más de una ubicación, o implementar la relación |
| **CAL-014** | P3 | `dto/details-request.dto.ts:8` → `atracciones.service.ts:126` | Sin `@ArrayMaxSize` ni `@IsUUID`: un cliente que envía 3 ids y recibe 1 no obtiene ninguna señal | `@IsUUID('4', { each: true })` y `@ArrayMaxSize(50)` |
| **CAL-015** | P3 | `package.json` (frontend y backend) | Sin `engines`, sin `.nvmrc`. El README dice «Node 20+» pero nada lo exige: Nest 10 y Vite 5 tienen requisitos de versión distintos | `engines` + `.nvmrc` |

---

# 10. PLAN DE CORRECCIÓN PRIORIZADO

## P0 — Antes de cualquier entrega o despliegue (~2-3 h)

| # | ID | Acción |
|:-:|---|---|
| 1 | **SEG-001** | **Rotar la contraseña de Supabase ahora.** Es la acción más urgente del informe. Después, sustituir el rol `postgres` por uno de permisos mínimos y sacar la credencial del disco. |
| 2 | **SEG-002** | Revocar el token OIDC de Vercel (`vercel logout` + revinculación) y borrar `backend/.env.local`. |
| 3 | **SEG-003** | Hacer `JWT_SECRET` obligatorio con validación de longitud y rechazo de valores de ejemplo. |
| 4 | **SEG-004** | Restringir `?all=true` a `admin:full` y filtrar por `operadorId`. Mover el `@Scopes` al guard. |
| 5 | **SEG-005** | Instalar `@nestjs/throttler` con límites globales y por clase de ruta. |
| 6 | **SEG-006** | Añadir `helmet` con CSP. |
| 7 | **DAT-001** | Poner `synchronize: false` **hoy** y generar la migración inicial antes del próximo despliegue. |

## P1 — Antes de la entrega (~1-2 días)

| Bloque | IDs | Esfuerzo |
|---|---|---|
| **Accesibilidad** | ACC-001 a ACC-011 | ~5 h — el 70 % es ACC-001 (contraste del foco) y ACC-010 (`required` en `Field`), ambos cambios de pocas líneas con efecto transversal |
| **Concurrencia** | CON-001, CON-002, CON-003 | ~4 h — el *claiming* atómico de la clave y mover la lectura al `manager` |
| **Subida de archivos** | SEG-007, SEG-008, SEG-010 | ~2 h |
| **Sesiones** | SEG-009, SEG-014 | ~3 h (consulta de `activo` + throttling de login) |
| **Validación** | API-001, API-009, API-011, API-012 | ~1 h |
| **Despliegue** | OPS-001, OPS-002 | ~1 h |
| **Calidad** | CAL-001 a CAL-004 (lint, tests, `strict`, CI) | ~1-2 días — es la inversión que evita la reincidencia |

## P2 — Antes de la evaluación (~2-3 días)

- **Resto de accesibilidad:** ACC-012 a ACC-025 (~4 h). Los contrastes se resuelven tocando `--border-strong`, `--ring`, el placeholder y cuatro colores de la paleta.
- **Contrato OpenAPI:** API-002 a API-014, con especial atención a API-003 (path duplicado), API-004 (scopes faltantes) y API-005 (`languages` ignorado) (~3 h).
- **Datos:** DAT-002 a DAT-010 (~3 h).
- **Frontend:** WEB-001 a WEB-008 (~4 h).
- **Seguridad P2:** SEG-016 a SEG-023 (~3 h).
- **README:** CAL-008 y CAL-009 (~1 h).

## P3 — Deuda técnica documentada

- CAL-010 a CAL-015, OPS-003 a OPS-009.
- Migración del token a cookie `httpOnly` (WEB-008).
- Migración de las 3 entidades inertes a una rama aparte (CAL-006).
- SSR/SSG si el SEO es requisito de la rúbrica (WEB-003).

---

# 11. Matriz de verificación rápida

Checklist para re-evaluar después de las correcciones:

### Seguridad
- [ ] `grep -rEi "pooler\.supabase\.com|PG(password|PASSWORD)|SUPABASE" --include=".env*" .` solo devuelve `.env.example` con valores de ejemplo (sustituir por el patrón de secretos real del proyecto: p. ej. `gitleaks detect`)
- [ ] `backend/.env.local` no existe
- [ ] Arrancar la API sin `JWT_SECRET` **falla** con un error claro
- [ ] Un token con `rol: ADMIN` y scope `admin:full` **no** da acceso a `/reportes/ventas`
- [ ] Un token de `OPERADOR` con `?all=true` devuelve **cero** reservas de otros operadores
- [ ] 6 POST a `/auth/login` seguidos devuelven **429**
- [ ] `curl -I http://localhost:3000/api/docs` muestra `content-security-policy`, `strict-transport-security` y `x-content-type-options`
- [ ] Subir un archivo `evil.html` con `Content-Type: image/jpeg` devuelve 400
- [ ] Con `DB_SYNC` ausente y `NODE_ENV=staging`, la API **no** modifica el esquema

### Accesibilidad (herramientas recomendadas)
- [ ] axe DevTools: **0 violaciones críticas** en `/`, `/explorar`, `/atraccion/:id`, `/reservar/:id` y `/admin`
- [ ] Lighthouse Accessibility ≥ 95 en las 5 rutas anteriores
- [ ] Recorrido 100 % con teclado en las 5 rutas: el foco siempre es visible (≥ 3:1) y nunca se pierde
- [ ] NVDA o Narrator: el cambio de ruta de la SPA anuncia la nueva página
- [ ] El menú móvil atrapa el foco, se cierra con `Esc` y devuelve el foco al disparador
- [ ] NVDA: al publicar una reseña sin valoración, el error «Elige una calificación» se anuncia
- [ ] El calendario se recorre con las flechas del teclado
- [ ] Ningún `<table>` del panel sin `scope` en los `<th>`
- [ ] Con `prefers-reduced-motion: reduce`, ninguna animación se ejecuta
- [ ] Con zoom al 200 %, todo el contenido es usable sin scroll horizontal de 2D

### API y contrato
- [ ] `npx @redocly/cli lint contracts/atracciones-openapi.yaml` → 0 errores
- [ ] `GET /atracciones/reservations?attraction_id=abc` → **400**, no 500
- [ ] Swagger en `/api/docs` sirve los assets desde `node_modules`, no desde el CDN
- [ ] Dos peticiones concurrentes con la misma `Idempotency-Key` ejecutan la operación **una sola vez**

### Calidad
- [ ] `npm run lint` se ejecuta sin error en backend y frontend
- [ ] `npm test` existe y pasa (mínimo: idempotencia, concurrencia de reserva, `cancel`/`confirm`)
- [ ] CI en `.github/workflows/` ejecutando lint + test + build + gitleaks
- [ ] `tsconfig.json` con `strictNullChecks: true`

---

# 12. Resumen final

**El proyecto es sólido en su diseño y está claramente por encima del nivel habitual de un proyecto académico.** Los puntos que más importan están bien resueltos: no hay inyección SQL, el mass assignment está bloqueado por configuración, los errores siguen RFC 7807 con campos por formulario, el IDOR devuelve 404 en lugar de 403 por una razón correctamente razonada, y el modal de `ui.jsx` es un ejemplo de *focus trap* bien implementado que otros proyectos podrían copiar.

**Sin embargo, no puede entregarse tal como está**, por cuatro razones independientes:

1. **Hay credenciales reales de producción en el disco** (SEG-001, SEG-002) y un secreto de firma con valor por defecto en el código (SEG-003). Esto no es un problema de calidad: es un incidente de seguridad que requiere rotación inmediata.
2. **Hay una fuga de PII por diseño**: el rol `OPERADOR` puede descargar todas las reservas de todos los clientes (SEG-004).
3. **La API no tiene rate limiting ni cabeceras de seguridad** (SEG-005, SEG-006), y la subida de archivos permite XSS almacenado desde el propio dominio de la API (SEG-007).
4. **La base de datos no tiene migraciones** (DAT-001), lo que hace cualquier entorno no productivo capaz de alterar el esquema de producción, y es un obstáculo directo para la migración a microservicios que el propio repositorio propone.

En accesibilidad, el proyecto **aprueba con nota alta** en estructura semántica, formularios, gestión de foco en modales y objetivos táctiles, y **suspende en contraste y en navegación por teclado de widgets compuestos** (foco, calendario, tabs, menú de usuario, radiogroup de estrellas). Los siete hallazgos P1 de accesibilidad son todos de un solo patrón —falta de teclado y de foco visible en componentes interactivos propios— y se resuelven en un día de trabajo con dos o tres abstracciones nuevas (un hook `useFocusTrap`, un hook `useRovingTabindex` y un ajuste de cuatro variables de color).

El mayor riesgo de gestión no es técnico sino de **proceso**: sin CI, sin lint funcional, sin tests y con un README que describe capacidades que el código no cumple (CAL-008), cada corrección puntual volverá a degradarse en la siguiente iteración. Invertir un día en CAL-001 a CAL-004 es lo que convierte este buen trabajo en algo sostenible.
