# Correcciones de la reauditoría V3 — versión 2.3.0

La reauditoría V3 (sobre el commit `a8d4d68`) dejó abiertos:
- 3 hallazgos nuevos,
- 7 parciales,
- 1 no verificable.

Este documento recoge qué se hizo con cada uno y cómo comprobarlo. Las mediciones son de producción (https://descubre-ec.vercel.app).

## Resumen

| Estado | Hallazgos |
|---|---|
| ✅ Corregido (10) | V3-ACC-01, V3-ACC-02, V3-SEG-01, V2-SEG-02, V2-CON-01, SEG-010, SEG-008, WEB-008, WEB-003, ACC-026 |
| ✅ Corregido en 2.4.0 con Google (1) | SEG-016 |

## Detalle

| ID | Qué se hizo | Evidencia |
|---|---|---|
| **V3-ACC-01** (P2) | Los botones de cuentas demo usan borde `--border-strong` (≥ 3:1) y fondo al pasar el mouse. | `public.css` (`.demo-box button`) |
| **V3-ACC-02** (P3) | Al enviar la solicitud de empresa, el foco pasa al nuevo encabezado («Tu solicitud está en revisión»). | `Empresas.jsx` (`ref` + `tabIndex={-1}` + `focus()`) |
| **V3-SEG-01 / V2-SEG-02** (P3) | El 503 de arranque usa `${PUBLIC_URL}/api/v1/errores/unavailable`, y el tipo `unavailable` está en el catálogo. | `api/index.js`, `problem-types.ts`, `GET /api/v1/errores/unavailable` → 200 |
| **V2-CON-01** (P3) | Se eliminó la caché de sesión por instancia: cada petición consulta `sesion`, así que la revocación es **inmediata en todas las instancias**. El coste es de milisegundos, porque la API corre en `gru1`, junto a la base en `sa-east-1`. | `session.service.ts`; prueba «sin caché por instancia» |
| **SEG-010** (P1) | El *keepalive* consulta `/health` cada 5 minutos y **falla si Storage no está `UP`**. Storage solo responde `UP` si la clave configurada es la de servidor, porque la pública no puede leer la configuración de un bucket privado. | `.github/workflows/keepalive.yml`; `/health` → `storage.status: "UP"` |
| **SEG-008** (P3) | **Bucket privado** (`public: false`).<br>• Las fotos se guardan como `/api/v1/media/<objeto>`.<br>• `MediaController` solo entrega las que están **en uso** (fotos de atracciones no eliminadas y portadas de destinos), con caché larga en el CDN.<br>• Las recién subidas se ven con un **enlace firmado HMAC de 2 h**.<br>• Cualquier otro objeto responde 404. | Una foto en uso → 200. Un objeto no usado o una ruta arbitraria → 404. `…/object/public/…` sin caché → «Bucket not found». Pruebas `media.spec.ts`. |
| **WEB-008** (P2) | **DPoP (RFC 9449).**<br>• El navegador crea un par ECDSA P-256 con la llave privada **no exportable** (WebCrypto + IndexedDB).<br>• El login liga el token a esa llave (`cnf.jkt`).<br>• Cada petición lleva una prueba firmada: método, URL, hora, `jti` anti-repetición y `ath`.<br>• El token robado por XSS no sirve fuera del navegador.<br>• Se mantiene una sesión por pestaña, como pidió el usuario.<br>• Las integraciones siguen con `Bearer`. | En producción, el mismo token usado como Bearer o sin prueba → **401**. Pruebas `dpop.spec.ts` (unitarias) y `dpop.e2e-spec.ts`: con otra llave → 401. |
| **WEB-003** (P2) | **Pre-renderizado en el build.**<br>• Cada página pública y cada atracción publicada tienen su propio HTML con título, descripción, canonical, Open Graph, datos `schema.org/TouristTrip` y contenido visible en `#root`.<br>• El `sitemap.xml` se genera con todas las URLs.<br>• Si la API no responde, el build continúa sin las atracciones. | `frontend/scripts/prerender.mjs`: 5 páginas + 22 atracciones, sitemap de 28 URLs |
| **ACC-026** (P3) | **Medido sobre la foto real**, en el peor píxel detrás del texto, a 1920×1080 y 375×812.<br>• El título y el subtítulo no cumplían (1,7:1).<br>• Se reforzó el velo: más oscuro a la izquierda en escritorio y uniforme en el celular.<br>• El crédito de la foto lleva fondo propio. | Ver la tabla de contraste |

### Contraste del hero (peor píxel detrás del texto)

| Texto | 1920×1080 | 375×812 | Exigido |
|---|:-:|:-:|:-:|
| Título (texto grande) | **3,80:1** | **8,15:1** | 3:1 |
| Subtítulo | **5,05:1** | **6,28:1** | 4,5:1 |
| Etiqueta «+20 experiencias» | 11,71:1 | 14,00:1 | 4,5:1 |
| Crédito de la foto | 7,63:1 | 14,55:1 | 4,5:1 |

### Nota sobre SEG-008

Las fotos del catálogo que ya fueron públicas antes de este cambio pueden seguir en la caché del CDN de Supabase (Cloudflare) hasta que venza su `max-age`. Esa caché no se puede purgar desde el proyecto, y esas fotos ya eran públicas en el sitio. **El bucket es privado**: cualquier acceso nuevo responde «Bucket not found», y todo lo que se suba desde ahora solo es accesible a través de la API.

## SEG-016 (verificación de correo) — versión 2.4.0

Se resolvió con **inicio de sesión con Google**, igual que en Sal y Canela, en lugar de un servicio de correo:
1. El botón «Continuar con Google» lleva a Supabase Auth, que hace el OAuth con Google.
2. Al volver a `/ingresar`, el navegador envía el `access_token` a `POST /api/v1/auth/google`.
3. La API lo valida contra Supabase (`GET /auth/v1/user` con la clave de servidor) y exige proveedor `google` y correo confirmado.
4. La cuenta queda con `usu_verificado = TRUE` y recibe la sesión propia del sistema (con DPoP).

El registro con correo y contraseña sigue disponible, con sus mitigaciones: 5 registros por hora por IP, política de contraseñas, y que una cuenta nueva solo puede reservar para sí misma.
