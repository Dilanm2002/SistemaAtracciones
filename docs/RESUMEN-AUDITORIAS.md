# Resumen de auditorías — Descubre EC

Historial de las auditorías técnicas del sistema, desde la primera (V1) hasta la cuarta (V4): qué encontró cada una y cómo se resolvió.

**Códigos de área de los hallazgos:**

| Código | Área |
|---|---|
| **ACC** | Accesibilidad (WCAG 2.1/2.2 AA) |
| **SEG** | Seguridad y privacidad (OWASP Top 10) |
| **API** | API REST y contrato OpenAPI |
| **DAT** | Datos y persistencia |
| **CON** | Concurrencia e idempotencia |
| **WEB** | Frontend |
| **OPS** | Despliegue y operación |
| **CAL** | Calidad, arquitectura y DevOps |

**Prioridades:** P0 crítico (impide entregar) · P1 alta · P2 media · P3 baja.

## Línea de tiempo

| Auditoría | Fecha | Versión auditada | Hallazgos | Se resolvió en |
|---|---|---|---|---|
| **V1** | 29-sep-2026 | Primera versión (TypeORM) | **126** | Versiones 1.x (reescritura SQL-first) |
| **V2** | 30-sep-2026 | 1.x | 126 + **7 nuevos** | Versión **2.0.0** |
| **V3** | 01-oct-2026 | 2.2.1 | 136 + **3 nuevos** | Versiones **2.3.0** y **2.4.0** |
| **V4** | 05-oct-2026 | 2.4.3 | 136 + **10 nuevos** | Pendiente (ver sección 4) |

---

## 1. Auditoría V1 — la primera revisión completa

### 1.1 Qué encontró: 126 hallazgos

| Área | Veredicto | P0 | P1 | P2 | P3 | Total |
|---|---|:-:|:-:|:-:|:-:|:-:|
| Accesibilidad | Cumple parcialmente | 0 | 11 | 14 | 10 | 35 |
| Seguridad | **No cumple** | 6 | 9 | 8 | 2 | 25 |
| API y contrato | Cumple parcialmente | 0 | 1 | 9 | 4 | 14 |
| Datos | Cumple parcialmente | 1 | 0 | 7 | 2 | 10 |
| Concurrencia | **No cumple** | 0 | 3 | 1 | 0 | 4 |
| Frontend | Cumple en su mayor parte | 0 | 0 | 8 | 6 | 14 |
| Despliegue | Cumple parcialmente | 0 | 2 | 5 | 2 | 9 |
| Calidad y DevOps | **No cumple** | 0 | 4 | 6 | 5 | 15 |
| **Total** | | **7** | **30** | **58** | **31** | **126** |

### 1.2 Los 7 hallazgos críticos (P0), que impedían entregar

| ID | Problema |
|---|---|
| SEG-001 | La contraseña de la base de datos de producción estaba en claro en archivos `.env` del repositorio |
| SEG-002 | Un token de Vercel vigente estaba expuesto en `.env.local` |
| SEG-003 | `JWT_SECRET` tenía un valor por defecto en el código: sin la variable, cualquiera podía falsificar tokens de administrador |
| SEG-004 | Un usuario OPERADOR podía listar las reservas de **todos** los clientes, con sus datos personales |
| SEG-005 | No había límite de intentos en la API (fuerza bruta en el login) |
| SEG-006 | Sin cabeceras de seguridad: CSP, HSTS, `X-Frame-Options`… |
| DAT-001 | No existían migraciones: el esquema dependía de `synchronize` de TypeORM |

### 1.3 Otros hallazgos importantes

- **Accesibilidad (P1):**
  - Foco poco visible (ACC-001) y enlace «Ingresar» sin nombre en el celular (ACC-002).
  - Menús sin soporte de teclado (ACC-003, ACC-004) y menú del panel tabulable estando oculto (ACC-005).
  - Al navegar no se anunciaba la página (ACC-006).
  - Calendario, pestañas y estrellas sin la estructura que declaraban (ACC-007 a ACC-009).
  - Campos obligatorios sin marcar (ACC-010) y alertas no anunciadas (ACC-011).
- **API:** un id inválido devolvía 500 en vez de 400 (API-001), el contrato tenía una ruta duplicada (API-003), `details` ignoraba `languages` (API-005) y faltaban límites de longitud (API-009 a API-011).
- **Concurrencia:** se podía vender más cupos de los que había y repetir reservas.
- **Calidad:** sin pruebas ni CI suficientes.

### 1.4 Cómo se resolvió

| Tema | Solución |
|---|---|
| **Base de datos** | Reescritura **SQL-first**:<br>• `database/01_esquema.sql` es la única fuente del esquema (3FN).<br>• Migraciones versionadas con *checksum* y bloqueo (*advisory lock*).<br>• Todas las consultas, SQL parametrizado (sin inyección SQL).<br>• RLS activada en la base. |
| **Secretos (SEG-001/002/003)** | • Fuera del repositorio; solo viven en las variables de Vercel.<br>• Escaneo de secretos con gitleaks en el CI.<br>• `JWT_SECRET` obligatorio: la API no arranca sin él. |
| **Permisos (SEG-004)** | El operador solo ve las reservas de **su propia empresa**. Los permisos (scopes) se recalculan en cada petición. |
| **Ataques (SEG-005/006)** | • *Throttler*: 5 intentos de login por minuto y límites en registro, subidas y mensajes.<br>• Helmet con CSP, HSTS y demás cabeceras. |
| **Sesiones** | Cada token tiene su fila en la tabla `sesion` y se puede revocar al cerrar sesión. |
| **Concurrencia** | • Bloqueo pesimista `SELECT … FOR UPDATE` sobre la disponibilidad: no hay sobreventa.<br>• Cabecera `Idempotency-Key`: no hay reservas dobles. |
| **Accesibilidad** | Foco visible, menús y calendario operables con teclado, campos obligatorios marcados y alertas anunciadas a los lectores de pantalla. |
| **API** | Validación de todos los datos (DTO), errores 400 correctos, contrato corregido y límites de longitud. |
| **Calidad** | CI en GitHub Actions con lint, pruebas unitarias y pruebas E2E contra PostgreSQL real. |

**Resultado medido en la V2:** de los 126, **113 corregidos (89,7 %)**, 11 parciales, 1 vigente y 1 no verificable. **Los 7 P0 quedaron cerrados.**

---

## 2. Auditoría V2 — reauditoría tras la reescritura

### 2.1 Qué encontró

- Reevaluó los 126 de la V1 (113 corregidos y 13 abiertos) y encontró **7 nuevos**.
- Pendientes de la V1:
  - SEG-008: bucket de fotos público.
  - CAL-009 / SEG-014: credenciales de demo publicadas.
  - SEG-010 y SEG-013: idempotencia que guardaba datos personales.
  - SEG-019: documentación de la API.
  - OPS-005: logs.
  - ACC-001, ACC-026 y WEB-006: foco, contraste e imágenes.

| ID nuevo | Prioridad | Problema |
|---|:-:|---|
| V2-SEG-01 | P1 | Con una base vacía en producción, el seed creaba un administrador con contraseña conocida |
| V2-OPS-01 | P2 | Las migraciones se ejecutaban en cada build, incluso en los *previews* |
| V2-CAL-01 | P2 | El CI no tenía análisis de seguridad ni revisión de dependencias |
| V2-SEG-02 | P3 | Los errores usaban un dominio ajeno y reflejaban el `Idempotency-Key` |
| V2-CON-01 | P3 | La caché de sesión por instancia permitía hasta 15 s sin revocar |
| V2-DAT-01 | P3 | Las búsquedas `ILIKE` dependían del escape por defecto |
| API-015 | P3 | Nada garantizaba que el contrato y el código coincidieran |

### 2.2 Cómo se resolvió (versión 2.0.0)

| ID | Solución |
|---|---|
| V2-SEG-01 | **Seed *fail-closed***: en producción la API no arranca si `SEED_ON_START` no es `false`. |
| V2-OPS-01 | Las migraciones solo se aplican en el despliegue de **producción**, cada una en su propia transacción. |
| V2-CAL-01 | **CodeQL**, revisión de dependencias en los PR y `npm audit` (falla con `high`). Dependencias actualizadas (NestJS 11, Vite 8): 0 vulnerabilidades. |
| V2-SEG-02 | Errores en formato **RFC 7807** con el dominio propio y catálogo en `/api/v1/errores`. |
| V2-CON-01 | La caché bajó de 15 s a 3 s. En la V3 se eliminó del todo. |
| V2-DAT-01 | `ESCAPE` explícito en las 13 búsquedas `ILIKE`. |
| API-015 | Prueba **`contract-coverage.spec.ts`** (API-First): compara el contrato con las rutas reales y falla si se separan. |
| CAL-009 / SEG-014 | Contraseñas de admin y operador rotadas. Solo se publica la cuenta del cliente. |
| SEG-013 | La idempotencia guarda solo el id de la reserva, sin datos personales. |
| SEG-010 | `/health` comprueba el storage con la clave de servidor. |
| SEG-019 | Swagger y Redoc versionados en el proyecto, sin depender de una CDN. |
| OPS-005 | Logs en JSON por petición (sin datos personales) y métricas en `/health`. |
| ACC-001 / ACC-026 / WEB-006 | Foco ámbar de 8,6:1 sobre fondos oscuros, cabecera sólida e imágenes con `loading` explícito. |

Quedaron **aceptados con justificación**, para resolverse después:
- SEG-008: bucket público.
- WEB-008: token accesible desde JavaScript.
- WEB-003: sin SSR.
- SEG-016: sin verificación de correo.

---

## 3. Auditoría V3 — sobre la versión 2.2.1

### 3.1 Qué encontró

- Declaró 133 hallazgos; sus tablas tenían en realidad **136**: 125 corregidos, 6 parciales y 1 no verificable.
- **Sin ningún P0 ni P1 abierto.**

| ID nuevo | Prioridad | Problema |
|---|:-:|---|
| V3-ACC-01 | P2 | Los botones de cuentas demo no tenían borde perceptible |
| V3-ACC-02 | P3 | El resultado del formulario de empresa no se anunciaba |
| V3-SEG-01 | P3 | El error 503 de arranque usaba un tipo fuera del catálogo |

Parciales: SEG-008, SEG-010, V2-SEG-02, V2-CON-01, WEB-008 y WEB-003. No verificable: ACC-026.

### 3.2 Cómo se resolvió (versiones 2.3.0 y 2.4.0)

| ID | Solución |
|---|---|
| V3-ACC-01 | Borde con contraste de 3:1 o más en los botones demo. |
| V3-ACC-02 | Al enviar, el foco pasa al mensaje «Tu solicitud está en revisión». |
| V3-SEG-01 / V2-SEG-02 | Tipo `unavailable` agregado al catálogo de errores. |
| V2-CON-01 | Se **eliminó** la caché de sesión: la revocación es inmediata en todas las instancias. |
| SEG-010 | El keepalive revisa cada 5 minutos que la base **y** el storage estén `UP`. |
| **SEG-008** | **Bucket privado**:<br>• Las fotos se sirven a través de la API, solo si están en uso.<br>• Las recién subidas, con un enlace firmado HMAC de 2 h. |
| **WEB-008** | **DPoP (RFC 9449)**: el token queda ligado a una llave no exportable del navegador, así que un token robado no sirve en otro equipo. |
| **WEB-003** | **Pre-renderizado**: HTML propio para cada página y cada atracción, con sitemap y datos `schema.org`. |
| ACC-026 | Contraste del inicio medido sobre la foto real y corregido: título 3,8:1 y subtítulo 5,05:1. |
| **SEG-016** | Inicio de sesión con **Google** (versión 2.4.0): el correo queda verificado. |

---

## 4. Auditoría V4 — sobre la versión 2.4.3 (la última)

### 4.1 Resultado global

| Estado | Cantidad |
|---|:-:|
| Corregidos | **132** |
| Parciales | 4 |
| No verificables | 0 |
| Agravados | 0 |
| Nuevos | 10 |
| **Total de identificadores** | **146** |

- De los 136 hallazgos anteriores, se cerraron 7 más respecto a la V3.
- **No queda ningún P0 ni P1 abierto.**

### 4.2 Reclasificaciones

| ID | Antes | Ahora | Motivo |
|---|---|---|---|
| SEG-008 | Parcial | **Corregido** | El bucket privado con la API como intermediaria resolvió el problema |
| ACC-026 | No verificable | **Corregido** | Se publicó la tabla de contraste medida |
| SEG-016 | Corregido | **Parcial** | Google verifica el correo, pero quien se registra con correo y contraseña nunca queda verificado |
| CAL-008 | Corregido | **Parcial** (reabierto) | La documentación dice que la sesión de Google va ligada a DPoP y no es así |

Los otros 2 parciales:
- **SEG-010:** depende de la clave real configurada en el panel de Supabase.
- **WEB-008:** el token sigue siendo accesible desde JavaScript, aunque mitigado con DPoP.

### 4.3 Hallazgos nuevos (1 P2 y 9 P3)

| ID | Prioridad | Problema |
|---|:-:|---|
| V4-SEG-01 | P2 | La sesión iniciada con Google no queda ligada a DPoP |
| V4-SEG-02 | P3 | El registro anti-repetición de DPoP es por instancia y se purga en bloque |
| V4-OPS-01 | P3 | Las fotos se sirven desde la API y consumen el límite global de peticiones |
| V4-OPS-02 | P3 | Las búsquedas en el mapa (Nominatim) no tienen control de frecuencia |
| V4-OPS-03 | P3 | Fluid Compute sin techo de concurrencia frente a un pool de una sola conexión |
| V4-ACC-01 | P3 | El nombre accesible del mapa está en un elemento sin rol |
| V4-ACC-02 | P3 | El error de validación de cada elemento de las listas no se anuncia |
| V4-CAL-01 | P3 | El código nuevo y crítico del frontend no tiene pruebas |
| V4-CAL-02 | P3 | El pre-renderizado solo cubre las primeras 100 atracciones |
| V4-CAL-03 | P3 | `frontend/image.png` es un archivo corrupto sin rastrear |

### 4.4 Estado actual (versión 2.5.5)

La V4 no se trabajó de forma específica. Revisado en el código actual:

| ID | Estado |
|---|---|
| V4-CAL-01 | **Avanzó**: se agregaron pruebas de frontend: unitarias de validación y fotos, y 57 pruebas Playwright en 4 dispositivos móviles con axe |
| V4-SEG-01, V4-SEG-02, V4-OPS-01, V4-OPS-02, V4-OPS-03, V4-ACC-01, V4-ACC-02, V4-CAL-02 | Pendientes |
| V4-CAL-03 | Pendiente. El archivo no está en el repositorio: solo existe en la copia local |
| SEG-016, CAL-008, SEG-010, WEB-008 | Siguen parciales |

Son hallazgos de prioridad media y baja: ninguno afecta al funcionamiento ni a la seguridad crítica del sistema.

---

## 5. Anexo — auditoría móvil (sobre la versión 2.4.3)

Revisión específica de la experiencia en el celular: **20 hallazgos** (3 P1, 8 P2, 6 P3 y 3 P4). Se resolvieron **todos** en las versiones 2.5.0 a 2.5.5.

| ID | Problema | Solución |
|---|---|---|
| MOV-001 | La imagen principal pesaba 429 KB | AVIF/WebP en 4 tamaños: **54 KB** en el celular |
| MOV-002 | Fotos de 1600 px en tarjetas de 335 px | Variantes de 480 y 960 px con `srcset` |
| MOV-003 | Gráfico de rankings ilegible | Nombre encima de cada barra |
| MOV-004 | Menú del panel sin manejo de foco | Trampa de foco, Escape y botón de cierre |
| MOV-005 | Scroll anidado en reportes | Eliminado en el celular |
| MOV-006 | Checkout largo en el celular | Resumen plegable y barra fija con «Pagar» |
| MOV-007 | La app no se podía instalar | Íconos de 192 y 512 px, *maskable* y Apple |
| MOV-008 | Sin áreas seguras del iPhone | `env(safe-area-inset-*)` y `dvh` |
| MOV-009 | Desenfoque sin prefijo para Safari | `-webkit-backdrop-filter` |
| MOV-010 | Sin pruebas móviles en el CI | Playwright, axe y límite de peso |
| MOV-011 | 7 pesos de fuente de Google | 3 fuentes propias (63 KB) |
| MOV-012 | Botones táctiles pequeños | Mínimo de 44 px |
| MOV-013 | Subir fotos desde el celular era incómodo | Botón «Tomar foto» |
| MOV-014 | «Añadir al calendario» no funcionaba en iPhone | Archivo `.ics` real con enlace firmado |
| MOV-015 | El mapa atrapaba el desplazamiento | Arrastre desactivado en pantallas táctiles |
| MOV-016 | Navegadores no declarados | Navegadores mínimos en la configuración de Vite |
| MOV-017 | El teclado tapaba los campos | `visualViewport` y `interactive-widget` |
| MOV-018 | Una sola columna en el catálogo | 2 columnas en celulares grandes |
| MOV-019 | Visor de fotos sin gestos | Deslizar para pasar y para cerrar |
| MOV-020 | Pestañas cortadas a 320 px | Pestañas adaptables |

Primera visita en el celular: de **521 KB** a **205 KB**.

---

## 6. Conclusión

| Auditoría | Hallazgos | Estado |
|---|:-:|---|
| V1 | 126 | Todos corregidos (los 7 P0 cerrados en la V2) |
| V2 | 7 nuevos | Todos corregidos (versión 2.0.0) |
| V3 | 3 nuevos y 6 parciales | Corregidos (versiones 2.3.0 y 2.4.0) |
| V4 | 10 nuevos y 4 parciales | Pendientes, de prioridad media y baja (V4-CAL-01 avanzó) |
| Móvil | 20 | Todos corregidos (versiones 2.5.0 a 2.5.5) |

**Acción fuera del código:** rotar la contraseña de la base de datos y la clave secreta de Supabase (SEG-001 y SEG-002), porque se compartieron durante el desarrollo.

Detalle de cada corrección: `docs/CORRECCIONES-V2.md`, `docs/CORRECCIONES-V3.md`, `docs/CORRECCIONES-MOVIL.md` y `CHANGELOG.md`.
