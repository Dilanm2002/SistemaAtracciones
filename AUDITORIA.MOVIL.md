# Auditoría móvil — Descubre EC `2.4.3`

> **Alcance:** experiencia **móvil** (teléfonos primero), con revisión secundaria de tablet.
> **Tipo:** auditoría estática de código + verificación de build. **No se modificó código.**
> **Fecha:** 2026-10-05 · **Rama:** `main` · **Complementa:** `AUDITORIA.md`, `AUDITORIA.V2.md`, `AUDITORIA.V3.md`, `AUDITORIA.V4.md`

---

## 1. Resumen ejecutivo

El proyecto tiene una **base móvil deliberadamente buena**: viewport correcto, dozen de breakpoints coherentes, `100dvh` con fallback, objetivos táctiles de 44 px en la acciones principales, `prefers-reduced-motion` respetado, focus trap en los drawers públicos, tablas con scroll accesible, code splitting por ruta y prerender de 22 atracciones.

El problema no es la responsive: es que **el presupuesto de datos y los anchos de columna se diseñaron para escritorio**. En un teléfono, la primera visita descarga **~521 KB** (92 KB de JS gzip + ~10 KB de CSS gzip + **429 KB** de la imagen LCP) y las fotos de catálogo se sirven a **1600 px de ancho para tarjetas de ~335 px CSS**. Además, **CI no ejecuta ninguna prueba móvil**, así que todo esto puede empeorar sin avisar.

### 1.1 Semáforo

| Severidad | Definición | # |
|---|---|---|
| **P1 Crítico** | Rompe una función en teléfono o gasta datos de forma medible | **3** |
| **P2 Alto** | Degrada la usabilidad o incumple un estándar con impacto real | **8** |
| **P3 Medio** | Ergonomía, consistencia y detalles que mejoran la conversión | **7** |
| **P4 Bajo** | Pulido | **3** |

**Veredicto:** apto para producción móvil en su estado actual, con **3 defectos medibles que conviene corregir antes de la próxima campaña de marketing**. La prioridad #1 es el peso de las imágenes: es el único hallazgo que afecta a **todos** los usuarios en **todas** las páginas.

### 1.2 Los 3 hallazgos críticos

| ID | Hallazgo | Impacto medible |
|---|---|---|
| `MOV-001` | Imagen LCP de 429 KB sin variantes responsive ni caché inmutable | **429 KB** por visita móvil, a resolución 5.7× mayor que la necesaria en 375 px |
| `MOV-002` | Fotos de catálogo a 1600 px para tarjetas de ~335 px CSS | Hasta **~10×** peso por imagen; **3–6 MB** por página de 12 tarjetas |
| `MOV-003` | `RankChart` con `YAxis width={230}` deja **~5 px** de área de gráfico | El ranking de reportes es **ilegible** en cualquier teléfono |

---

## 2. Alcance, método y limitaciones

### 2.1 Qué se revisó

| Área | Archivos |
|---|---|
| Documento raíz | `frontend/index.html`, `frontend/public/manifest.webmanifest`, `frontend/vite.config.js`, `frontend/vercel.json` |
| Estilos | `src/styles/base.css`, `components.css`, `public.css`, `admin.css` |
| Layout | `components/PublicLayout.jsx`, `admin/AdminLayout.jsx` |
| UI compartida | `components/ui.jsx` (`Modal`, `Drawer`, `Field`, `useFocusTrap`, `Alert`, `Toast`) |
| Catálogo | `pages/Explore.jsx`, `Home.jsx`, `components/AttractionCard.jsx` |
| Detalle y reserva | `pages/AttractionDetail.jsx`, `components/BookingWidget.jsx`, `components/Reviews.jsx` |
| Checkout | `pages/Checkout.jsx` |
| Cuenta | `pages/MyReservations.jsx`, `pages/Confirmation.jsx`, `pages/MiscPages.jsx` (ayuda, contacto, perfil, auth) |
| Panel | `admin/AdminLayout.jsx`, `AtraccionesAdmin.jsx`, `CatalogAdmin.jsx`, `ReservasAdmin.jsx`, `PeopleAdmin.jsx`, `SolicitudesAdmin.jsx`, `IntegracionAdmin.jsx`, `DisponibilidadAdmin.jsx`, `ReportesAdmin.jsx`, `AtraccionForm.jsx`, `charts.jsx`, `MapaUbicacion.jsx` |
| Utilidades | `utils/imagen.js` |
| Proceso | `.github/workflows/ci.yml`, `.github/workflows/keepalive.yml` |

### 2.2 Verificaciones ejecutadas

| Comando | Resultado |
|---|---|
| `npm run lint` (ESLint) | ✅ 0 errores, 0 advertencias |
| `npm test` (Vitest) | ✅ **27/27** tests, 8 suites, 110 ms |
| `npm run build` (Vite 8) | ✅ correcto en **17.93 s**; prerender de 5 páginas + 22 atracciones |

**Sobre el aviso de build:** `Some chunks are larger than 500 kB` corresponde a `heic2any` (1320 KB) y `xlsx` (480 KB). **Ambos son `import()` diferido** (`imagen.js:63` y los botones de exportación), así que no entran en la ruta crítica. No es un defecto de móvil; si se quiere silenciar el aviso, subir `chunkSizeWarningLimit` con un comentario que lo justifique.

### 2.3 Limitaciones honestas

- **No se ejecutaron mediciones de campo.** No hay Core Web Vitals reales (CrUX/RUM), ni perfilado de CPU en un teléfono, ni capturas con Playwright en emuladores. **Los números de peso de esta auditoría sí son exactos** (salen del build); **los tiempos no se inventan**: donde se habla de tiempo se habla de tamaño y de bytes, y toda métrica de laboratorio marcarse como «por medir» en la §6.
- No hay emulador ni dispositivo físico en el entorno de trabajo.
- El CSP de `vercel.json` incluye `img-src https://upload.wikimedia.org`, pero ningún componente del frontend lo referencia; se anota solo como deuda de configuración, no como hallazgo móvil.

---

## 3. Lo que ya está bien (verificado)

Estos puntos **no** son observaciones genéricas: se comprobaron en el código y deben conservarse en cualquier refactor móvil.

| Área | Evidencia |
|---|---|
| Viewport correcto | `index.html:5` → `width=device-width, initial-scale=1.0` |
| Breakpoints coherentes | 440 / 520 / 560 / 640 / 760 / 800 / 860 / 900 / 960 / 1000 / 1024 repartidos entre `public.css`, `admin.css`, `components.css` — sin valores contradictorios |
| Alturas dinámicas | Uso de `100dvh` con fallback a `100vh` en el layout y en la barra de reserva |
| Objetivos táctiles principales | `.btn { min-height: 44px }`; `.btn-lg` mayor |
| Foco y teclado | Drawer público y filtros de `Explore.jsx` usan `useFocusTrap` + bloqueo de scroll + `Escape` |
| Tablas accesibles | `overflow-x:auto` + `tabIndex={0}` + `role="region"` + `aria-label="Tabla desplazable"` |
| Movimiento reducido | `public.css:473` → `@media (prefers-reduced-motion: reduce) { .car-foto img { animation: none } }` |
| Imágenes diferidas | `loading="lazy" decoding="async"` en tarjetas y galerías, con `onImgError` de respaldo |
| Code splitting real | La ruta inicial descarga **26.90 KB + 64.68 KB gzip**; `charts` (99.6 KB gz), `xlsx` (160 KB gz), `heic2any` (344.7 KB gz) y `MapaUbicacion` (51.2 KB gz) **solo bajo demanda** |
| CSS admin aislado | `AdminLayout-*.css` (21.4 KB) y `MapaUbicacion-*.css` (14.7 KB) se emiten aparte: el usuario público **no** los descarga |
| Formularios móviles | `autoComplete` (`name`, `email`, `given-name`, …), `inputMode="numeric"` en cédula/teléfono, `maxLength` con límites de negocio, `RequiredLegend`, honeypot en contacto |
| Errores | `ErrorState` con reintento, toasts, `role="alert"` / `role="status"` |
| SEO/entrega | Prerender de 22 atracciones + sitemap de 28 URLs; CSP, HSTS, `X-Frame-Options`, `Permissions-Policy` en `vercel.json` |
| Iconografía | `lucide-react` en línea: sin icon-font ni sprites, sin peticiones extra |

---

## 4. Hallazgos críticos (P1)

### `MOV-001` — La imagen LCP pesa 429 KB y se revalida en cada visita

**Evidencia**

- `frontend/src/pages/Home.jsx:44` → `<div className="hero-bg" style={{ backgroundImage: 'url(/img/hero-cotopaxi.jpg)' }} …>`
- `frontend/index.html:32` → `<link rel="preload" as="image" href="/img/hero-cotopaxi.jpg" fetchpriority="high" />`
- `frontend/public/img/hero-cotopaxi.jpg` → **1920×1280 px · 429,1 KB** (única variante; `dist/img/` confirma que es el único archivo)
- `frontend/vercel.json` → la regla `Cache-Control: public, max-age=31536000, immutable` aplica **solo** a `/assets/(.*)`. `/img/` cae en el comportamiento por defecto de Vercel (`public, max-age=0, must-revalidate`).

**Por qué importa en un teléfono**

1. **Exceso de resolución:** el `.hero-bg` se muestra a ~375×500 CSS px. En un iPhone con DPR 3 el máximo útil son ~1125 px de ancho; se sirven **1920 px**. Con `save-data` o DPR 1.5 sigue siendo el mismo archivo.
2. **Formato:** JPEG cuando AVIF/WebP son compatibles en iOS 16+ y en todo Chrome Android moderno. Un AVIF q60 equivalente ronda **60–90 KB**.
3. **Caché:** al no tener `Cache-Control` propio y el nombre no llevar hash, **cada visita revalida y vuelve a descargar los 429 KB**. En un navegador móvil con el hero visible, esto ocurre en prácticamente todas las sesiones.

**Impacto medible:** 429 KB ≈ **1,2 s** de descarga en Fast 4G (9 Mbps) solo para el hero, y **429 KB por visita** en un país con datos móviles medidos.

**Solución**

1. Generar variantes `640w / 960w / 1280w / 1920w` en **AVIF** y **WebP** (con JPEG como respaldo).
2. Sustituir el `background-image` en línea por un `<picture>`/`<img>` con `srcset` + `sizes`, conservando el `role="img"` y el `aria-label` actuales, y letear el `preload` con `imagesrcset`/`imagesizes`.
3. Añadir a `vercel.json` una regla `Cache-Control` para `/img/` **y** versionar el nombre con hash.
4. En `index.html:20,25` cambiar `og:image` a una variante `1280w` para no penalizar el preview con el original.

**Criterio de aceptación**

- LCP en emulador de 375 px sobre Fast 3G: **≤ 2,5 s** y elemento LCP **≤ 60 KB**.
- `Cache-Control` con `max-age ≥ 31536000` para `/img/`.
- Visualmente indistinguible de la original en un display de escritorio.

---

### `MOV-002` — Las fotos de catálogo se sirven a 1600 px para tarjetas de ~335 px

**Evidencia**

- `frontend/src/utils/imagen.js:16-17` → `export const ANCHO = 1600; export const ALTO = 1067;`
- Comentario del propio módulo (`:8-11`): *"la API solo recibe JPEG livianos (~200-500 KB)"*. **Es un presupuesto de escritorio.**
- `frontend/src/styles/public.css:136` → `.grid-cards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 22px }` → en móvil **una sola columna** de ~335 px CSS.
- Consumidores de la imagen completa: `AttractionCard`, `MyReservations.jsx:195`, `Checkout.jsx:190` (`.os-img`), la galería de `AttractionDetail`, `.dest-card`.

**Por qué importa en un teléfono**

Una tarjeta de 335 px CSS en un teléfono con DPR 3 necesita **~1005 px**. Se sirven **1600 px**: ~1,6× de ancho de sobra. Peor aún, con **una sola columna** por tarjeta visible, una página de 12 resultados implica **12 descargas de 200–500 KB = 3–6 MB**, y cada resultado nuevo al hacer scroll dispara otra descarga. El usuario promedio en datos móviles tiene techo de gasto y abandona.

Además, cada `<img>` es un `<img>` distinto: **sin `srcset` no hay forma de que el navegador elija**, y no existe `srcset` en el proyecto (`grep`: 0 resultados).

**Solución**

1. Backend: generar derivados en el pipeline de subida (además de HEIC→JPEG, que ya existe): `480w`, `960w`, `1600w`, en AVIF/WebP/JPEG, y devolver un array `variants` en la respuesta de `/atracciones`.
2. Componente `att-img`: `<img srcset="… 480w, … 960w, … 1600w" sizes="(max-width: 760px) 92vw, (max-width: 1100px) 46vw, 340px">`.
3. Aplicar el mismo `srcset` a `.os-img`, a la galería y a `.dest-card`.
4. Mantener `loading="lazy" decoding="async"` y `onImgError` como están.

**Criterio de aceptación**

- Imagen de tarjeta en emulador de 375 px / DPR 3: **≤ 45 KB**.
- Página `/explorar` con 12 resultados: **≤ 900 KB** totales (hoy se estiman 3–6 MB).
- La galería de detalle sigue mostrando la mayor resolución al abrir a pantalla completa.

---

### `MOV-003` — El gráfico de rankings es ilegible en cualquier teléfono

**Evidencia**

- `frontend/src/admin/charts.jsx:98` → `<YAxis width={230} … />` con `margin={{ right: 64 }}` y etiquetas truncadas a 34 caracteres.

**Por qué importa**

Cálculo en un iPhone de 375 px:

```
375 (viewport) − 32 (.adm-content padding)  = 343
343 − 36 (.chart-card padding)              = 307  ← ancho del ResponsiveContainer
307 − 230 (YAxis) − 64 (margin.right) − 8   =   5 px ← ÁREA DE BARRAS
```

**5 píxeles de barras.** El panel de *atracciones más reservadas* es inútil en teléfono. Además las etiquetas del eje, truncadas a 34 caracteres, se desbordan de los 230 px reservados.

**Solución**

1. En ≤ 760 px, conmutar `RankChart` a **barras horizontales** (`layout="vertical"`, `XAxis type="number"` sin `width` fijo), que es además el patrón correcto para nombres largos.
2. Alternativa mínima: `tickFormatter` que recorte a 18 caracteres en móvil y `margin.right` a 8.
3. Añadir un `accessibilityLayer` a `ResponsiveContainer` para que el gráfico sea navegable por teclado en escritorio.

**Criterio de aceptación**

- A 375 px, el top 10 de reservadas se lee completo **sin scroll horizontal**.
- El ancho del área de trazado es **≥ 40%** del contenedor.

---

## 5. Hallazgos de prioridad alta (P2)

### `MOV-004` — El drawer del panel no atrapa el foco ni se puede cerrar con teclado

**Evidencia** · `frontend/src/admin/AdminLayout.jsx` · `.adm-overlay { display: none }` en escritorio pasa a ser el velo en ≤ 1024 px.

- El overlay es un `div` con `aria-hidden="true"`: **no es un control de cierre** y no responde al toque.
- No hay `useFocusTrap`, a diferencia del drawer público y de los filtros de `Explore.jsx`, que sí lo usan.
- No se documenta cierre con `Escape`.

**Impacto móvil:** quien navega con teclado físico o con TalkBack/VoiceOver puede abrir el menú y quedar **atrapado detrás**; el `aria-hidden` sobre un elemento visible además viola la regla de «no ocultar contenido focused».

**Estándar:** WCAG 2.2 AA — `2.1.1 Keyboard`, `2.4.3 Focus Order`, `4.1.2 Name, Role, Value`, `1.3.1 Info and Relationships`.

**Solución** Reutilizar `useFocusTrap` de `components/ui.jsx`; convertir el overlay en `<button type="button" aria-label="Cerrar menú">`; añadir `Escape`; mover el foco al ítem activo al abrir y devolverlo al disparador al cerrar.

---

### `MOV-005` — Scroll vertical anidado en la tabla de reportes

**Evidencia** · `frontend/src/admin/ReportesAdmin.jsx:141`

```jsx
<div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"
     style={{ maxHeight: 480, overflowY: 'auto' }}>
```

`.adm-content` ya es un contenedor con scroll vertical propio. En un teléfono quedan **dos ejes verticales anidados**: el dedo se queda pegado al contenedor más cercano al tocar la tabla y la página «se atasca» (scroll trapping), un fallo táctil muy reportado en iOS.

**Solución** En ≤ 760 px, quitar `maxHeight`/`overflowY` en línea (moviendo el estilo a una clase CSS con `@media`), dejar solo `overflow-x: auto` y que el scroll vertical lo maneje `.adm-content`. Conservar `tabIndex`/`role`/`aria-label`.

---

### `MOV-006` — En el checkout, el resumen ocupa una pantalla completa antes del formulario

**Evidencia** · `frontend/src/pages/Checkout.jsx:224` (`.checkout`), `:353` (`{Summary}` como hermano), `:346` (CTA `btn-cta btn-lg`) · `frontend/src/styles/public.css:331`

```css
@media (max-width: 1000px) { .checkout { grid-template-columns: 1fr } .checkout aside { order: -1 } }
```

La regla funciona (el `aside` sí es hijo de `.checkout`), y su efecto es poner **el resumen antes del formulario**. En un teléfono ese resumen incluye foto de 1600 px, fecha, hora, participantes, punto de encuentro, desglose, total y un párrafo de política de cancelación: **más de una pantalla completa**. El usuario debe atravesarlo para llegar al primer campo, y el botón «Pagar $X» / «Confirmar reserva» queda al final, fuera de vista al empezar.

**Solución** En ≤ 1000 px, convertir el resumen en un `<details>`/`details-mobile` con el total siempre visible, y añadir una **barra inferior fija** con el total y el CTA cuando `step === 2`.

---

### `MOV-007` — La PWA no es instalable con ícono real y iOS no recibe metadatos

**Evidencia** · `frontend/public/manifest.webmanifest` declara únicamente `favicon.svg` en `icons`; no hay `192×192`, `512×512`, `maskable`, `purpose`, `short_name`, `lang` ni `categories` · `frontend/index.html` no tiene `apple-touch-icon`, `apple-mobile-web-app-capable` ni `apple-mobile-web-app-status-bar-style` (`grep`: 0 resultados).

**Impacto móvil**

- **iOS:** «Añadir a pantalla de inicio» genera un icono genérico o una captura recortada. Además, al abrirse sin barra de Safari, el contenido llega hasta el borde inferior (ver `MOV-008`).
- **Android:** el diálogo de instalación exige íconos de 192 y 512 px; sin ellos la instalación no se ofrece.

**Estándar:** criterios de instalabilidad PWA · Apple *Human Interface Guidelines* → *Web apps*.

**Solución** Exportar `192×192`, `512×512` y `512×512 maskable` en PNG desde el `favicon.svg`; añadir `short_name: "Descubre EC"`, `lang: "es-EC"`; añadir a `index.html` `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">` y `<meta name="apple-mobile-web-app-capable" content="yes">`.

---

### `MOV-008` — Sin guardarraíles de *safe area* ni `dvh` en los elementos fijos

**Evidencia**

- No hay `viewport-fit=cover` en `index.html:5` **ni** `env(safe-area-inset-*)` en ningún CSS (`grep`: 0 resultados).
- `.modal { max-height: calc(100vh - 32px) }` y `94vh` en móvil (selector en `components.css`).
- Barra de reserva fija, contenedor de toasts (`.toast-wrap`) y `.adm-sidebar` usan `position: fixed` con desplazamientos fijos.

**Encuadre correcto (importante)**

`viewport-fit` **no** está en el `viewport`, por lo que **hoy iOS ya inserta el viewport de forma automática y no hay solapamiento visible**. El riesgo real es el inverso al que suele suponerse: **añadir `viewport-fit=cover` sin `env()` sí rompería** las barras fijas, porque pasarían a extenderse bajo el *home indicator* y el *Dynamic Island*. Por eso esto es un **guardarraíl de robustez**, no un defecto activo.

**Solución** Adoptar `viewport-fit=cover` **y, en la misma PR**, padding con `env()` en `.modal`, barra de reserva, `.toast-wrap` y `.adm-sidebar`; y migrar `100vh/94vh` a `100dvh` con fallback.

**Criterio de aceptación** En iPhone 14 Pro en modo standalone: ningún control queda bajo el indicador de inicio; ningún título bajo el Dynamic Island; el footer del modal siempre a la vista.

---

### `MOV-009` — `backdrop-filter` sin el prefijo `-webkit-`

**Evidencia** · Superficies de cristal en `components.css` y `public.css` (`backdrop-filter: blur(…) saturate(…)`) sin declaración `-webkit-` previa.

**Impacto móvil** La forma **sin prefijo** está soportada desde Safari 18; en iOS 17 y anteriores el elemento queda **sin fondo difuminado**, mostrando el contenido que hay detrás. Sobre el drawer y el header eso significa texto e iconos sobre una superficie sin contraste garantizado → riesgo en `1.4.3 Contrast (mínimo)`.

**Solución** Declarar `-webkit-backdrop-filter` antes de la forma sin prefijo, y añadir un respaldo opaco con `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`.

---

### `MOV-010` — CI no ejecuta ninguna prueba móvil

**Evidencia** · `.github/workflows/ci.yml` cubre, para el frontend, exactamente: `npm ci` → `npm run lint` → `npm test` → `npm run build` → `npm audit --audit-level=high`. No hay Playwright, ni emulación de viewport, ni axe, ni Lighthouse.

**Impacto móvil** Los 10 hallazgos de este documento pueden reintroducirse sin que nada lo detecte. Un `minmax(260px, 1fr)` mal editado, un `width={230}` en un eje o un `env()` eliminado pasarían a `main` en verde.

**Solución** Añadir un job `frontend-e2e` con Playwright (`projects: iPhone 13, Pixel 5, iPad Mini`) recorriendo `/`, `/explorar`, `/atraccion/:id`, `/checkout`, `/mis-reservas` y `/admin/reportes`, con `expect(page).toHaveScreenshot()` y un `axe-core` por página; y un presupuesto Lighthouse en PR (LCP ≤ 2500 ms, CLS ≤ 0,1, INP ≤ 200 ms).

---

### `MOV-011` — Siete pesos de fuente desde Google Fonts, con `<link>` render-blocking y `preload` simultáneos

**Evidencia** · `frontend/index.html:29-31`

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="preload" as="style" href="…Open+Sans:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" />
<link rel="stylesheet" href="…(misma URL)…" />
```

**Impacto móvil** Son **7 pesos en 2 familias**. El español necesita los subsets `latin` **y** `latin-ext` (á, é, í, ó, ú, ñ, ü, ¡, ¿), por lo que el navegador puede descargar hasta **14 archivos woff2**. El `<link rel="stylesheet">` es **render-blocking**, y `preload` + `stylesheet` con la misma URL **duplica la solicitud** en lugar de deduplicarla. Sobre datos móviles, esto puede sumar **200–350 KB** y retrasar el primer pintado.

**Solución** Autoalojar: descargar los 3–4 pesos realmente usados como woff2, declararlos con `@font-face` + `font-display: swap`, y hacer `preload` **solo** del woff2 crítico (peso 400 latin-ext). Alternativa de una línea: un único archivo variable por familia.

**Criterio de aceptación** ≤ 4 archivos de fuente, ≤ 120 KB en total, sin stylesheet externo render-blocking.

---

## 6. Hallazgos de prioridad media (P3)

| ID | Hallazgo | Evidencia | Estándar / nota |
|---|---|---|---|
| `MOV-012` | Objetivos táctiles de **28–40 px** en controles secundarios: enlaces de la nav de ayuda (~35 px), flechas del carrusel (36 px), `.icon-btn` (32/36 px), `.adm-user .icon-btn` (32×32), `.adm-nav-item` (42 px), chips (34 px), `.btn-sm` (36 px) | `public.css:410`, `public.css:392-396`, selectores `.icon-btn` y `.adm-nav-item` en `components.css` / `admin.css` | **Cumplen** `WCAG 2.5.8` (mínimo 24×24). Quedan por debajo de 44 pt (Apple HIG) / 48 dp (Material), que es recomendación de plataforma, no norma. Subir solo los icon-only a 44×44 con área de toque ampliada por pseudo-elemento |
| `MOV-013` | `input type="file"` **sin `capture`**: subir una foto desde el teléfono exige entrar al selector del SO y elegir «Cámara» o «Biblioteca» | `admin/AtraccionForm.jsx:489`, `admin/CatalogAdmin.jsx:273` | Ofrecer un segundo botón con `capture="environment"`. **Verificar contra `Permissions-Policy: camera=()` de `vercel.json`** |
| `MOV-014` | La descarga del `.ics` **no funciona en iOS Safari**: iOS ignora `download` en `blob:` y previsualiza el archivo, así que nada llega al Calendario | `pages/Confirmation.jsx:23-26` (usado también en `MyReservations.jsx:219`) | Usar una URL `webcal://` suscrita al evento, o un endpoint `.ics` en el servidor con `Content-Type: text/calendar`, o un enlace de Google Calendar. **Aceptación:** en iPhone, el evento se añade en 2 toques |
| `MOV-015` | El mapa de Leaflet, dentro del `modal` con `overflow-y: auto`, **captura el gesto de un dedo** e impide desplazar el modal sobre él | `admin/MapaUbicacion.jsx` + `.modal-body` | Limitar la altura del mapa en ≤ 760 px, mostrar el aviso «desliza fuera del mapa para continuar», o convertirlo en un paso aparte «Ver mapa» |
| `MOV-016` | `vite.config.js` **no declara `build.target` ni `css.target`**. Los valores por defecto de Vite 8 asumen un navegador moderno, pero el código usa `dvh`, `:focus-visible`, `min()`, `aspect-ratio` | `frontend/vite.config.js` | Declarar el contrato explícito: `build: { target: ['es2022', 'safari16.4', 'chrome111'] }` y `css: { target: 'safari16.4' }` |
| `MOV-017` | **No hay manejo de `visualViewport`** (`grep`: 0 resultados): al enfocar «Cédula», «Teléfono» o «Notas» el teclado puede cubrir el campo enfocado | `pages/Checkout.jsx:263-267`, `pages/Confirmation.jsx` | Añadir `interactive-widget=resizes-content` al `viewport`, o reaccionar al `resize`/`scroll` de `visualViewport` para traer el campo a la vista. **Debe ir emparejado con `MOV-008`** |

---

## 7. Hallazgos de prioridad baja (P4)

| ID | Hallazgo | Evidencia |
|---|---|---|
| `MOV-018` | El catálogo queda en **una sola columna** en *todo* teléfono: `minmax(260px, 1fr)` con `gap: 22px` exige 542 px para dos columnas, así que bajo 542 px de contenido nunca caben dos. 12 tarjetas = 12 pantallas de scroll, y cada una dispara una descarga de imagen (agrava `MOV-002`) | `public.css:136` |
| `MOV-019` | En móvil la galería **oculta todas las miniaturas menos la primera** sin indicar cuántas hay ni ofrecer un visor con *swipe* a pantalla completa | `public.css:259`, `public.css:419` |
| `MOV-020` | «Mis reservas»: 3 pestañas con contador (`.tab .count`) en `display: flex` sin `flex-wrap`; a 320 px puede desbordar | `pages/MyReservations.jsx:171-177` |

---

## 8. Lo que **no** es un hallazgo

Esta sección existe para evitar que la próxima auditoría reintroduzca falsos positivos.

| Observación | Por qué **no** es un defecto |
|---|---|
| No hay `srcset` en el hero | El hero es un `background-image` en línea (`Home.jsx:44`); `srcset` no aplica a fondos CSS. **El defecto es que solo existe una variante de 1920 px**, no la ausencia del atributo |
| No hay service worker | **Offline no es un requisito de instalación.** Chrome y Safari lo hacen opcional desde 2024. No hay PWA offline que auditar |
| Los botones de 28–40 px | **Cumplen** `WCAG 2.5.8` (≥ 24×24). Los 44/48 px son recomendaciones de plataforma (Apple HIG / Material) |
| No hay `viewport-fit=cover` | **Hoy no causa solapamiento**: iOS inserta el viewport automáticamente cuando la clave falta. El riesgo es *añadirlo sin `env()`* |
| `chart.js` cargado por lazy | Correcto: son 99.6 KB gzip que solo bajan quien entra a Reportes |
| `heic2any` de 1.3 MB | Correcto: `import()` diferido en `imagen.js:63`, solo se descarga al subir un HEIC. Impacto marginal (admin, occasional) |
| El filtro de Explore con scroll propio | Correcto: es un patrón consolidado de *scroll trapping* deliberado, y sí tiene focus trap, `Escape` y bloqueo de scroll del body |

---

## 9. Matriz de validación

### 9.1 Dispositivos y navegadores

| Perfil | Viewport (CSS px) | DPR | Navegador | Prioridad |
|---|---|---|---|---|
| iPhone SE (2ª/3ª gen.) | 375×667 | 2 | Safari iOS 17 | **Alta** — mínimo real |
| iPhone 13 mini | 375×812 | 3 | Safari iOS 18 | **Alta** |
| iPhone 14 / 15 | 390×844 | 3 | Safari iOS 18 | **Alta** |
| iPhone 15 Pro Max | 430×932 | 3 | Safari iOS 18 | Alta — safe area / Dynamic Island |
| Android compacto | 360×800 | 2.75 | Chrome Android | **Alta** — gama de entrada, la más común en la región |
| Android medio | 412×915 | 2.625 | Chrome Android | Alta |
| Teléfono en horizontal | 844×390 | 3 | Safari / Chrome | **Alta** — el caso duro: modal, barra sticky y teclado |
| Tablet portrait | 768×1024 | 2 | Safari / Chrome | Media |
| WebView Android | 360×800 | 3 | Instagram / Facebook in-app | Media — sin barra de direcciones, `env()` sinceo el notch |
| PWA instalada | 390×844 | 3 | Standalone | Media — valida `MOV-007` y `MOV-008` |
| `save-data` / Data Saver | 375×667 | 3 | Chrome Android | Media — valida `MOV-001` |

### 9.2 Recorridos críticos a probar

| # | Recorrido | Qué validar | Hallazgos |
|---|---|---|---|
| 1 | `/` en 3G forzado | LCP, cls de fuentes, ancho del hero | `MOV-001`, `MOV-011` |
| 2 | `/explorar` con 12 resultados | Peso total, nº de descargas, scroll de filtros | `MOV-002`, `MOV-018` |
| 3 | `/explorar` → abrir filtros | Foco atrapado, `Escape`, scroll del body bloqueado | — (ya correcto, no regresionar) |
| 4 | `/atraccion/:id` | Galería a 1 foto, barra de reserva fija, *safe area* | `MOV-008`, `MOV-019` |
| 5 | Flujo de reserva completo | Calendario, cantidades, teclado virtual | `MOV-017` |
| 6 | `/checkout` pasos 1 y 2 | Orden del resumen, CTA visible, `inputMode` | `MOV-006`, `MOV-017` |
| 7 | `/checkout` → `/confirmacion` | Botón «Añadir a mi calendario» en iOS | `MOV-014` |
| 8 | `/mis-reservas` → cancelar | Modal largo, `check-row`, pestañas | `MOV-008`, `MOV-020` |
| 9 | `/ayuda` y `/contacto` | Nav sticky que colapsa a flex, acordeón, honeypot | `MOV-012` |
| 10 | `/admin` en 360 px | Drawer, foco, `Escape`, overlay | `MOV-004` |
| 11 | `/admin/reportes` en 360 px | **Gráfico de ranking**, scroll anidado, exportar | `MOV-003`, `MOV-005` |
| 12 | `/admin/atracciones/:id/editar` | Formulario largo, mapa dentro del modal, subida de foto | `MOV-015`, `MOV-013` |
| 13 | Standalone en iPhone 14 Pro | Icono, status bar, barras fijas | `MOV-007`, `MOV-008` |
| 14 | Reflow a 320 px | Sin scroll horizontal en ninguna página | `WCAG 1.4.10` |

---

## 10. Plan de remediación

### Fase 0 — Alto impacto, bajo riesgo (~1 día)

| Hallazgo | Acción |
|---|---|
| `MOV-001` | Comprimir el hero a AVIF/WebP + añadir `Cache-Control` para `/img/` |
| `MOV-003` | Barras horizontales en `RankChart` bajo 760 px |
| `MOV-005` | Quitar el scroll vertical anidado de `ReportesAdmin` |
| `MOV-007` | Generar iconos 192/512/maskable/180 + metadatos `apple-*` |
| `MOV-009` | Prefijo `-webkit-backdrop-filter` + respaldo con `@supports` |
| `MOV-017` | `interactive-widget=resizes-content` en el `viewport` |

### Fase 1 — Presupuesto de datos (~2–3 días)

| Hallazgo | Acción |
|---|---|
| `MOV-001` | Variantes `srcset`/`picture` del hero + hash en el nombre |
| `MOV-002` | Pipeline de derivados en el backend + `srcset`/`sizes` en todos los consumidores |
| `MOV-011` | Autoalojar y reducir a 3–4 pesos |

### Fase 2 — Accesibilidad y flujo táctil (~2 días)

| Hallazgo | Acción |
|---|---|
| `MOV-004` | `useFocusTrap` + overlay como botón + `Escape` en el drawer admin |
| `MOV-006` | Resumen colapsable + barra inferior con total y CTA |
| `MOV-008` | `viewport-fit=cover` **junto con** `env()` en todos los fijos |
| `MOV-012` | Icon-only a 44×44 |
| `MOV-014` | Ruta `webcal://` o endpoint `.ics` |
| `MOV-015` | Altura del mapa acotada + aviso de desplazamiento |

### Fase 3 — Red de seguridad (~2 días)

| Hallazgo | Acción |
|---|---|
| `MOV-010` | Job Playwright con perfiles iPhone/Pixel + axe + presupuesto Lighthouse |
| `MOV-016` | Declarar `build.target` / `css.target` |
| — | Repetir esta auditoría con **datos de campo** (CrUX o RUM) para validar `MOV-001`/`MOV-002` |

---

## 11. Cobertura de estándares

| Estándar / guía | Aplicación | Estado |
|---|---|---|
| **WCAG 2.2 AA** `1.4.10 Reflow` | Sin scroll horizontal a 320 px | ⚠️ Por validar (Matriz §9, recorrido 14) |
| **WCAG 2.2 AA** `2.5.8 Target Size (Minimum)` | ≥ 24×24 CSS px | ✅ Cumple en lo auditado |
| **WCAG 2.2 AA** `1.4.3 Contrast` | Legibilidad de superficies con cristal | ⚠️ `MOV-009` en iOS ≤ 17 |
| **WCAG 2.2 AA** `2.1.1 Keyboard` / `2.4.3 Focus Order` / `4.1.2 Name, Role, Value` | Drawer del panel | ❌ `MOV-004` |
| **WCAG 2.2 AA** `3.3.2 Labels or Instructions` | Formularios con `Field`, `RequiredLegend`, `hint` | ✅ Cumple |
| **WCAG 2.2 AA** `2.4.7 Focus Visible` | `:focus-visible` en base.css | ✅ Cumple |
| **Core Web Vitals** | LCP ≤ 2500 ms · INP ≤ 200 ms · CLS ≤ 0,1 | ❌ Probable en 3G por `MOV-001`/`MOV-011` — **medir** |
| **Presupuesto de payload** | ≤ 200 KB de JS gzip en la ruta inicial | ✅ 92 KB gzip |
| **PWA instalable** | Manifest + iconos + display | ❌ `MOV-007` |
| **Apple HIG** — Touch targets 44 pt | Interacción táctil | ⚠️ `MOV-012` |
| **Material Design 3** — Touch targets 48 dp | Interacción táctil | ⚠️ `MOV-012` |
| **Safari iOS** | `dvh`, prefijos, safe areas, teclado, `100vh` | ⚠️ `MOV-008`, `MOV-009`, `MOV-017` |
| **Chrome Android** | Data Saver, WebView, `save-data` | ⚠️ `MOV-001` sin variantes `save-data` |
| **OWASP ASVS v4** — Cabeceras | CSP, HSTS, `X-Frame-Options`, `Permissions-Policy` | ✅ Cumple |
| **E2E responsive + a11y** | Cobertura automática | ❌ `MOV-010` |

---

## 12. Checklist manual de verificación

Antes de dar por cerrada la Fase 0–2, confirmar punto por punto:

- [ ] `npm run lint`, `npm test` y `npm run build` en verde tras cada cambio
- [ ] Carga de `/` con la red limitada a Fast 3G: el LCP cabe en ≤ 2,5 s
- [ ] El hero se ve nítido en un monitor de escritorio sin banding ni pérdida de detalle
- [ ] `/explorar` con 12 resultados cabe en ≤ 900 KB (DevTools → Network → recrear en cada carga)
- [ ] Ninguna página presenta scroll horizontal a **320 px**
- [ ] El resumen del checkout es alcanzable en una interacción en móvil
- [ ] El botón «Pagar/Confirmar» es visible sin desplazarse hasta el final
- [ ] El teclado virtual no cubre el campo enfocado en cédula, teléfono y notas
- [ ] El drawer admin atrapa el foco, cierra con `Escape` y devuelve el foco al disparador
- [ ] El gráfico de rankings de `/admin/reportes` es legible a 360 px
- [ ] La tabla de reportes no «se atasca» al deslizar el dedo
- [ ] «Añadir a mi calendario» funciona en iPhone Safari
- [ ] En PWA instalada: ícono correcto, sin contenido bajo el indicador de inicio
- [ ] En horizontal (844×390): el modal completo cabe y el CTA es visible
- [ ] VoiceOver (iOS) y TalkBack (Android) recorren catálogo, checkout y panel sin bloqueos
- [ ] `save-data` activo: se sirve la variante ligera de las imágenes