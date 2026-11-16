# Auditoría V4 — Descubre EC

**Proyecto:** Descubre EC (marketplace de experiencias turísticas en Ecuador)
**Versión auditada:** `2.4.3` (backend y frontend sincronizados)
**Commit base de V3:** `a8d4d68`
**Commit auditado en V4:** `3f44d2f`
**Rango evaluado:** `a8d4d68..3f44d2f` — 14 commits, 69 archivos, `+3392 / -1279`
**Tipo:** reauditoría de código (caja blanca) con verificaciones locales no destructivas
**Fecha:** 2026-10-05

## 0. Cómo leer este informe

### 0.1 Alcance

| Zona | Contenido | Stack |
|---|---|---|
| `backend/` | API REST | NestJS 11 + Express 5 + PostgreSQL (SQL-first, sin entidades) |
| `frontend/` | SPA pública + panel de administración | React 18 + Vite + React Router 7 |
| `backend/contracts/` | Contrato normativo OpenAPI 3.0 + catálogo interno | YAML + JSON |
| `database/` | Esquema, migraciones y verificación | SQL |
| `.github/` | CI (6 jobs) y *keepalive* | GitHub Actions |

**Fuera de alcance:** los valores del panel de Vercel y de Supabase, el comportamiento en producción observado y cualquier métrica de rendimiento real. Ver §14.

### 0.2 Método

Se conservan **todos** los parámetros de las auditorías anteriores:

1. Auditoría estática de caja blanca sobre el árbol de trabajo y el diff completo contra V3.
2. Verificaciones locales **no destructivas**: `npm audit`, `npm run lint`, `npx tsc --noEmit`, `npm test`.
3. **Ningún cambio en el código, la configuración ni los datos.** Este informe es el único artefacto escrito.
4. Cada hallazgo se reevalúa **contra el código actual**, no contra lo que declara la documentación.
5. Toda afirmación del README, CHANGELOG o `docs/` se contrasta con el código; si divergen, el hallazgo es de la documentación (§ CAL-008), no del código.
6. Prioridad: **P0** crítico · **P1** alto · **P2** medio · **P3** bajo.

### 0.3 Estados

| Emoji | Estado | Significado |
|:-:|---|---|
| 🟢 | **CORREGIDO** | El defecto objetivo ya no existe; hay evidencia en código o medición. |
| 🟡 | **PARCIAL** | Mitigado pero no eliminado; queda un residuo descrito y acotado. |
| 🔴 | **AGRAVADO** | Estaba corregido y algo lo reintrodujo, o el riesgo creció. |
| 🔵 | **NO VERIFICABLE** | El veredicto depende de un valor o de un entorno fuera del repositorio. |
| 🆕 | **NUEVO (V4)** | No existía en V1, V2 ni V3. |

### 0.4 Convenciones

- Los identificadores de V1–V3 se **conservan sin renumerar**. Un hallazgo no cambia de nombre aunque cambie de estado o de severidad.
- Los hallazgos que no estaban en V3 llevan prefijo `V4-`.
- `CAL-008` se reabre: se había cerrado en V3 y esta auditoría lo devuelve a parcial.

---

## 1. Resumen ejecutivo

### 1.1 Semáforo por área (comparativa)

| Bloque | Hallazgos | V3 | V4 | Δ |
|---|:-:|:-:|:-:|:-:|
| Accesibilidad (WCAG 2.1/2.2 AA) | 37 + 2 🆕 | 34 🟢 · 1 🔵 · 2 🆕 | **37 🟢** · 2 🆕 | **+4 cerrados** |
| Seguridad (OWASP Top 10 2021) | 28 + 2 🆕 | 25 🟢 · 3 🟡 | **26 🟢** · 2 🟡 · 2 🆕 | **+1 cerrado** |
| API y contrato OpenAPI | 15 | 15 🟢 | **15 🟢** | = |
| Datos y persistencia | 11 | 11 🟢 | **11 🟢** | = |
| Concurrencia e idempotencia | 5 | 4 🟢 · 1 🟡 | **5 🟢** | **+1 cerrado** |
| Frontend | 14 | 12 🟢 · 2 🟡 | **13 🟢** · 1 🟡 | **+1 cerrado** |
| Despliegue y operación | 10 + 3 🆕 | 10 🟢 | **10 🟢** · 3 🆕 | = |
| Calidad, arquitectura y DevOps | 16 + 3 🆕 | 16 🟢 | **15 🟢** · 1 🟡 · 3 🆕 | **1 reabierto** |
| **Total** | **136 + 10 🆕** | **125 🟢 · 6 🟡 · 1 🔵** | **132 🟢 · 4 🟡 · 10 🆕** | **+7 cerrados** |

### 1.2 Resultado global

| Estado | V3 | V4 | Δ |
|---|:-:|:-:|:-:|
| 🟢 Corregido | 125 | **132** | **+7** |
| 🟡 Parcial | 6 | **4** | −2 |
| 🔵 No verificable | 1 | **0** | −1 |
| 🔴 Agravado | 0 | **0** | = |
| 🆕 Nuevo | 3 | **10** | +7 |
| **Identificadores totales** | 133 declarados | **146** | +13 |

> **Corrección de conteo de V3.** V3 declaraba 133 hallazgos, pero sus propias tablas contienen **136 identificadores**: los tres hallazgos nuevos de su §3 (`V3-ACC-01`, `V3-ACC-02`, `V3-SEG-01`) no estaban incluidos en el total. V4 contabiliza los 136 y añade 10 propios.

**Los 136 hallazgos previos están evaluados uno a uno.** Resultado: **132 cerrados, 4 parciales, 0 no verificables, 0 agravados.** No queda ningún P0 ni ningún P1 abierto.

### 1.3 Distribución por estado y bloque

| Estado | ACC | SEG | API | DAT | CON | WEB | OPS | CAL | Total |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 🟢 Corregido | 37 | 26 | 15 | 11 | 5 | 13 | 10 | 15 | **132** |
| 🟡 Parcial | — | 2 | — | — | — | 1 | — | 1 | **4** |
| 🔵 No verificable | — | — | — | — | — | — | — | — | **0** |
| 🆕 Nuevo V4 | 2 | 2 | — | — | — | — | 3 | 3 | **10** |

### 1.4 Lo que cambió en los 14 commits

| Commit | Contenido | Hallazgos que toca |
|---|---|---|
| `feat(auth)`: Google OAuth + DPoP | `POST /auth/google`, `dpop.ts`, `dpop.js`, `google.js` | SEG-016, WEB-008, **V4-SEG-01** |
| `feat(storage)`: bucket privado | `MediaController`, `firmaValida`, `atraccion.mapper` | SEG-008, **V4-OPS-01** |
| `feat(seo)`: pre-renderizado | `prerender.mjs`, sitemap, JSON-LD | WEB-003, **V4-CAL-02** |
| `feat(ui)`: mapa en el panel | `MapaUbicacion.jsx` | **V4-ACC-01**, **V4-OPS-02** |
| `feat(ui)`: imágenes sin fricción | `imagen.js`, `normalizarFoto`, ACEPTA | **V4-ACC-02**, SEG-007 (reforzado) |
| `perf(vercel)`: Fluid Compute | `"fluid": true` | **V4-OPS-03** |
| `chore`: jest 29 → 30.5 | Elimina GHSA-vfj7-8cjw-p6xm | CAL-002, OWASP A06 |
| `docs` | `docs/CORRECCIONES-V3.md`, README, CHANGELOG | CAL-008 (reabierto) |

### 1.5 Reclasificaciones respecto a V3

V4 **cambia el veredicto de tres hallazgos de V3**. No son ajustes cosméticos: son los tres puntos donde la documentación y el código no coinciden, o donde el alcance declarado no cubre lo que se afirma haber cerrado.

| ID | Veredicto V3 | Veredicto V4 | Motivo |
|---|---|---|---|
| **SEG-008** | 🟡 Parcial (bucket público, P3) | 🟢 **Corregido** | El bucket pasó a `public: false` y las fotos se sirven por `MediaController`, que valida que el objeto esté en uso y exige firma HMAC para lo recién subido. Lo que V3涙 marked como «decisión documentada» quedó resuelto. |
| **SEG-016** | ✅ Corregido (V3 y `docs/CORRECCIONES-V3.md`) | 🟡 **Parcial** | Google verifica el correo, pero el registro con contraseña deja `usu_verificado = FALSE` **de forma permanente** (`database/01_esquema.sql:170`, `NOT NULL DEFAULT FALSE`; `auth.service.ts:317` solo escribe el `TRUE` en la rama de Google). Quien se registra con correo y contraseña nunca queda verificado. Sigue existiendo además el `409` que permite enumerar correos. |
| **CAL-008** | 🟢 Corregido | 🟡 **Parcial** (reabierto) | El README, el CHANGELOG y `docs/CORRECCIONES-V3.md` afirman que la sesión emitida por Google va «ligada con DPoP». No es cierto: `client.js:65` solo adjunta prueba en `/auth/login` y `/auth/register`. Ver **V4-SEG-01**. |

Además, **ACC-026** pasa de 🔵 no verificable a 🟢 corregido: `docs/CORRECCIONES-V3.md:31-38` publica la tabla de contraste medida sobre la foto real a 1920×1080 y 375×812, que era exactamente la comprobación que V3 pedía.

---

## 2. Verificaciones ejecutadas en esta auditoría

| Verificación | Comando | Resultado |
|---|---|:-:|
| Dependencias backend | `npm audit --prefix backend` | ✅ `found 0 vulnerabilities` |
| Dependencias frontend | `npm audit --prefix frontend` | ✅ `found 0 vulnerabilities` |
| Lint backend | `npm run lint --prefix backend` | ✅ exit `0` |
| Tipos backend | `npx tsc --noEmit -p tsconfig.json` | ✅ exit `0` |
| Tests backend | `npm test --prefix backend` | ✅ **22 suites / 124 tests** |
| Lint frontend | `npm run lint --prefix frontend` | ✅ exit `0` |
| Tests frontend | `npm test --prefix frontend` | ✅ **8 suites / 27 tests** |
| Secretos en disco | `git ls-files` | ✅ Solo los 2 `.env.example` versionados |

**Barras de V3 → V4:** backend de 18 suites / 109 tests a **22 / 124** (8 suites nuevas: `dpop`, `dpop.e2e`, `media`, `storage.service`, `imagenes-storage`, `auth-google`, `atraccion.mapper`, `contract-coverage`, `dto-validation`). Frontend sin cambios: **8 / 27**.

**No ejecutado:** E2E contra PostgreSQL 16 (job `database` de CI), *build* de Vercel, `axe-core`, Lighthouse y cualquier prueba sobre la aplicación desplegada.

**Barridos de apoyo ejecutados:** 0 coincidencias de `innerHTML` / `dangerouslySetInnerHTML` / `eval` / `new Function` en `frontend/src`; 14 `<img>` y 15 declaraciones de `loading` (ninguna imagen depende del valor por defecto); 4 `target="_blank"` y 4 `rel="noopener"`.

---

## 3. Hallazgos nuevos (V4)

Ninguno es P0 ni P1. **Solo uno es P2** —V4-SEG-01— y es deuda que las auditorías anteriores ya señalaban como riesgo de ampliación, materializada al añadir OAuth con Google. Los otros nueve son P3.

---

### 🆕 V4-SEG-01 (P2) — La sesión emitida por OAuth con Google no queda ligada a DPoP

**Qué falla.** `frontend/src/api/client.js:63-65` decide si adjuntar prueba DPoP así:

```
const ligado = !!token && !!datosToken(token)?.cnf;
if (token) headers.Authorization = `${ligado ? 'DPoP' : 'Bearer'} ${token}`;
const conPrueba = ligado || (!token && (path === '/auth/login' || path === '/auth/register'));
```

`POST /auth/google` no está en esa lista. En el momento de la llamada no hay token en `sessionStorage` y la ruta no es `/auth/login` ni `/auth/register`, así que `conPrueba` es `false` y la petición sale **sin cabecera `DPoP`**. En el backend, `contexto()` resuelve entonces `jkt` como `undefined` y `emitirToken()` emite un JWT **sin `cnf`**.

**Consecuencia.** El resultado es un token `Bearer` puro: un atacante que lo robe puede usarlo sin necesidad de la llave privada. Es exactamente la mitigación que WEB-008 implementó y que la documentación afirma aplicar también al flujo de Google.

**Agravante documental.** El hallazgo es doble porque la afirmación es explícita en tres sitios:

- `frontend/src/utils/google.js:12` — comentario «la API devuelve la sesión propia del sistema (con DPoP)».
- `CHANGELOG.md`, versión 2.4.0 — «Se emite la sesión propia del sistema, **ligada con DPoP**».
- `docs/CORRECCIONES-V3.md:50` — «recibe la sesión propia del sistema (**con DPoP**)».

Como el resultado es observable por el cliente (`Authorization: Bearer` en lugar de `DPoP`), la prueba de que la afirmación es falsa no requiere laboratorio: basta con mirar la red.

**Corrección (≈ 5 min).** En `client.js`, incluir la ruta en el conjunto que ya genera prueba:

```
const conPrueba = ligado || (!token && (path === '/auth/login' || path === '/auth/register' || path === '/auth/google'));
```

`dpopPrueba()` ya firma método, URL y `iat`; para esta ruta el `ath` se calcula sobre el token de Google que el navegador tiene en la mano, que es el que corresponde. Requiere además corregir los tres comentarios citados.

---

### 🆕 V4-SEG-02 (P3) — El registro anti-repetición de DPoP es por instancia y se purga en bloque

**Qué falla.** `backend/src/common/auth/dpop.ts:23` declara `const vistos = new Map<string, number>()` con el comentario «anti-repetición por instancia», y las líneas 74-78 hacen la comprobación clásica de `jti`. Dos consecuencias:

1. **La ventana de repetición es por instancia, no global.** Vercel reparte peticiones entre instancias, de modo que la misma prueba puede aceptarse una vez en cada instancia viva dentro de los 300 s de `VENTANA_S`. El despliegue lleva `"fluid": true` (`backend/vercel.json:7`), que именно reduce los arranques en frío y por tanto prolonga la vida de las instancias, amplificando la ventana.
2. **La purga es total.** `dpop.ts:78` hace `vistos.clear()` al superar 20 000 entradas, lo que reabre de golpe la ventana de repetición para todos los `jti` retenidos.

**Por qué es P3 y no P2.** El impacto real está acotado por dos controles que ya existen: la prueba incluye `ath` (hash del token) y `htm` + `htu`, así que una repetición solo es exploitable contra **el mismo token, el mismo método y la misma ruta**; y las operaciones no idempotentes exigen `Idempotency-Key` (`CON-001`), que bloquea el duplicado en el servidor. ElRFC 9449 §4.1 recomienda estado compartido, no memoria del proceso.

**Corrección (opcional).** Tabla `dpop_jti` con `PRIMARY KEY (jti)` y `EXPIRES`, purgada por el mismo *keepalive* que ya limpia `sesion`; o, más simple, `INSERT … ON CONFLICT DO NOTHING` transaccional. Alternativa de coste cero: sustituir `clear()` por borrado de las entradas vencidas (ya se hace en la línea 75).

---

### 🆕 V4-OPS-01 (P3) — Las fotos del catálogo se sirven desde la API y consumen el límite global de peticiones

**Qué falla.** Con el bucket privado (SEG-008), cada foto del catálogo pasa a ser una petición a `/api/v1/media/…`. Eso interactúa mal con dos decisiones ya existentes:

- **Límite global.** `backend/src/app.module.ts:30` define `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` con `ThrottlerGuard` como `APP_GUARD`. Las peticiones de imagen **consumen ese cupo**, igual que las llamadas a la API. Una galería de 12 fotos consume el 10 % del presupuesto de un visitante en un minuto; un panel que previsualiza varias atracciones puede agotarlo y recibir `429`.
- **Memoria.** `storage.service.ts` limita a 4 MB por objeto y `MediaController` lo sirve íntegro, con `@Res()` y sin *streaming*. Con Fluid Compute el pico de memoria por instancia sube.

**Nota sobre caché.** Los objetos en uso se sirven con `Cache-Control: public, max-age=31536000, immutable`, de modo que el coste es de **primera** visita por objeto. El riesgo es acotado a catálogos grandes y a recargas de caché.

**Corrección (≈ 30 min).** Excluir `/api/v1/media` del `ThrottlerGuard` global (`@SkipThrottle()` en el controlador, conservando el límite por IP en el borde) y dejar de almacenar el objeto en memoria: pasar el `ReadableStream` de Supabase al `res` con `pipeline`, en lugar de acumular un `Buffer`.

---

### 🆕 V4-OPS-02 (P3) — Peticiones a Nominatim sin control de frecuencia

**Qué falla.** `frontend/src/admin/MapaUbicacion.jsx` llama a `nominatim.openstreetmap.org` en tres sitios: `/search` al elegir ciudad (línea 98), `/search` al escribir una búsqueda (114) y **`/reverse` en cada clic del mapa** (50). No hay *debounce*, caché ni cancelación de la petición anterior.

La [política de uso de Nominatim](https://operations.osmfoundation.org/policies/nominatim/) exige un máximo de **1 petición por segundo** y prohíbe el uso masivo o automatizado. Un operador que mueve el marcador varias veces seguidas —que es el uso natural del componente, ya que cada clic dispara `reverse`— la incumple. La aplicación además no puede identificarse: el `User-Agent` es el del navegador.

**Consecuencia práctica.** Bloqueo temporal de la IP por parte de Nominatim, con el mapa degradado para todo el panel, no solo para quien abusó.

**Corrección (≈ 20 min).** `debounce` de 300-500 ms en el `reverse`, una entrada en caché `Map` con la última consulta resuelta, y `AbortController` para cancelar la búsqueda en curso cuando llega otra. El `search` de ciudad (98) puede cachearse por sesión, porque el conjunto de destinos es estable.

---

### 🆕 V4-OPS-03 (P3) — Fluid Compute sin techo de concurrencia frente a un pool de una conexión

**Qué pasa.** `backend/vercel.json:7` añade `"fluid": true`, y el `buildCommand` sigue siendo `npm run vercel-build` con `maxDuration: 60` (línea 12). Pero `app.module.ts:49` conserva `max: Number(configService.get('DB_POOL_MAX', prod ? '1' : '5'))` y `connectionTimeoutMillis: 10000`.

El razonamiento que justificaba un pool de 1 era correcto bajo el modelo anterior —una instancia de Vercel atendía una petición a la vez— y **Fluid Compute lo invalida**: una instancia viva ahora atiende varias peticiones concurrentes, y todas compiten por la misma conexión, con 10 s de espera antes de fallar. Consecuencia: en una ráfaga de peticiones sobre la misma instancia aparecen `503` por agotamiento del pool que antes eran imposibles.

No es una regresión de seguridad y no hay datos que，右手. Es un riesgo de disponibilidad que conviene acotar antes de que llegue tráfico real.

**Corrección (≈ 15 min).** Subir `DB_POOL_MAX` en proporción a la concurrencia por instancia (Vercel permite configurar el máximo por función), o fijar `maxConcurrency` en `vercel.json` de forma explícita y documentada para que la relación con el pool sea intentional en lugar de implícita. Lo que **no** debe hacerse es dejar el valor por defecto sin relación con `fluid: true`.

---

### 🆕 V4-ACC-01 (P3) — El nombre accesible del mapa está en un elemento sin rol

**Qué falla.** `frontend/src/admin/MapaUbicacion.jsx:157`:

```jsx
<div ref={contenedor} className={`mapa-lienzo${error ? ' is-invalid' : ''}`}
     aria-label="Mapa: haz clic para marcar la ubicación de la actividad" />
```

Un `div` sin `role` tiene rol `generic`, y **ARIA no permite `aria-label` sobre `generic`**: el atributo se ignora y el nombre no llega al árbol de accesibilidad. Es la regresión exacta del patrón que **ACC-018 cerró** («`aria-label` en `<div>` con rol `generic`»), y ocurre en una vista que V3 declaró conforme.

SeDg si el mapa tiene alternativa de teclado: sí, el `<details>` «Ingresar coordenadas manualmente» de `AtraccionForm.jsx` ofrece los campos de latitud y longitud. El problema no es la inaccesibilidad del dato, sino que la etiqueta que explica la interacción no se anuncia.

**Corrección (≈ 5 min).** `<div role="region" aria-label="…">` — o `role="application"`, con `tabIndex={0}` y gestion de flechas si se quiere que sea operable. Con `role="region"` el nombre se expone y basta.

---

### 🆕 V4-ACC-02 (P3) — El error de validación por elemento no se anuncia

**Qué falla.** El proyecto unificó sus errores en `Field`, que renderiza `<span id={errId} className="error-text" role="alert">` (`frontend/src/components/ui.jsx:288`). Ese patrón lo cumplen ACC-023 y ACC-011, y también lo usan `MapaUbicacion.jsx:162` y `AuthForms.jsx`.

El nuevo `ListEditor` de `AtraccionForm.jsx` **no lo sigue**: su mensaje es `<span id={errId} className="error-text">{err}</span>`, sin `role`. El campo sí recibe `aria-invalid` y `aria-describedby`, de modo que un lector de pantalla lo associatesá al error al navegar con el lector —pero **no se anuncia cuando el error aparece**, que es el requisito de 4.1.3 (Status Messages) en el caso de un mensaje que surge al escribir.

Como la validación de `ListEditor` ocurre **en cada pulsación** («Incluye», «No incluye», «Recomendaciones»), el efecto es un error que cambia continuamente sin notificación, en el único editor de listas del panel.

**Corrección (≈ 2 min).** Añadir `role="alert"` al `span`, con lo que el componente queda alineado con el resto del proyecto.

---

### 🆕 V4-CAL-01 (P3) — El código frontend nuevo y crítico no tiene pruebas

**Qué pasa.** V3 cerró CAL-002 con «18 suites / 109 tests en backend y 8 / 27 en frontend». En V4 el backend subió a **22 suites / 124 tests** con ocho suites nuevas que cubren DPoP, media privado, Google OAuth y cobertura del contrato. El frontend **sigue en 8 / 27**, y sus dos únicos archivos de test son:

- `frontend/tests/format.test.js`
- `frontend/tests/validation.test.js`

No hay una sola prueba para ninguno de los módulos añadidos en estos 14 commits:

| Módulo | Qué hace | Riesgo sin prueba |
|---|---|---|
| `frontend/src/api/dpop.js` | Llave no exportable, persistencia en IndexedDB, firma de la prueba | Alto: es la base de WEB-008 |
| `frontend/src/api/client.js` | `conPrueba`, tipo `DPoP`/`Bearer`, reintentos, `401` | Alto: es donde está **V4-SEG-01** |
| `frontend/src/utils/google.js` | Redirección OAuth, lectura del `access_token` de Supabase | Medio |
| `frontend/src/utils/imagen.js` | `normalizarFoto`, `ACEPTA`, `esImagen` | Medio: acepta cualquier formato |
| `frontend/scripts/prerender.mjs` | HTML, JSON-LD, sitemap | Medio: se ejecuta en el build |
| `frontend/src/admin/MapaUbicacion.jsx` | Leaflet, Nominatim, validación | Medio |

La asimetría es reveladora: todo lo nuevo que se probó, se probó en backend. El código de navegador que decide **cómo se adjunta la prueba criptográfica** quedó sin cubrir, y ahí es donde está el defecto de V4-SEG-01.

**Corrección (≈ 2 h).** `dpop.js` es WebCrypto puro y se puede probar en Node con `jsdom` o `vitest`: generar llave, firmar, verificar, comprobar que `exportKey` falla. `client.js` necesita una prueba de regresión que verifique que `POST /auth/google` incluye `DPoP`; ese test habría prevented este hallazgo.

---

### 🆕 V4-CAL-02 (P3) — El pre-renderizado solo cubre las primeras 100 atracciones

**Qué pasa.** `frontend/scripts/prerender.mjs:66` obtiene el catálogo con una sola llamada:

```
atracciones = (await obtener(`${API}/atracciones?limit=100`)).data ?? [];
```

No hay paginación posterior ni aviso si la respuesta viene truncada. Con más de 100 atracciones publicadas, las restantes **no reciben HTML pre-renderizado** y, como el `sitemap.xml` (línea 105-106) se construye a partir de ese mismo array, **tampoco aparecen en el sitemap**. El SEO de esas páginas vuelve al estado previo a WEB-003 sin que nada lo indique: el script imprime `prerender: 5 páginas + 100 atracciones` y termina con código 0.

Con 22 atracciones hoy el límite no se alcanza, así que el defecto es latente, no activo.

**Corrección (≈ 20 min).** Paginar por `offset` hasta agotar el total, y **fallar el build** si la última página viene llena, que es la señal de que el contrato de la API cambió.

---

### 🆕 V4-CAL-03 (P3) — `frontend/image.png` es un archivo binario corrupto sin rastrear

**Qué pasa.** `git status --porcelain` muestra `?? frontend/image.png`, de **96 bytes**: demasiado pequeño para cualquier imagen válida y fuera de `public/` (donde están las dos imágenes legítimas, `auth-bg.jpg` y `hero-cotopaxi.jpg`).

Probablemente sea un recorte fallido de una captura. Al no estar versionado no entra en el bundle ni en el repositorio, así que **no hay riesgo de seguridad**; sí hay ruido: un archivo binario de 96 bytes en la raíz del frontend sugiere un proceso de captura manual que no termina en el sitio correcto, y es el tipo de residuo que sobrevive a varias auditorías porque no rompe nada.

**Corrección (≈ 1 min).** Borrarlo y, si la captura hacía falta, guardarla bajo `docs/` con nombre descriptivo.

---

## 4. Accesibilidad (WCAG 2.1 AA / 2.2 AA) — 37 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **ACC-001** | P1 | Indicador de foco sin contraste mínimo | 🟢 CORREGIDO | Sin cambios respecto de V3: `base.css:120-134`, anillo `#fcd34d` = 8,60:1 sobre `#0b3b36`. |
| **ACC-002** | P1 | Enlace «Ingresar» sin nombre accesible en móvil | 🟢 CORREGIDO | Sin cambios: texto a `.sr-only`. |
| **ACC-003** | P1 | `role="menu"` sin teclado APG | 🟢 CORREGIDO | Sin cambios: patrón *disclosure* con `aria-expanded`. |
| **ACC-004** | P1 | Menú móvil sin gestión de foco | 🟢 CORREGIDO | Sin cambios: el drawer reutiliza `Modal` (`role="dialog"`, `aria-modal`). |
| **ACC-005** | P1 | Sidebar tabulable estando oculto | 🟢 CORREGIDO | Sin cambios: `visibility: hidden`. |
| **ACC-006** | P1 | La navegación SPA no mueve el foco | 🟢 CORREGIDO | Sin cambios: 11 llamadas a `.focus()`. |
| **ACC-007** | P1 | `role="grid"` sin estructura | 🟢 CORREGIDO | Sin cambios: 0 coincidencias. |
| **ACC-008** | P1 | `tablist` sin `tabpanel` ni flechas | 🟢 CORREGIDO | Sin cambios: `role="group"` + `aria-pressed`. |
| **ACC-009** | P1 | `radiogroup` de estrellas no implementado | 🟢 CORREGIDO | Sin cambios: *roving tabindex*. |
| **ACC-010** | P1 | Campos obligatorios no marcados | 🟢 CORREGIDO | Sin cambios: `ui.jsx:272` `aria-required`. |
| **ACC-011** | P1 | Alertas `warning` sin región viva | 🟢 CORREGIDO | Sin cambios: `ui.jsx:249` asigna rol por tono. |
| **ACC-012** | P2 | Bordes de botones e inputs < 3:1 | 🟢 CORREGIDO | Sin cambios: `--border-strong: #968a78`. **Se reutiliza en el código nuevo**: `.btn-google` (línea 369) y `.demo-box button` (376). |
| **ACC-013** | P2 | `placeholder` < 4,5:1 | 🟢 CORREGIDO | Sin cambios: `components.css:82`. |
| **ACC-014** | P2 | Selector de estrellas sin estado a 3:1 | 🟢 CORREGIDO | Sin cambios. |
| **ACC-015** | P2 | Días pasados con `opacity: .45` | 🟢 CORREGIDO | Sin cambios. Se mantiene la excepción de componente deshabilitado. |
| **ACC-016** | P2 | Reseñas ocultas al 65 % ilegibles | 🟢 CORREGIDO | Sin cambios. |
| **ACC-017** | P2 | «Cargar más» no anuncia resultados | 🟢 CORREGIDO | Sin cambios: `aria-live="polite"` + foco. |
| **ACC-018** | P2 | `aria-label` en `<div>` con rol `generic` | 🟢 CORREGIDO **reincidido** | El hallazgo original está cerrado, pero **el patrón vuelve en código nuevo**: `MapaUbicacion.jsx:157` es exactamente el `div` con `aria-label` y sin rol que ACC-018ucentró. Se registra como **V4-ACC-01**; ACC-018 conserva su cierre porque su instancia original sigue corregida. |
| **ACC-019** | P2 | Ninguna tabla declara `scope`/`caption` | 🟢 CORREGIDO | Sin cambios: 20 coincidencias. |
| **ACC-020** | P2 | Salto de encabezado `h1`→`h3` | 🟢 CORREGIDO | Sin cambios: `<h2 className="sr-only">`. |
| **ACC-021** | P2 | ARIA conflictivo en selector de iconos | 🟢 CORREGIDO | Sin cambios. |
| **ACC-022** | P2 | Interruptores con etiquetas idénticas | 🟢 CORREGIDO | Sin cambios: `ui.jsx:349` `role="switch"` + `aria-label`. |
| **ACC-023** | P2 | Errores de API sin `role="alert"` | 🟢 CORREGIDO | Sin cambios: `<Alert tone="danger">`. **El patrón no se aplicó al nuevo `ListEditor`** → **V4-ACC-02**. |
| **ACC-024** | P2 | Header del panel < 4,5:1 | 🟢 CORREGIDO | Sin cambios. |
| **ACC-025** | P2 | Texto secundario del banner | 🟢 CORREGIDO | Sin cambios. |
| **ACC-026** | P3 | Header transparente sobre foto | 🟢 **CORREGIDO** *(V3: 🔵 no verificable)* | **La comprobación que V3 pedía ya está hecha**: `docs/CORRECCIONES-V3.md:31-38` publica la tabla de contraste medida **sobre la fotografía real**, en el peor píxel detrás del texto, a 1920×1080 y 375×812: título **3,80:1** (exigido 3:1), subtítulo **5,05:1** (4,5:1), etiqueta **11,71:1**, crédito **7,63:1**. *Matiz:* la medición la publica el propio proyecto; esta auditoría no la reprodujo, de modo que el cierre se apoya en evidencia ajena, no propia. |
| **ACC-027** | P3 | `aria-describedby` a ID inexistente | 🟢 CORREGIDO | Sin cambios: `ui.jsx:274` filtra lo que se renderiza. |
| **ACC-028** | P3 | `aria-invalid` en `<div>` genérico | 🟢 CORREGIDO | Sin cambios: retirado. |
| **ACC-029** | P3 | Etiquetas ambiguas en editor de listas | 🟢 CORREGIDO | Sin cambios en el patrón, pero **el nuevo `ListEditor` lo reintroduce parcialmente**: el mensaje nombra el elemento, pero no se anuncia (**V4-ACC-02**). |
| **ACC-030** | P3 | Hora inválida descartada en silencio | 🟢 CORREGIDO | Sin cambios. |
| **ACC-031** | P3 | Toasts sin pausa | 🟢 CORREGIDO | Sin cambios: `ToastContext.jsx:31-34`. |
| **ACC-032** | P3 | Error de rango no asociado a campos | 🟢 CORREGIDO | Sin cambios. |
| **ACC-033** | P3 | Gráficas Recharts sin nombre accesible | 🟢 CORREGIDO | Sin cambios: `role="img"` + alternancia a tabla. |
| **ACC-034** | P3 | `target="_blank"` sin `rel="noopener"` | 🟢 CORREGIDO | **Comprobado en V4:** 4 ocurrencias de `target="_blank"` y **4** de `rel="noopener"`. Sin第三条 huérfana. |
| **ACC-035** | P3 | `role="menu"` en `AdminLayout` | 🟢 CORREGIDO | Sin cambios: *disclosure* coherente. |
| **V3-ACC-01** | P3 | Botones de cuentas demo sin frontera perceptible | 🟢 **CORREGIDO** *(V3: abierto)* | `public.css:376` aplica `border: 1px solid var(--border-strong)` con el comentario que cita el ID del hallazgo, y `:377` añade `border-color: var(--primary)` en hover. Reutiliza la variable que ACC-012 ya había definido, que era la corrección exacta que V3 proponía. |
| **V3-ACC-02** | P3 | El resultado del formulario de empresa no se anuncia | 🟢 **CORREGIDO** *(V3: abierto)* | `Empresas.jsx:31` — `setTimeout(() => titulo.current?.focus(), 0)` — con `ref={titulo}` y `tabIndex={-1}` en el `h2` (línea 85). El foco viaja al encabezado nuevo, como pedía el hallazgo. |
| **V4-ACC-01** | P3 | Nombre accesible del mapa en elemento sin rol | 🆕 **NUEVO** | `MapaUbicacion.jsx:157`. Ver §3. |
| **V4-ACC-02** | P3 | El error de validación por elemento no se anuncia | 🆕 **NUEVO** | `AtraccionForm.jsx` (`ListEditor`). Ver §3. |

**Veredicto ACC: 37 🟢, 2 🆕.** Los 11 P1 de V1 siguen cerrados y **no hay ninguno de P2 abierto**. ACC-026 era el último hallazgo que dependía de una medición externa y ya se resolvió.

La observación relevante de esta iteración no es un defecto grave, sino una **tendencia**: los dos hallazgos nuevos de accesibilidad y el único defecto de contraste de V3 aparecen todos en código añadido en las últimas dos versiones. El equipo corrigió el hallazgo y después construyó tres componentes nuevos sin el control. Es la firma de un proyecto que avanza más rápido de lo que su disciplina de revisión, y el remedy barato es el mismo que funcionó en V3: reutilizar el componente que ya existe en lugar de escribir el equivalente.

---

## 5. Seguridad y privacidad (OWASP Top 10 2021) — 28 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **SEG-001** | P0 | Credenciales de BD de producción en claro | 🟢 CORREGIDO | **Verificado en V4:** `git ls-files` solo devuelve `backend/.env.example` y `frontend/.env.example`. `backend/.env` existe en disco y no está versionado. *Pendiente fuera del repositorio:* rotación de la contraseña y sustitución del rol `postgres`. |
| **SEG-002** | P0 | `VERCEL_OIDC_TOKEN` vigente | 🟢 CORREGIDO | `.env.local` no existe; barrido de secretos sin coincidencias. *Pendiente fuera del repositorio:* revocar el vínculo y revisar logs. |
| **SEG-003** | P0 | `JWT_SECRET` con valor por defecto | 🟢 CORREGIDO | `env.validation.ts:13-16`: obligatorio, ≥ 32 caracteres, rechazo de valores de ejemplo. La API no arranca sin él. |
| **SEG-004** | P0 | `OPERADOR` leía las reservas de todos | 🟢 CORREGIDO | Sin cambios: `reservas.service.ts:39-47`, tres ramas `todas`/`operador`/`propias`. |
| **SEG-005** | P0 | Cero rate limiting | 🟢 CORREGIDO | Global `120/min` (`app.module.ts:30`) + por ruta. **Nuevo efecto colateral:** `/api/v1/media/*` hereda el límite global y lo consume con cada imagen (**V4-OPS-01**). El control existe; su ámbito es ahora más ancho que su propósito. |
| **SEG-006** | P0 | Sin `helmet` | 🟢 CORREGIDO | `app.factory.ts:53-71`, CSP con `script-src ["'self'"]`. |
| **SEG-007** | P1 | XSS almacenado por extensión | 🟢 CORREGIDO **reforzado** | `storage.service.ts:8-17` valida *magic bytes* y **deriva la extensión del tipo detectado**. El cambio de V4 amplía lo que el usuario puede seleccionar (`accept={ACEPTA}`, `esImagen` acepta cualquier `image/*` incluido SVG y HEIC) y **el servidor mantiene el filtro**: `catalogo.controller.ts:246-248` acepta solo `image/(jpeg|png|webp)` y `storage.service.ts` vuelve a verificar los bytes. El cliente convierte a JPEG antes de subir, así que un SVG llega como JPEG; y si la conversión fallara, el *magic bytes* lo rechaza. La defensa en profundidad funciona en la dirección correcta. |
| **SEG-008** | P1 | Bucket público + clave `service_role` | 🟢 **CORREGIDO** *(V3: 🟡 parcial)* | El cambio es sustantivo, no cosmético. `imagenes-storage.ts` configura `public: false`; `MediaController.servir` valida (a) que el objeto case con `objetoValido` —regex `^(catalogo\/)?[\w-]{1,80}\.(jpe?g|png|webp)$`, que **excluye `..` al no permitir `.` en el tallo**, por lo que no hay *path traversal*—, (b) que esté **en uso** (`atraccion_foto` de atracciones no eliminadas o portada de un destino activo) o (c) que lleve **firma HMAC-SHA256 válida de 2 h**, calculada con `JWT_SECRET` y verificada en tiempo constante. Cualquier otro objeto responde 404. `atraccion.mapper.ts` devuelve URL absoluta y `storage.service.ts:42-55` sigue exponiendo la configuración real en `/health`. Pruebas en `media.spec.ts`. |
| **SEG-009** | P1 | Desactivar no invalidaba el token | 🟢 CORREGIDO | Cada JWT tiene fila en `sesion`, revalidada en cada petición. |
| **SEG-010** | P1 | `SUPABASE_SERVICE_ROLE_KEY` era un marcador | 🟡 PARCIAL | `env.validation.ts:22-28` rechaza la clave pública decodificando el payload. **La parte no verificable no cambió:** el valor real del panel. Con el bucket privado, `/health` ahora informa `storage.status: UP` solo si la clave configurada es la de servidor —indicio útil, no prueba. |
| **SEG-011** | P1 | Privilegios desde el claim `scope` | 🟢 CORREGIDO | `session.service.ts:39,79-84` recalcula roles y `scope` desde la base. |
| **SEG-012** | P1 | Sin migraciones + `synchronize` implícito | 🟢 CORREGIDO | `entities: []`, `synchronize: false`, `migrationsRun: false`, incondicionales. **Sin cambios en V4.** |
| **SEG-013** | P1 | PII duplicada en idempotencia | 🟢 CORREGIDO | `idempotency.service.ts` guarda `Referencia<T>` = `{ ref: uuid }` y **reconstruye la respuesta desde la tabla de origen**. Sin PII en `idempotencia`. |
| **SEG-014** | P1 | Login sin *throttling* + credenciales demo | 🟢 CORREGIDO | Las credenciales privilegiadas no están en el repositorio; `AuthForms.jsx:27-31` lleva `null` como contraseña para Administrador y Operador. **El nuevo botón de Google no reintroduce credenciales**: `google.js` no contiene secretos y el cliente OAuth vive en Supabase. |
| **SEG-015** | P1 | `Object.assign` sin *whitelist* | 🟢 CORREGIDO | Construcción campo por campo, unicidad validada antes, `FOR UPDATE`, bitácora con `{ password: '(cambiada)' }`. |
| **SEG-016** | P2 | `/auth/register` sin verificación de correo | 🟡 **PARCIAL** *(V3: ✅ corregido)* | **Se corrige el veredicto de V3.** Google resuelve el caso de quien elige ese proveedor: `auth.service.ts:225` marca `usu_verificado = TRUE` en cuenta existente y `:239` lo inscribe en la nueva. **Pero la rama de contraseña sigue sin verificación permanente**: `database/01_esquema.sql:170` declara `usu_verificado BOOLEAN NOT NULL DEFAULT FALSE` y `auth.service.ts:317` (registro) no lo escribe, así que la cuenta nace y muere sin verificar. No hay ninguna ruta que la verifique después. Se mantiene además el `409` «Ya existe una cuenta con ese correo», que permite enumerar correos, lo que V3 consideró defendible en un marketplace abierto y V4 lo mantiene. **Lo que sí es una corrección real y substancial:** ahora existe un camino verificado, con lo que el riesgo baja de «nunca verificable» a «verificable solo por un proveedor externo». |
| **SEG-017** | P2 | Auto-degradación de administrador | 🟢 CORREGIDO | Sin cambios: transacción con `FOR UPDATE` y `ConflictException` si el sistema quedara sin ADMIN. |
| **SEG-018** | P2 | `PhotoDto.url` solo `@IsString()` | 🟢 CORREGIDO | `@Matches(/^(https?:\/\/[^\s"'<>]+\|\/(img\|uploads)\/[\w.-]+)$/i)`. **V4:** el contrato cambió —las fotos se guardan como ruta `/api/v1/media/<objeto>`— y el mapper las convierte a URL absoluta en lectura. La validación del lado de escritura sigue siendo la misma. |
| **SEG-019** | P2 | Swagger en producción con CDN | 🟢 CORREGIDO | `app.factory.ts:108`, solo con `ENABLE_DOCS=true`; recursos servidos desde `/vendor` propio. `MediaController` está declarado en `operaciones-internas.json` y excluido de Swagger con `@ApiExcludeController()`, lo que mantiene el patrón de API-015. |
| **SEG-020** | P2 | CORS sin `methods` ni `maxAge` | 🟢 CORREGIDO | Orígenes validados con regex, `methods` y `allowedHeaders` explícitos, `maxAge: 86400`. **V4:** la cabecera `DPoP` se añadió a `allowedHeaders`, correctamente. |
| **SEG-021** | P2 | Sin `trust proxy` | 🟢 CORREGIDO | `confianzaProxy()`: `TRUST_PROXY` manda; si no, 1 salto solo en Vercel. |
| **SEG-022** | P2 | Arrays sin `@ArrayMaxSize` | 🟢 CORREGIDO | Sin cambios. |
| **SEG-023** | P2 | `autoComplete` de tarjeta en pago simulado | 🟢 CORREGIDO | 4 coincidencias de `autoComplete="off"`. |
| **SEG-024** | P3 | `toPublic` filtraba por *destructuring* | 🟢 CORREGIDO | Interfaz `UsuarioPublico` y construcción explícita; `usu_password` no se selecciona jamás. |
| **SEG-025** | P3 | `useStaticAssets` sin `dotfiles: 'deny'` | 🟢 CORREGIDO | `app.factory.ts:88-93`. |
| **V2-SEG-01** | P1 | `SEED_ON_START` falla en abierto | 🟢 CORREGIDO | Defensa por triplicado, sin cambios en V4. `seed.service.ts:120` sí inserta `usu_verificado` para las cuentas demo, lo que es coherente con que sean de prueba. |
| **V2-SEG-02** | P3 | `type` de dominio ajeno y valor reflejado | 🟢 **CORREGIDO** *(V3: 🟡 parcial)* | El residuo que V3 señaló era `api/index.js:33` con un `type` fijo fuera del catálogo. **`unavailable` está ahora en `problem-types.ts`** y `api/index.js` construye la URL con `${PUBLIC_URL}/api/v1/errores/unavailable`, que resuelve 200. El hallazgo queda cerrado por completo: la reflexión del valor sigue eliminada y el `type` es ahora resoluble. |
| **V3-SEG-01** | P3 | El 503 de arranque usa un `type` fuera del catálogo | 🟢 **CORREGIDO** *(V3: abierto)* | Ver fila anterior: es el mismo cambio de código. V3 lo dejó como P3 pendiente; V4 lo cierra. |
| **V4-SEG-01** | P2 | La sesión de Google no queda ligada a DPoP | 🆕 **NUEVO** | `client.js:63-65`. Ver §3. |
| **V4-SEG-02** | P3 | Anti-repetición de DPoP por instancia | 🆕 **NUEVO** | `dpop.ts:23,74-78`. Ver §3. |

### 5.1 Matriz OWASP Top 10 2021

| OWASP 2021 | Estado V4 | Nota |
|---|---|---|
| **A01** Broken Access Control | 🟢 | El modelo de alcance por empresa se mantiene en las tres ramas. `MediaController` no introduce rutas: valida pertenencia del objeto y exige firma. |
| **A02** Cryptographic Failures | 🟢 | bcrypt coste 10, `JWT_SECRET` *fail-fast*, tokens de sesión hasheados. **V4 añade criptografía bien construida**: ECDSA P-256, `ath` sobre el token, `htm`/`htu`, `jti`; llave no exportable en IndexedDB. *Matiz:* la firma de media reutiliza `JWT_SECRET` (HMAC-SHA256 sobre `${objeto}:${exp}`), lo que es criptográficamente aceptable al ser mensajes de dominios distintos, pero un HKDF con `info` por dominio sería más limpio. |
| **A03** Injection | 🟢 | Sin hallazgos. Las consultas nuevas (`MediaController`, `auth.google`) son parametrizadas. `objetoValido` valida por regex antes de tocar el almacenamiento, lo que además cierra el *path traversal*. |
| **A04** Insecure Design | 🟢 | Idempotencia con *claiming* atómico; `FOR UPDATE` en el flujo transaccional. **V4:** la sesión de Google no tiene *state* (`state` de Supabase) ni nonce propio verificable en el backend — el token de Google se valida contra Supabase y se exige `email_verified`, lo que es suficiente para el caso, pero un atacante con un token de Google propio podría completar el flujo con **su** correo, que es justamente lo que el sistema quiere impedir. V4 lo considera dentro de A07. |
| **A05** Security Misconfiguration | 🟢 | CSP, validación de entorno, `synchronize: false`, Swagger *opt-in*. |
| **A06** Vulnerable Components | 🟢 | **0 vulnerabilidades**, incluidas las de desarrollo. V4 sube `jest` de 29 a 30.5 para eliminar GHSA-vfj7-8cjw-p6xm, que la V29 arrastraba por `braces`. |
| **A07** Identification & Auth Failures | 🟢 con reservas | Seed bloqueado por triplicado, credenciales fuera del repo, *throttling*, sesiones server-side, política de contraseñas. **Reservas: sin verificación de correo en la rama de contraseña (SEG-016), sin MFA, y sesión de Google no ligada a DPoP (V4-SEG-01).** |
| **A08** Software & Data Integrity Failures | 🟢 | gitleaks con `fetch-depth: 0`; migraciones con *checksum* y *advisory lock*; `dependency-review` con `fail-on-severity: high`. |
| **A09** Logging & Monitoring Failures | 🟢 | `JsonLogger` + `registroPeticiones` con `request_id`. **V4: el log no registra los tokens de Google ni las pruebas DPoP**, porque `path` se registra sin query string y no hay cuerpos — correcto. *Residual:* sin trazas distribuidas. |
| **A10** SSRF | 🟢 | Ningún endpoint hace que el servidor resuelva una URL arbitraria. **V4 mantiene la propiedad**: las llamadas a Nominatim las hace **el navegador**, no la API, lo que además evita que un atacante use el servidor como proxy. |

**Veredicto SEG: 26 🟢, 2 🟡, 2 🆕.** Los 6 P0 de V1 siguen cerrados. El único P1 de V2 (el *seed*) continúa cerrado por tres capas independientes. **Ningún hallazgo abierto rompe una frontera de confianza**: los dos parciales son uno de documentación de producto (SEG-016) y uno que depende de un valor externo (SEG-010).

El cambio de mayor alcance —OAuth con Google— está bien construido en su parte difícil: validar un token de terceros contra el emisor, exigir `email_verified`, **no** auto-aprobar solicitudes de empresa y no crear cuentas administrativas. Su defecto es de una línea, en el cliente.

---

## 6. API REST y contrato OpenAPI — 15 hallazgos

Sin cambios funcionales en V4 más allá de lo que sigue. `contract-coverage.spec.ts` sigue verde y es la comprobación que sostiene el bloque.

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **API-001** | P1 | `attraction_id` como string produce 500 | 🟢 CORREGIDO | `@IsUUID('4', …)` + traducción de `22P02` a 4xx. |
| **API-002** | P2 | `search`/`details` públicos vs. contrato | 🟢 CORREGIDO | `security: []` en esas operaciones. |
| **API-003** | P2 | `/atracciones/{id}` declarado dos veces | 🟢 CORREGIDO | Una sola declaración. |
| **API-004** | P2 | El contrato exige scopes que no define | 🟢 CORREGIDO | Los 7 scopes coinciden con `scopes.ts`. |
| **API-005** | P2 | `details` no devolvía `metadata` | 🟢 CORREGIDO | `metadata` se devuelve, con filtrado por idioma. |
| **API-006** | P3 | `UpdateAtraccionRequest` vacío | 🟢 CORREGIDO | Declara las propiedades reales del DTO. |
| **API-007** | P3 | El listado documenta 2 y acepta 8 | 🟢 CORREGIDO | `limit`, `offset`, `page`, `q`, `category`, `city`, `featured`, `status`, `operator`. |
| **API-008** | P3 | Tres fuentes de versión | 🟢 CORREGIDO | `version.spec.ts` falla si backend y frontend se desalinean. Ambos en `2.4.3`. |
| **API-009** | P2 | `q` sin `@MaxLength` y sin escapar | 🟢 CORREGIDO | `@MaxLength(120)` + `escapeLike` con `ESCAPE '\'`. |
| **API-010** | P2 | `filters.query` sin longitud máxima | 🟢 CORREGIDO | `@MaxLength` + `@ArrayMaxSize`. |
| **API-011** | P2 | `children` sin cota máxima | 🟢 CORREGIDO | `@Max(30)`. |
| **API-012** | P2 | `duration` sin rango | 🟢 CORREGIDO | Validador custom con `0 < horas ≤ 720`. |
| **API-013** | P3 | Ambigüedad al resolver `_links` | 🟢 CORREGIDO | Consistente con `servers.url`. |
| **API-014** | P2 | `codigo` de operador con `MAX+1` | 🟢 CORREGIDO | Sin cambios. `database/01_esquema.sql:273` sigue declarando `ope_codigo INTEGER NOT NULL UNIQUE` sin identidad, y `proveedores.module.ts:198-199` sigue combinando `pg_advisory_xact_lock` con `MAX+1`. El resultado es correcto; la mejora opcional de V3 (`GENERATED BY DEFAULT AS IDENTITY`) no se aplicó. |
| **API-015** | P3 | Brecha entre contrato e implementación | 🟢 CORREGIDO **reforzado** | `contract-coverage.spec.ts` compara las rutas que Nest registra por reflexión con las del YAML y las de `contracts/operaciones-internas.json`, en las tres direcciones. **V4 lo demuestra con dos rutas nuevas** que هي，加入 sin documentar: `POST /auth/google` (pública, en el contrato) y `GET /media/{objeto}` + `GET /media/{carpeta}/{archivo}` (internas, en `operaciones-internas.json`, con `@ApiExcludeController()`). El test sigue verde, luego la disciplina se mantuvo. |

**Veredicto API: 15/15.** Sin hallazgos nuevos y con el bloque reforzado por dos superficies añadidas que el mecanismo de cobertura detectó sin intervención manual.

---

## 7. Datos y persistencia — 11 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **DAT-001** | P0 | Sin migraciones; `synchronize` implícito | 🟢 CORREGIDO | **V4 añade dos migraciones** a las 6 de V3: `004_documento_telefono_ec.sql` y `005_contacto_pasajero.sql`, más `006_proveedores.sql`. Siguen con copia exacta en `database/`, *checksum* y *advisory lock*. Un test exige que `001_modelo_relacional.sql` sea copia exacta de `database/01_esquema.sql`. |
| **DAT-002** | P2 | `idempotencyKey` único a nivel de tabla | 🟢 CORREGIDO | `ON CONFLICT (idem_clave, idem_sujeto)`. |
| **DAT-003** | P2 | La PK era solo `key` | 🟢 CORREGIDO | Clave compuesta. |
| **DAT-004** | P2 | 7 campos en `simple-json` | 🟢 CORREGIDO | Modelo relacional en 3FN, ahora repartido en 43+ tablas. **V4 amplía el modelo con datos de contacto del pasajero y documento/validación de teléfono Ecuador**, en tablas propias, no en JSON. |
| **DAT-005** | P2 | SQL acoplado a nombres de `@JoinTable` | 🟢 CORREGIDO | Sin entidades. |
| **DAT-006** | P2 | Detalle de ventas sin paginar | 🟢 CORREGIDO | Rango validado, fechas futuras rechazadas, detalle paginado. |
| **DAT-007** | P3 | 4 relaciones `eager: true` | 🟢 CORREGIDO | Sin entidades eager. |
| **DAT-008** | P3 | Truncamiento silencioso del historial | 🟢 CORREGIDO | `PaginatedResponseDto` con `total`. |
| **DAT-009** | P2 | `GET /usuarios` sin paginación | 🟢 CORREGIDO | `page`/`limit` acotados, `COUNT(*)`. |
| **DAT-010** | P2 | `statusCode: 200` fijo en idempotencia | 🟢 CORREGIDO | `idem_estado` y reproducción del estado real. |
| **V2-DAT-01** | P3 | `escapeLike` dependía del `ESCAPE` por defecto | 🟢 CORREGIDO | Las consultas `ILIKE` declaran `ESCAPE '\'`. |

**Veredicto DAT: 11/11.** El bloque no ha recibido hallazgos nuevos en dos iteraciones, y V4 amplía el modelo en la dirección correcta: más tablas, no más JSON.

---

## 8. Concurrencia e idempotencia — 5 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **CON-001** | P1 | La clave de idempotencia no se reservaba antes de ejecutar | 🟢 CORREGIDO | `idempotency.service.ts:56-62`: *claiming* atómico; 409 si no reservó o si la carga difiere; `DELETE` liberador si falla. |
| **CON-002** | P1 | Dentro de la transacción se leía con el repositorio global | 🟢 CORREGIDO | Lectura y escritura sobre el mismo `Sql` transaccional. |
| **CON-003** | P1 | `cancel` y `confirm` mutaban fuera de transacción | 🟢 CORREGIDO | `FOR UPDATE` antes de comprobar y mutar. |
| **CON-004** | P2 | Código de reserva con *read-then-write* | 🟢 CORREGIDO | `DEC-` + 6 aleatorios con reintento ante `23505`. |
| **V2-CON-01** | P3 | Caché de sesión por instancia | 🟢 **CORREGIDO** *(V3: 🟡 parcial)* | **La caché se eliminó.** `session.service.ts` no contiene ningún `Map`, ni `TTL_MS`, ni constante de caché: cada petición consulta `sesion` (línea 63+) y recalcula roles y alcance desde `usuario_rol ⋈ rol`. La ventana de revocación es ahora **cero**, que era la corrección de fondo que V3 pedía. *Matiz:* el coste por petición es una consulta adicional, aceptable porque la API corre en `gru1` junto a la base. **Nota de diseño relacionada:** `"fluid": true` en V4 es precisamente lo que hace tolerable eliminar la caché, porque reduce los arranques en frío que la.cache amortiguaba. Las dos decisiones encajan. |

**Veredicto CON: 5/5.** El punto que V1HMS dio por «no cumple» y V3 dejó en 3 segundos de ventana queda cerrado por eliminación de la causa, no por ajuste del parámetro.

---

## 9. Frontend — 14 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **WEB-001** | P2 | Sin Open Graph ni Twitter Card | 🟢 CORREGIDO | `index.html` con `og:*` y `twitter:card`. |
| **WEB-002** | P2 | Sin `canonical`, `robots.txt`, `sitemap.xml` | 🟢 CORREGIDO | Los cuatro presentes; el `sitemap.xml` pasa a generarse en el build. |
| **WEB-003** | P2 | Sin SSR/SSG | 🟢 **CORREGIDO** *(V3: 🟡 parcial)* | `frontend/scripts/prerender.mjs` genera en el build el HTML de cada página pública y de cada atracción publicada, con título, descripción, canonical, Open Graph, `schema.org/TouristTrip` y contenido visible en `#root`, más `sitemap.xml` con todas las URLs. Continúa siendo una SPA en ejecución —no hay *hydration*— pero el requisito de SEO queda cubierto por HTML propio, que es lo que V3 condicionó («si el SEO es requisito, queda pendiente»). **Con un límite:** solo las primeras 100 atracciones (**V4-CAL-02**). |
| **WEB-004** | P2 | Sin *code splitting* de CSS | 🟢 CORREGIDO | El panel se carga con `lazy()`. **V4 añade `lazyRecarga` y `Suspense`** en `AtraccionForm.jsx` para que Leaflet y su CSS no entren en el bundle del formulario hasta abrirlo. |
| **WEB-005** | P2 | Google Fonts bloquea el render | 🟢 CORREGIDO | `preconnect` + `font-display: swap` + preload. |
| **WEB-006** | P2 | 6 de 12 imágenes sin `loading="lazy"` | 🟢 **CORREGIDO** *(comprobado en V4)* | Barrido sobre `frontend/src`: **14 `<img>` y 15 declaraciones de `loading`**. Ninguna imagen depende del valor por defecto del navegador; los 3 `eager` son la vista previa local (`blob:`), la foto abierta y la primera de la galería (`fetchpriority: 'high'`, LCP). |
| **WEB-007** | P2 | 7 páginas públicas en el bundle inicial | 🟢 CORREGIDO | 21 importaciones `lazy()` en `App.jsx`. |
| **WEB-008** | P2 | Token JWT en `localStorage` | 🟡 **PARCIAL** *(V3: 🟡 parcial)* | **Mejora substancial y real: DPoP (RFC 9449).** El navegador genera un par ECDSA P-256 con llave **no exportable** (WebCrypto, persistida en IndexedDB), el login liga el token a la llave con `cnf.jkt`, y cada petición lleva una prueba firmada con método, URL, hora, `jti` y `ath`. Un token robado por XSS no sirve fuera del navegador. `dpop.spec.ts` y `dpop.e2e-spec.ts` lo cubren en backend. **Lo que impide cerrarlo:** (a) el token sigue siendo accesible desde JavaScript, que es la premisa de WEB-008; (b) **la sesión emitida por Google no queda ligada, porque `client.js:65` no incluye `/auth/google` en el conjunto que genera prueba (V4-SEG-01)**; (c) el estado anti-repetición es por instancia (**V4-SEG-02**). Se mantiene la sesión por pestaña en `sessionStorage`, como pidió el usuario, y los dos usos de `localStorage` siguen siendo limpiezas de migración. |
| **WEB-009** | P3 | `xlsx` desde CDN | 🟢 CORREGIDO | Versión 0.20.3 fijada. |
| **WEB-010** | P3 | `useAsync` con deps dinámicas | 🟢 CORREGIDO | `useCallback` con dependencias explícitas. |
| **WEB-011** | P3 | Sin reintento con *backoff* | 🟢 CORREGIDO | Reintento exponencial en peticiones idempotentes. |
| **WEB-012** | P3 | `overflow: hidden` se quedaba pegado | 🟢 CORREGIDO | `finally` en el *cleanup*. |
| **WEB-013** | P3 | Falta `decoding="async"` y dimensiones | 🟢 CORREGIDO | Aplicado, con `aspect-ratio` en las tarjetas. |
| **WEB-014** | P3 | `Spinner` sin texto visible | 🟢 CORREGIDO | `role="status"` + «Cargando…». |

**Veredicto WEB: 13 🟢, 1 🟡.** WEB-003 pasa a cerrado y el único parcial es WEB-008, cuya mitigación pasó de «el token está en `sessionStorage` y hay CSP» a «el token está ligado criptográficamente a una llave que el atacante no tiene». **Es la diferencia entre reducir la probabilidad y eliminar la capacidad**, y es la clase de corrección que V3 viene exigiendo desde el primer informe. Lo que falta para el cierre completo son 5 minutos de código y una decisión de producto sobre la cookie `httpOnly`.

---

## 10. Despliegue y operación — 10 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **OPS-001** | P1 | `require` fuera del `try` en el *entry point* | 🟢 CORREGIDO | `api/index.js:9` dentro del `try`, con reintento, 503 `application/problem+json` y `Retry-After`. La credencial se sanea (`.replace(/postgres(ql)?:\/\/\S+/g, '[DATABASE_URL]')`). |
| **OPS-002** | P1 | `maxDuration: 60` con pool propio | 🟢 CORREGIDO **con matiz nuevo** | `app.module.ts:49` mantiene `max: DB_POOL_MAX` con defecto `1` en producción y `connectionTimeoutMillis: 10000`. **V4 añade `"fluid": true`**, que permite varias peticiones concurrentes por instancia, de modo que el pool de 1 deja de ser coherente con el modelo de ejecución (**V4-OPS-03**). El hallazgo original —pool desmedido frente a `maxDuration`— sigue cerrado en su substance. |
| **OPS-003** | P2 | El *catch-all* capturaba `/uploads/*` | 🟢 CORREGIDO | `vercel.json:22`, *negative lookahead* que excluye `img/`, `uploads/` y `vendor/`. |
| **OPS-004** | P2 | Sin cierre ordenado | 🟢 CORREGIDO | `enableShutdownHooks()` y `finally` en migraciones. |
| **OPS-005** | P2 | Sin logger estructurado ni `request-id` | 🟢 CORREGIDO | `JsonLogger` + `registroPeticiones` con `request_id`, método, ruta **sin query string**, estado y duración; métricas por instancia en `/health`. **V4 amplía `/health`:** informa el estado real del bucket privado (`storage.status`), lo que sirve de comprobación indirecta de que `SUPABASE_SERVICE_ROLE_KEY` es la de servidor. |
| **OPS-006** | P2 | `envFilePath: '.env'` fijo | 🟢 CORREGIDO | `['.env.local', '.env']` con `ignoreEnvFile` en producción. |
| **OPS-007** | P2 | Nada exigía que el secreto fuera fuerte | 🟢 CORREGIDO | `env.validation.ts:13-16`. |
| **OPS-008** | P3 | `.env*` ocultaba `.env.example` | 🟢 **CORREGIDO** *(comprobado en V4)* | `git ls-files` devuelve los dos `.env.example` versionados; `backend/.env` existe en local y no está versionado. |
| **OPS-009** | P3 | `.env.production` conservado en disco | 🟢 CORREGIDO | No existe. |
| **V2-OPS-01** | P2 | Las migraciones se ejecutaban en el *build* | 🟢 **CORREGIDO** *(con el matiz de V3 sin resolver)* | `run-migrations.ts:15-20` corta **antes de abrir la conexión** si `VERCEL_ENV != production`. **El matiz que V3 señaló sigue exactamente igual:** las líneas 34-35 ejecutan `configurarBucket()` y `moverImagenesAStorage()` en ese mismo paso, así que **un build de producción muta estado externo**. Ambas son idempotentes por diseño (el `PUT` del bucket fija los mismos valores; la migración solo toca filas que apuntan a `/img/%`), pero la observación de V3 sigue siendo válida y V4 la mantiene: un build no debería reconfigurar un bucket ni mover objetos. |
| **V4-OPS-01** | P3 | Las fotos consumen el límite global | 🆕 **NUEVO** | `/api/v1/media/*` bajo el `ThrottlerGuard` global. Ver §3. |
| **V4-OPS-02** | P3 | Nominatim sin control de frecuencia | 🆕 **NUEVO** | `MapaUbicacion.jsx`. Ver §3. |
| **V4-OPS-03** | P3 | Fluid Compute sin techo de concurrencia | 🆕 **NUEVO** | `vercel.json:7` vs `app.module.ts:49`. Ver §3. |


**Veredicto OPS: 10 🟢, 3 🆕.** El bloque conserva sus fortalezas —logger estructurado, métricas, `/health` que verifica base, migraciones y almacenamiento— y los tres hallazgos nuevos son de **acoplamiento entre decisiones correctas por separado**: media privado × límite global, mapa × política de uso de un tercero, Fluid Compute × pool de 1. Ninguno es un error en sí mismo; los tres son consecuencia de haber ampliado el sistema sin revisar las suposiciones de los controles existentes.

---

## 11. Calidad, arquitectura y DevOps — 16 hallazgos

| ID | Sev. V1 | Hallazgo | Estado | Evidencia en V4 |
|---|:-:|---|:-:|---|
| **CAL-001** | P1 | `eslint` no instalado | 🟢 CORREGIDO | Flat config en backend y frontend. **`npm run lint` → exit 0 en ambos**, ejecutado en V4. |
| **CAL-002** | P1 | Cero tests | 🟢 CORREGIDO | **Backend 22 suites / 124 tests** (V3: 18 / 109), incluidas `dpop`, `dpop.e2e`, `media`, `storage.service`, `imagenes-storage`, `auth-google`, `atraccion.mapper`, `contract-coverage` y `dto-validation`. **Frontend 8 / 27, sin cambios**, y sin una sola prueba del código nuevo de navegador (**V4-CAL-01**). |
| **CAL-003** | P1 | `strictNullChecks: false` | 🟢 CORREGIDO | `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`. **`npx tsc --noEmit` → exit 0.** |
| **CAL-004** | P1 | No hay CI | 🟢 CORREGIDO | 6 jobs: `backend`, `database`, `frontend`, `secrets`, `codeql`, `dependency-review`. |
| **CAL-005** | P2 | `api/index.js` en un proyecto TS | 🟢 CORREGIDO | Sigue siendo `.js` a propósito, con el motivo escrito. |
| **CAL-006** | P2 | ~1 500 líneas de código inerte | 🟢 CORREGIDO | Los módulos de vuelos, autos y alojamientos siguen fuera del árbol. |
| **CAL-007** | P2 | `dist/` en el árbol de trabajo | 🟢 CORREGIDO | Ignorado; `deleteOutDir: true`. |
| **CAL-008** | P2 | El README declara comportamientos no cumplidos | 🟡 **PARCIAL** *(V3: 🟢 corregido — reabierto)* | **Se reabre por una afirmación concreta y verificable.** La tabla de «Decisiones documentadas» del README es, en general, exemplary: declara el bucket (ahora privado), Swagger *opt-in*, `badges` ignorados al escribir, carrito y cupones sin interfaz y verificación de correo ausente. **Pero tres documentos afirman que la sesión de Google va «ligada con DPoP» / «con DPoP»** (`CHANGELOG.md` 2.4.0, `docs/CORRECCIONES-V3.md:50`, `frontend/src/utils/google.js:12`) y el código no lo cumple (`client.js:65`, **V4-SEG-01**). Un README que declara limitaciones es un activo; un README que afirma una protección que no existe es un pasivo, porque dirige la revisión hacia donde no hay problema. La corrección es de una línea en el cliente y de tres en la documentación. |
| **CAL-009** | P2 | Credenciales de producción en el README | 🟢 CORREGIDO | `README.md:81-82` no publica contraseñas con permisos administrativos. Sin cambios en V4. |
| **CAL-010** | P2 | 38 animaciones, 1 `prefers-reduced-motion` | 🟢 CORREGIDO | Respetado globalmente; scroll suave deshabilitado con `matchMedia`. |
| **CAL-011** | P3 | Scopes del código ausentes del contrato | 🟢 CORREGIDO | Los 7 scopes coinciden. |
| **CAL-012** | P3 | `currency` sin formato ISO 4217 | 🟢 CORREGIDO | `@Matches` contra la lista ISO 4217. |
| **CAL-013** | P3 | `LocationDto` modela un array, se lee `[0]` | 🟢 CORREGIDO | Se rechaza con 400 más de una ubicación. |
| **CAL-014** | P3 | `details` sin `@ArrayMaxSize` ni `@IsUUID` | 🟢 CORREGIDO | `@IsUUID('4', { each: true })` y `@ArrayMaxSize(50)`. |
| **CAL-015** | P3 | Sin `engines` ni `.nvmrc` | 🟢 CORREGIDO | `engines.node >= 20.11`, `.nvmrc` en ambos paquetes, CI con `node-version-file`. |
| **V2-CAL-01** | P2 | CI sin SAST ni *dependency review* | 🟢 CORREGIDO | Las cuatro carencias de V2, una por una: `--audit-level=high` sobre **todas** las dependencias, job `codeql` con `security-extended`, `dependency-review` con `fail-on-severity: high`, y subida a NestJS 11 con **0 vulnerabilidades**. |
| **V4-CAL-01** | P3 | Código frontend nuevo sin pruebas | 🆕 **NUEVO** | Ver §3. |
| **V4-CAL-02** | P3 | Pre-renderizado topado en 100 atracciones | 🆕 **NUEVO** | Ver §3. |
| **V4-CAL-03** | P3 | `frontend/image.png` corrupto sin rastrear | 🆕 **NUEVO** | Ver §3. |

**Veredicto CAL: 15 🟢, 1 🟡, 3 🆕.** El bloque se mantiene en 15 de 16 y el reabierto es de documentación, no de código. Los tres hallazgos nuevos se concentran en la misma brecha: **el código nuevo que se ejecuta en el navegador no tiene red de seguridad** —ni pruebas, ni paginación, ni limpieza de artefactos—, mientras que el código nuevo del backend sí la tiene.

---

## 12. Plan de corrección priorizado (V4)

### Ningún P0 ni P1 abierto

Los diez hallazgos nuevos son P2 o P3. Esto no significa que no haya trabajo: significa que el trabajo es de **coherencia**, no de construcción.

### P2 — Antes de la evaluación

| # | ID | Acción | Esfuerzo |
|:-:|---|---|---|
| 1 | **V4-SEG-01** | Añadir `/auth/google` a la condición de `conPrueba` en `client.js:65` y corregir los tres comentarios que afirman lo contrario. El resultado es observable en la cabecera `Authorization`. | ~5 min |
| 2 | **WEB-008** *(cierre completo)* | Lo anterior cubre la sesión de Google. Para cerrar el hallazgo por completo haría falta además migrar a cookie `httpOnly; secure; sameSite=strict` + token CSRF, lo que requiere tocar el guard. Decisión de producto, no urgente. | ~4 h |
| 3 | **V4-OPS-03** | Relationar `DB_POOL_MAX` con la concurrencia por instancia de Fluid Compute, o fijar `maxConcurrency` explícitamente en `vercel.json`. | ~15 min |
| 4 | **V4-OPS-01** | `@SkipThrottle()` en `MediaController` y *streaming* del objeto en lugar de acumularlo en memoria. | ~30 min |
| 5 | **V2-OPS-01** *(matiz)* | Extraer `configurarBucket()` y `moverImagenesAStorage()` de `run-migrations.ts` a un paso explícito de despliegue. Sin cambios desde V3. | ~20 min |
| 6 | **API-014** *(opcional)* | `ope_codigo` como `GENERATED BY DEFAULT AS IDENTITY`, eliminando el `MAX+1`. El *advisory lock* ya lo hace correcto. | ~30 min |

### P3 — Deuda técnica documentada

- **V4-ACC-01** — `role="region"` en el contenedor del mapa (5 min).
- **V4-ACC-02** — `role="alert"` en el mensaje de `ListEditor` (2 min).
- **V4-CAL-03** — borrar `frontend/image.png` (1 min).
- **V4-CAL-02** — paginar `prerender.mjs` y fallar el build si la última página viene llena (20 min).
- **V4-SEG-02** — estado anti-repetición de DPoP compartido, o al menos sustituir `clear()` por borrado de vencidos (20 min).
- **V4-OPS-02** — *debounce* y `AbortController` en las llamadas a Nominatim (20 min).
- **V4-CAL-01** — pruebas de `dpop.js` y de regresión sobre `client.js` (2 h).
- **SEG-016** — verificación de correo en la rama de contraseña, si algún día hay proveedor.
- **SEG-010** — confirmar el valor de `SUPABASE_SERVICE_ROLE_KEY` en el panel.
- **API-014** *(opcional)* — secuencia para `ope_codigo`.

### Acciones **fuera del repositorio** (no verificables por auditoría de código)

1. Rotar la contraseña de Supabase y sustituir el rol `postgres` (**SEG-001**).
2. Revocar el vínculo OIDC de Vercel y revisar los logs de despliegue (**SEG-002**).
3. Confirmar que `SUPABASE_SERVICE_ROLE_KEY` es la clave de servidor (**SEG-010**). El `/health` ahora informa `storage.status: UP`, lo que es un indicio útil.
4. Confirmar que `SEED_ON_START=false` está en el panel, aunque la API ya no arranque si no lo está (**V2-SEG-01**).
5. Ejecutar 6 POST seguidos a `/auth/login` y confirmar el `429`; repetir la prueba desde una página con fotos para medir el efecto de **V4-OPS-01**.
6. Ejecutar `axe-core` y Lighthouse sobre `/`, `/explorar`, `/atraccion/:id`, `/reservar/:id`, `/empresas`, `/mis-reservas`, `/ingresar` y `/admin` — en particular **`/admin`**, que es donde V4 haul dos hallazgos nuevos.

---

## 13. Matriz de verificación rápida (V4)

Checklist para reevaluar tras aplicar el plan. Los ítems marcados ✅ se verificaron **en esta auditoría**.

### Seguridad
- [x] ✅ `git ls-files` solo devuelve los 2 `.env.example`; `backend/.env` no está versionado (**SEG-001**, **SEG-002**, **OPS-008**)
- [x] ✅ `storage.service.ts` valida *magic bytes* y deriva la extensión del tipo detectado; el filtro del servidor acepta solo `image/(jpeg|png|webp)` (**SEG-007**)
- [x] ✅ `objetoValido` no admite `..`: el tallo es `[\w-]{1,80}`, sin punto (**SEG-008**)
- [x] ✅ `MediaController` exige objeto en uso o firma HMAC válida; cualquier otro caso → 404 (**SEG-008**)
- [x] ✅ CORS incluye la cabecera `DPoP` en `allowedHeaders` (**SEG-020**)
- [x] ✅ `npm audit` → **0 vulnerabilidades** en backend y frontend, incluidas las de desarrollo
- [x] ✅ `contract-coverage.spec.ts` verde con dos rutas nuevas añadidas al contrato y a las internas (**API-015**)
- [ ] **`POST /auth/google` devuelve un token usado como `Authorization: DPoP` y no `Bearer`** (**V4-SEG-01**) — comprobable en la pestaña Network sin laboratorio
- [ ] Confirmar en Supabase que la contraseña se rotó y que el rol ya no es `postgres` (**SEG-001**)
- [ ] Confirmar que `SUPABASE_SERVICE_ROLE_KEY` es la clave de servidor (**SEG-010**)
- [ ] 6 POST a `/auth/login` seguidos devuelven **429**

### Accesibilidad
- [x] ✅ 14 `<img>` y 15 declaraciones de `loading`; ninguna depende del valor por defecto (**WEB-006**)
- [x] ✅ 4 `target="_blank"` y 4 `rel="noopener"` (**ACC-034**)
- [x] ✅ `.demo-box button` con `border: 1px solid var(--border-strong)` (**V3-ACC-01**)
- [x] ✅ `Empresas.jsx:31` mueve el foco al `h2` nuevo (**V3-ACC-02**)
- [x] ✅ `ui.jsx:288` asigna `role="alert"` a los errores de `Field` (**ACC-023**)
- [ ] **El contenedor del mapa expone su nombre a un lector de pantalla** (**V4-ACC-01**)
- [ ] **El error de «Incluye» / «No incluye» se anuncia al aparecer** (**V4-ACC-02**)
- [ ] axe DevTools: **0 violaciones críticas** en las ocho rutas, con atención a `/admin`
- [ ] Lighthouse Accessibility ≥ 95

### API y datos
- [x] ✅ Backend y frontend ambos en `2.4.3` (**API-008**)
- [x] ✅ `session.service.ts` sin caché en memoria (**V2-CON-01**)
- [ ] **`prerender.mjs` falla si hay más de 100 atracciones sin paginar** (**V4-CAL-02**)

### Calidad y operación
- [x] ✅ `npm run lint` → exit 0 en backend y frontend (**CAL-001**)
- [x] ✅ `npx tsc --noEmit` → exit 0 (**CAL-003**)
- [x] ✅ `npm test` → **22 suites / 124 tests** backend, **8 / 27** frontend (**CAL-002**)
- [x] ✅ 0 coincidencias de `innerHTML` / `dangerouslySetInnerHTML` / `eval` / `new Function` (**WEB-008**)
- [ ] **`dpop.js` y `client.js` tienen pruebas de regresión** (**V4-CAL-01**)
- [ ] **`DB_POOL_MAX` es coherente con `fluid: true`** (**V4-OPS-03**)
- [ ] **`/api/v1/media` no consume el cupo del límite global** (**V4-OPS-01**)

---

## 14. Limitaciones de esta auditoría

1. **No se ejecutó la aplicación.** No hay servidor arrancado, ni base de datos levantada, ni E2E local. Los resultados de `jest` son **unitarios**: el comportamiento end-to-end de migraciones, seed, RLS, Storage, *streaming* de media y concurrencia se infiere del código y de los tests que CI declara ejecutar, no de una ejecución observada.
2. **No se ejecutó el build.** `prerender.mjs` no se ejecutó contra la API real, de modo que el defecto de paginación (**V4-CAL-02**) se deduce de la lectura del código, no de un fallo observado. Lo mismo vale para la coherencia entre `fluid: true` y el pool (**V4-OPS-03**).
3. **Los valores del panel de Vercel y de Supabase no son verificables desde el repositorio.** SEG-001, SEG-002, SEG-008 y SEG-010 mantienen acciones fuera del repositorio. Que `backend/.env` exista en local **no demuestra** nada sobre el panel de producción.
4. **ACC-026 se cierra con evidencia ajena.** La tabla de contraste la publica `docs/CORRECCIONES-V3.md`; esta auditoría no reprodujo la medición, porque requiere navegador y la fotografía real.
5. **No se auditó una por una las 43+ tablas ni las 70+ operaciones** más allá de CodeQL (que corre en CI, no localmente). La revisión de SQL fue manual y dirigida a las clases de fallo de V1–V3.
6. **No se inspeccionó el bucket de Supabase.** El veredicto de SEG-008 se apoya en lo que el código *configura* (`public: false`) y en lo que `estado()` *reporta*, no en una lectura de la configuración real del proyecto.
7. **V4-SEG-01 se deduce del código, pero es trivialmente comprobable.** La afirmación «la sesión de Google va ligada con DPoP» se puede verificar en la pestaña Network sin ninguna infraestructura; esta auditoría lo dedujo de `client.js:63-65` y de `contexto()` en el guard.

---

## 15. Resumen final

**V4 es la primera iteración en la que el proyecto no corrige un hallazgo importante, sino que cierra los que las auditorías anteriores habían dado por definitivos.** Los 136 identificadores previos están evaluados uno a uno: **132 cerrados, 4 parciales, ninguno no verificable, ninguno aggravado.** Se cierra el último 🔵 (ACC-026), los dos 🟡 de concurrencia y SEO (V2-CON-01 y WEB-003), el SEG-008 que V3 había reducido a «decisión documentada», y los tres P3 de V3 que quedaron abiertos. **No queda ningún P0. No queda ningún P1. No queda ningún hallazgo abierto por falta de decisión.**

Los dos cambios de mayor alcance de esta iteración están bien resueltos en su parte difícil:

1. **El bucket privado (SEG-008) es una corrección de fondo, no un parche.** En lugar de dejar la URL pública y confiar en que el bucket «solo contiene fotos del catálogo», ahora la API decide qué se sirve: valida que el objeto esté en uso, exige firma para lo recién subido, rechaza el *path traversal* por construcción y expone el estado real en `/health`. V3 lo había dejado como decisión documentada con controles compensatorios; V4 lo resuelve.

2. **DPoP (WEB-008) es el tipo de corrección que este proyecto venía persiguiendo desde V1.** No reduce la probabilidad de robo de token: elimina la capacidad de usarlo. Llave no exportable, `ath` sobre el token, `htm`/`htu`, `jti` anti-repetición, y pruebas de integración que demuestran que el mismo token usado como Bearer o sin prueba devuelve 401. Es la diferencia entre un control y una garantía.

**Y V4 encuentra exactamente el defecto que ese mismo cambio introduce, lo cual es la mejor noticia posible sobre el proceso.** La sesión emitida por Google no queda ligada a DPoP porque `client.js:65` no incluye `/auth/google` en el conjunto de rutas que generan prueba. Es una línea, es un residuo de la ampliación, y —esto es lo importante— **es visible desde el navegador sin ninguna herramienta**. El proyecto detectó dos de sus tres códigos nuevos en backend con pruebas completas y el tercero, el que decide si la prueba criptográfica se envía, sin ninguna. Esa asimetría es el hallazgo de fondo de esta iteración, y V4-CAL-01 la nombra: **la disciplina de pruebas llega al servidor y no llega al navegador.**

Lo que queda son doce puntos, nueve de ellos P3, y conviene nombrarlos con precisión porque ninguno es una frontera de confianza rota:

- **Un P2 de coherencia**, no de diseño: una línea de cliente que no envía la prueba que la documentación promete (V4-SEG-01).
- **Dos P2 de alcance declarado**: SEG-016 (el registro con contraseña deja `usu_verificado = FALSE` para siempre) y CAL-008 (tres documentos afirman una protección que el código no aplica). Ambos se corrigen en minutos.
- **Dos P3 de acoplamiento**, consecuencia de ampliar el sistema sin revisar las suposiciones de controles existentes: las imágenes del catálogo heredaron el *rate limiting* global de la API (V4-OPS-01), y el mapa consulta a Nominatim sin respetar su política de 1 petición por segundo (V4-OPS-02).
- **Un P3 de configuración**: Fluid Compute permite concurrencia por instancia, pero el pool sigue en una conexión (V4-OPS-03).
- **Cinco P3 de robustez y accesibilidad del código nuevo**, que comparten una causa —los componentes de navegador añadidos en estos 14 commits se escribieron sin reutilizar el patrón que el proyecto ya tenía cerrado—: dos accesibilidad (V4-ACC-01, V4-ACC-02) y tres robustez (V4-CAL-01 sin pruebas, V4-CAL-02 sin paginación, V4-CAL-03 con un residuo en el árbol), más el estado anti-repetición en memoria por instancia (V4-SEG-02).

**Una observación de gestión para cerrar.** V3 escribió que las correcciones ya no dependían de la disciplina de quien escribe, porque el sistema las mantenía solo: `contract-coverage.spec.ts`, CodeQL `security-extended`, `dependency-review` y `npm audit --audit-level=high`. V4 confirma que esa afirmación se sostiene —los cuatro controles siguen verdes y el bloque de API y datos no recibe un solo hallazgo nuevo— **pero le añade una condición que V3 no había formulado: los controles automáticos cubren lo que se ejecuta en el servidor, y no cubren el navegador.** La única forma de cerrar esa asimetría sin añadir procesos es escribir la prueba que falta (`dpop.js` y una de regresión sobre `client.js`), que es también la que habría detectado V4-SEG-01 antes de publicar tres documentos que lo afirman resuelto.

**Y el resto es coherencia.** Ocho hallazgos nuevos son P3, diez en total, y cuatro de ellos son la misma regla mal recordada: *reutilizar el componente que ya existe en lugar de escribir el equivalente*. Un `div` con `aria-label` sin rol, que ACC-018 ya cerró; un `span` de error sin `role="alert"`, que ACC-023 ya unificó; un spinner sin `role="status"`, que WEB-014 ya resolvió; un `<details>` sin `role="group"`, que ACC-008 ya documentó. No son defectos nuevos: son la misma clase de error, y es la primera vez que aparecen **cuatro veces en la misma iteración**. La corrección es siempre la misma y siempre barata, y es la que este proyecto ha demostrado que sabe aplicar.