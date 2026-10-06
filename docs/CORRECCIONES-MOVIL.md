# Correcciones de la auditoría móvil — versión 2.5.0

La auditoría móvil (sobre la versión `2.4.3`) dejó 20 hallazgos:

| Prioridad | Cantidad |
|---|---|
| P1 | 3 |
| P2 | 8 |
| P3 | 6 |
| P4 | 3 |

Este documento recoge qué se hizo con cada uno y cómo comprobarlo. Los pesos se midieron sobre el build real.

## Resumen

| Estado | Hallazgos |
|---|---|
| ✅ Corregido (20) | MOV-001 a MOV-020 |

### Peso de la primera visita en un teléfono

| Recurso | Antes | Ahora |
|---|---|---|
| JavaScript inicial (gzip) | 92 KB | 90 KB |
| CSS inicial (gzip) | 10 KB | 11 KB |
| Imagen principal (hero) | **429 KB** (JPEG 1920 px) | **54 KB** (AVIF 1280 px) |
| Fuentes | 7 pesos desde Google Fonts y una hoja externa que bloqueaba el renderizado | **3 archivos woff2 (63 KB)**, autoalojados |
| **Total aproximado** | **~521 KB** | **~205 KB** |

**Foto de una tarjeta del catálogo en un teléfono:** antes bajaba la original completa (1280 px, unos 380 KB de media). Ahora baja la variante WebP de 960 px (unos 100 KB) o la de 480 px (unos 26 KB), según la pantalla.

## Detalle

| ID | Qué se hizo | Evidencia |
|---|---|---|
| **MOV-001** (P1) | **Hero en 4 anchos (640, 960, 1280 y 1920 px) y 3 formatos (AVIF, WebP y JPEG).**<br>• Se sirve con `<picture>`, `srcset` y `sizes`.<br>• La precarga usa `imagesrcset`, así el navegador baja el mismo archivo que pinta. En las páginas que no son el inicio, el pre-renderizado quita esa precarga.<br>• Las imágenes viven en `src/assets`: Vite les pone un hash en el nombre y se cachean un año.<br>• `/img/` también tiene caché de un año.<br>• La vista previa al compartir es un JPEG de 1200×630 (68 KB). | `utils/heroImg.js`, `Home.jsx`, `index.html`, `vercel.json`. Prueba «MOV-001»: un solo hero de 60 KB como máximo. |
| **MOV-002** (P1) | **`srcset`/`sizes` en todas las fotos del catálogo:** tarjetas, destinos, galería, resumen del checkout, «Mis reservas» y panel.<br>• **Fotos de ejemplo:** variantes estáticas en `backend/public/img/w480` y `w960`.<br>• **Fotos subidas:** `GET /api/v1/media/<foto>?w=480\|960` las reduce con sharp a WebP, con caché en el CDN. Solo admite esos dos anchos.<br>• Si falta una variante, la imagen vuelve a la original y, si esa también falla, muestra el marcador gris.<br>• sharp 0.35.5 (incluye el parche de libvips GHSA-f88m-g3jw-g9cj). | `utils/fotos.js` y `tests/fotos.test.js`. `common/storage/media.ts` y `media.spec.ts`. Prueba «MOV-002». |
| **MOV-003** (P1) | En contenedores de menos de 560 px, el gráfico de rankings oculta la columna de nombres (230 px) y pone **cada nombre sobre su barra**. Las barras usan todo el ancho y se añadió `accessibilityLayer`. | `admin/charts.jsx` (`RankChart`, `useAncho`). |
| **MOV-004** (P2) | **Menú del panel en el celular:**<br>• `useFocusTrap`: el foco no se escapa detrás del velo.<br>• Escape lo cierra y el foco vuelve al botón «Abrir menú».<br>• El velo es un `<button>` «Cerrar menú» y el menú tiene un botón visible para cerrarse.<br>• Abierto, se comporta como `role="dialog"` y `aria-modal`.<br>• Al abrir, el foco va al módulo actual. | `admin/AdminLayout.jsx`. Prueba «MOV-004»: 25 Tab dentro del menú y Escape devuelve el foco. |
| **MOV-005** (P2) | La altura máxima y el scroll vertical de la tabla de reportes pasaron a la clase `.table-wrap-alta`, que **no aplica en ≤ 760 px**. Ahí el único scroll vertical es el de la página. | `ReportesAdmin.jsx`, `admin.css`. |
| **MOV-006** (P2) | **Checkout en el celular:**<br>• El resumen se pliega a una línea («Ver detalle», con el nombre y el total).<br>• En el paso de pago, una **barra inferior fija** muestra el total y el botón «Pagar» / «Confirmar». | `Checkout.jsx`, `public.css`. Prueba «MOV-006»: el primer campo se ve sin desplazarse. |
| **MOV-007** (P2) | **App instalable:**<br>• Íconos PNG de 192 y 512 px, uno *maskable* de 512 y uno Apple de 180.<br>• `manifest` con `id`, `categories`, `short_name` y `lang`.<br>• `apple-touch-icon` y metadatos `apple-mobile-web-app-*`. | `public/icons/`, `manifest.webmanifest`, `index.html`. |
| **MOV-008** (P2) | **Áreas seguras del iPhone:**<br>• `viewport-fit=cover` **junto con** `env(safe-area-inset-*)` en cabecera, modales, toasts, menús, filtros, barras fijas, visor de fotos y el panel completo.<br>• `100vh` pasó a `100dvh` (con respaldo) en modales, visor, filtros e ingreso. | Bloque «Móvil» al final de `public.css`; `admin.css`. |
| **MOV-009** (P2) | Prefijo `-webkit-backdrop-filter` en las 3 superficies de cristal. Con `@supports not (…)`, esas superficies pasan a ser opacas donde no hay desenfoque. | `public.css`, `components.css`. |
| **MOV-010** (P2) | **Job «Frontend móvil» en el CI.**<br>• **Presupuesto de peso** (`npm run presupuesto`): JS ≤ 200 KB, CSS ≤ 40 KB, hero ≤ 60 KB, fuentes ≤ 120 KB y como máximo 4 archivos, ninguna hoja externa.<br>• **Playwright** (iPhone SE, iPhone 13, Pixel 5 e iPad Mini) con la API simulada a partir de datos reales grabados. Comprueba:<br>  ◦ que 9 páginas no tengan scroll horizontal ni fallos graves de accesibilidad (axe, WCAG 2.2 AA);<br>  ◦ el reflow a 320 px;<br>  ◦ el hero, las fotos, el checkout y el menú del panel. | `.github/workflows/ci.yml`, `playwright.config.js`, `e2e/`, `scripts/presupuesto.mjs`. |
| **MOV-011** (P2) | **Fuentes autoalojadas**, solo el subconjunto latino (cubre á é í ó ú ñ ü ¡ ¿):<br>• Open Sans variable: un archivo para todos los pesos del texto.<br>• Poppins 600 y 700.<br>• Se precarga solo la del texto y se quitó Google Fonts también del CSP. | `styles/fonts.css`, `src/assets/fonts/` (licencia OFL incluida). |
| **MOV-012** (P3) | **En pantallas táctiles (`pointer: coarse`), todo control llega a 44×44 px:**<br>• Los botones de solo icono y las flechas amplían un área invisible (`::after`), sin cambiar su tamaño visual.<br>• Chips, botones pequeños, enlaces de ayuda y menú del panel suben su altura mínima. | Bloque «Móvil» de `public.css`; `admin.css`. |
| **MOV-013** (P3) | **Botón «Tomar foto»**, solo en pantallas táctiles (`capture="environment"`), al subir fotos de una actividad o la portada de un destino. | `AtraccionForm.jsx`, `CatalogAdmin.jsx`. |
| **MOV-014** (P3) | **«Añadir a mi calendario».**<br>• La API entrega al dueño de la reserva un **enlace firmado (2 h)** a un `.ics` real: `text/calendar`, RFC 5545, en UTC, con duración y aviso 2 h antes.<br>• iPhone ofrece «Añadir al calendario»; Android y escritorio lo descargan.<br>• Si la API falla, se usa el archivo generado en el navegador.<br>• Sin firma, con la firma de otra reserva o pedido por otra persona → 404. | `calendario.controller.ts`, `utils/ics.ts` y `ics.spec.ts`. E2E «añadir al calendario». |
| **MOV-015** (P3) | **Mapa en pantallas táctiles:**<br>• No captura el arrastre de un dedo: el formulario se sigue desplazando.<br>• Un toque marca el lugar y se pellizca para acercar.<br>• El botón «Mover el mapa» activa el arrastre.<br>• En el celular el mapa mide 240 px de alto. | `MapaUbicacion.jsx`. |
| **MOV-016** (P3) | `build.target` / `cssTarget`: Safari/iOS 16.4, Chrome/Edge 111 y Firefox 114. El aviso de chunks grandes (heic2any y xlsx, que se cargan solo cuando se usan) quedó justificado en la configuración. | `vite.config.js`. |
| **MOV-017** (P3) | **El teclado virtual no tapa el campo enfocado:**<br>• `interactive-widget=resizes-content` en Android.<br>• En iPhone, `visualViewport` lleva el campo al centro de lo visible.<br>• `scroll-padding-bottom` evita que quede debajo de una barra fija. | `utils/teclado.js`, `index.html`. |
| **MOV-018** (P4) | **Catálogo:**<br>• 2 columnas desde 488 px (teléfonos grandes y en horizontal).<br>• En los angostos, las fotos de las tarjetas son 16:10: entran más resultados por pantalla y la imagen pesa menos. | `public.css`, `SIZES.tarjeta`. |
| **MOV-019** (P4) | **Galería:**<br>• El carrusel ya mostraba el contador «2 / 5», las flechas, el gesto de deslizar y las miniaturas.<br>• El **visor a pantalla completa** ahora pasa de foto deslizando y se cierra deslizando hacia abajo.<br>• Se eliminó el CSS de la galería antigua, que ya no se usaba. | `AttractionDetail.jsx`. |
| **MOV-020** (P4) | En ≤ 480 px, las pestañas se reparten el ancho y pasan a otra línea en lugar de quedar ocultas en un scroll horizontal sin barra. | `public.css`. |

## Cómo verificarlo

```bash
cd frontend
npm run build && npm run presupuesto   # pesos de la primera visita
npm run test:movil                      # Playwright en 4 perfiles de dispositivo (necesita: npx playwright install chromium)
```

Las pruebas con dispositivos físicos de la matriz de la auditoría (§9 y §12) siguen siendo recomendables antes de una campaña: VoiceOver, TalkBack, PWA instalada en un iPhone con Dynamic Island y redes 3G reales.
