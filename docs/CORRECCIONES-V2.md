# Correcciones de la reauditoría V2 — versión 2.0.0

Respuesta a los hallazgos que la reauditoría V2 (sobre el commit `854ea6c`) dejó **abiertos**: 1 vigente, 11 parciales, 1 no verificable y 7 nuevos. Los 113 marcados 🟢 en V2 no se repiten aquí.

Hay dos estados posibles:
- **Corregido:** el defecto ya no existe y hay una prueba o un comando que lo demuestra.
- **Aceptado:** se mantiene por una decisión de diseño explícita, con mitigaciones y el motivo documentado.

## Resumen

| Estado | Hallazgos |
|---|---|
| ✅ Corregido (16) | V2-SEG-01, V2-OPS-01, V2-CAL-01, V2-SEG-02, V2-CON-01, V2-DAT-01, API-015, CAL-009, SEG-014, SEG-010, SEG-013, SEG-019, OPS-005, ACC-001, ACC-026, WEB-006 |
| 🟦 Aceptado con justificación (4) | SEG-008, WEB-008, WEB-003, SEG-016 |

## Detalle

| ID | Sev. | Qué se hizo | Evidencia |
|---|:-:|---|---|
| **V2-SEG-01** | P1 | **Seed *fail-closed*:**<br>• En producción la API no arranca si `SEED_ON_START` no es exactamente `false`.<br>• `SeedService` no siembra al arrancar en producción, y `sembrar()` lanza un error salvo `SEED_DEMO_EN_PRODUCCION=true`.<br>• En Vercel, `SEED_ON_START=false` está fijado explícitamente. | `env.validation.ts`, `seed.service.ts`, `env.validation.spec.ts` («en producción exige SEED_ON_START=false») |
| **V2-OPS-01** | P2 | `run-migrations.ts` solo aplica DDL si `VERCEL_ENV` es `production` (o fuera de Vercel: local y CI). Los *previews* de ramas y PR compilan sin tocar la base. Cada migración corre en su propia transacción con *advisory lock* y *checksum*. | `backend/src/database/run-migrations.ts` |
| **V2-CAL-01** | P2 | **CI:**<br>• Job `codeql` (`security-extended`).<br>• `dependency-review` en los PR (falla con `high`).<br>• `npm audit --audit-level=high` sobre **todas** las dependencias, también las de desarrollo.<br><br>**Dependencias:**<br>• Backend en NestJS 11 / Express 5 (multer 2.4), con *override* de `js-yaml` 5.4.2.<br>• Frontend en Vite 8 y React Router 7. | `.github/workflows/ci.yml`; `npm audit` → **0 vulnerabilidades** en `backend/` y `frontend/` |
| **V2-SEG-02** | P3 | **Tipos de error:**<br>• Las URIs `type` usan el dominio de la API (`PUBLIC_URL`) y se resuelven en `GET /api/v1/errores/{tipo}`.<br>• No queda ningún `booking-hub` en el código.<br><br>**Idempotency-Key:** el guard ya no refleja el valor recibido. | `common/errors/problem-types.ts`, `ErroresController`, `problem-types.spec.ts` |
| **V2-CON-01** | P3 | La caché de sesión por instancia bajó de 15 s a **3 s**: es la ventana máxima de revocación entre instancias serverless. | `session.service.ts` (`TTL_MS = 3_000`) |
| **V2-DAT-01** | P3 | `ESCAPE '\'` explícito en los 13 `ILIKE` parametrizados (atracciones, reservas y usuarios). | `grep -rn "ESCAPE" backend/src` |
| **API-015** | P3 | `contract-coverage.spec.ts` lee el contrato OpenAPI y las rutas reales de Nest (metadatos de los controladores). Comprueba tres cosas:<br>1. Lo que promete el contrato está implementado.<br>2. Toda ruta implementada está en el contrato o declarada como interna en `contracts/operaciones-internas.json`.<br>3. No hay entradas obsoletas en esa lista. | `npm test` (4 pruebas), ejecutado en CI |
| **CAL-009 / SEG-014** | P1/P2 | **Producción:** se rotaron las contraseñas de administrador y operador; se entregan por privado.<br><br>**Credenciales publicadas:** el README, la guía de defensa y la pantalla de login solo muestran la cuenta de **cliente**, que no tiene permisos administrativos.<br><br>**Seed:** bloqueado en producción (V2-SEG-01), así que no puede recrear las contraseñas conocidas. | `README.md`, `AuthForms.jsx`, `docs/GUIA-DEFENSA.md` |
| **SEG-010** | P1 | `GET /atracciones/health` incluye `storage`: lee la configuración del bucket con la clave de servidor (la clave pública no puede hacerlo) y la responde sin exponer la clave. | `storage.status: "UP"` en producción |
| **SEG-013** | P1 | La idempotencia guarda `{ ref: <uuid de la reserva> }` en vez del cuerpo con nombre, correo, teléfono y documento. Al repetir la petición, la respuesta se reconstruye desde `reserva`. TTL de 24 h. | `idempotency.service.ts` (`Referencia`), prueba «guarda solo el identificador (sin PII)» |
| **SEG-019** | P2 | Swagger y Redoc son *opt-in* en producción: `ENABLE_DOCS=true`, activado porque la rúbrica pide la documentación pública. Swagger UI se copia de `node_modules` en `postinstall`, Redoc 2.1.5 está versionado con su licencia MIT, y la CSP ya no permite `cdn.jsdelivr.net`. | `app.factory.ts`, `scripts/vendor-docs.js`, `public/vendor/` |
| **OPS-005** | P2 | **Logs:**<br>• En producción, `JsonLogger` y un registro por petición en JSON de una línea: `time`, `level`, `request_id`, `method`, `path` (sin query), `status`, `duration_ms`.<br>• Sin cuerpos ni datos personales.<br><br>**Métricas** de la instancia en `/health`: peticiones, 4xx, 5xx, lentas y *uptime*. | `common/logging/json-logger.ts` |
| **ACC-001** | P1 | En superficies oscuras (sidebar del panel, pie, hero, login y toasts) el anillo de foco es ámbar `#fcd34d` con halo oscuro. Medido en el navegador: **8,6:1** en el pie y el sidebar, y **5,1:1** el anillo verde en la barra clara. | `styles/base.css` |
| **ACC-026** | P3 | La cabecera transparente sobre la foto ya no existe: el inicio usa la misma barra sólida de las demás páginas. | `PublicLayout.jsx` |
| **WEB-006** | P2 | Las 2 imágenes sin `loading` son visibles de inmediato: la foto abierta en el visor y la vista previa local de una subida. Declaran `loading="eager"` explícito. Las demás son `lazy`. | `AttractionDetail.jsx`, `AtraccionForm.jsx` |

## Aceptados con justificación

| ID | Decisión | Mitigaciones |
|---|---|---|
| **SEG-008** (bucket público) | Las fotos del catálogo son contenido público que cualquier visitante debe ver. El usuario pidió explícitamente el esquema de Sal y Canela: bucket de Supabase y URL pública guardada en la tabla. Las *signed URLs* caducarían en las tarjetas, en el caché del CDN y en los enlaces compartidos. | La clave de servidor solo vive en Vercel y nunca llega al navegador. El bucket rechaza todo lo que no sea JPG/PNG/WebP de ≤ 4 MB, y la API valida los *magic bytes* antes de subir. Solo el personal con el scope `attractions:write` puede subir, con un límite de 30 por hora. |
| **WEB-008** (token accesible desde JS) | Requisito del usuario: **una sesión por pestaña**. Una cookie `httpOnly` se comparte entre todas las pestañas del navegador, que es justo lo que se pidió evitar. Además, frontend y API están en subdominios distintos de `vercel.app`, que es un sufijo público, así que la cookie sería *cross-site* y la bloquearían los navegadores. | El token está en `sessionStorage` (por pestaña, se borra al cerrarla). La CSP es estricta y no permite *inline scripts*. No hay `innerHTML`, `dangerouslySetInnerHTML` ni `eval`. El token expira en 2 h y la sesión se revoca en el servidor, con propagación en ≤ 3 s. |
| **WEB-003** (SPA sin SSR) | El SEO no es criterio de la rúbrica. Migrar a SSR/SSG cambiaría la arquitectura del frontend sin aportar a la evaluación. | Open Graph y Twitter Card, `canonical`, `robots.txt`, `sitemap.xml`, título por ruta y datos estructurados. |
| **SEG-016** (sin verificación de correo) | El proyecto no tiene un proveedor de correo (SMTP o servicio transaccional). Verificar sin enviar correos no tiene sentido. | El registro está limitado por IP, las contraseñas siguen una política mínima y una cuenta nueva solo puede reservar para sí misma. Queda documentado como trabajo futuro. |

## Acciones fuera del repositorio (del usuario)

1. Rotar la contraseña de la base de datos y la clave secreta de Supabase (SEG-001, compartidas en el chat de desarrollo). Después, actualizar `DATABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en Vercel.
2. Revocar y volver a vincular el token de Vercel (SEG-002).
