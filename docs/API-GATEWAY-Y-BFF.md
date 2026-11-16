# API Gateway y BFF de Descubre EC

**Estado:** propuesta de diseño, sin implementar · **Fecha:** 2026-11-04 · **Relacionado:** [`microservicios/README.md`](../microservicios/README.md), [`ARQUITECTURA-MICROSERVICIOS.md`](ARQUITECTURA-MICROSERVICIOS.md)

## 1. Resumen

**Descubre EC no tiene hoy ningún BFF.** Tiene un API Gateway que solo atiende a Booking y un sistema anterior (monolito en Vercel) que atiende a la web y al panel.

**Se propone:** un solo **API Gateway** como entrada pública y un **BFF por cada uno de los 4 clientes**: web, móvil, administración e integraciones. Los BFF combinan datos de los 11 microservicios, no guardan datos y no contienen reglas de negocio.

**Condiciones importantes:**

1. **Booking no cambia nada.** Su URL `/api/v3` y su contrato se mantienen.
2. **La web y el panel no pueden pasar todavía a los microservicios.** Faltan login, usuarios, reservas de clientes y otras funciones ([sección 8](#8-lo-que-falta-en-los-microservicios)). Es el mayor trabajo del plan, más que los propios BFF.
3. **El repositorio no contiene una app móvil nativa.** `bff-mobile` se diseña aquí, pero su construcción depende de la [decisión D1](#11-decisiones-pendientes).

## 2. Situación actual

```
 Web y panel (React en Vercel)        Booking (Paúl)
          │                                 │ X-API-Key
          ▼                                 ▼
   Monolito NestJS                    API Gateway (Azure)
   /api/v1 y /api/v2                  /api/v2, /api/v3, /ms/*
          │                                 │
          ▼                                 ▼
   Base de la tienda                  11 microservicios
   (Supabase)                         (un schema por servicio en Supabase)

          Sin sincronización entre ambos lados:
          los microservicios recibieron una copia inicial.
```

### Qué cumple hoy cada función

| Pieza | Función que cumple | ¿Es un BFF? |
|---|---|---|
| [`gateway/src/rutas.ts`](../microservicios/gateway/src/rutas.ts) | Reparte rutas a cada microservicio | No: enruta, pero no combina ni adapta datos |
| Monolito `/api/v1` | Sirve las pantallas de la web y el panel (`/reportes/dashboard`, por ejemplo) | Lo hace de hecho, pero también contiene la lógica de negocio |
| [`frontend/src/api/client.js`](../frontend/src/api/client.js) | Funciones de llamada y reintentos dentro del navegador | No: se ejecuta en el cliente |
| [`mapper-booking.ts`](../microservicios/ms-catalog/src/mapper-booking.ts) y [`alias.middleware.ts`](../microservicios/ms-booking/src/alias.middleware.ts) | Adaptan datos y campos al contrato de Booking | Es lógica propia de un BFF de integraciones, ubicada dentro de los servicios |

### Hallazgos que afectan al diseño

Comprobados en el código y, cuando se indica, contra la nube el 2026-11-04.

| # | Hallazgo | Consecuencia |
|---|---|---|
| H1 | Los cambios del panel van al monolito y no llegan a los microservicios | Booking puede ver atracciones o precios desactualizados, y los cupos se descuentan por separado |
| H2 | El gateway no limita peticiones por cliente (el monolito sí: 120 por minuto) | Un cliente puede saturar los servicios |
| H3 | `POST /ms/review/v1/resenas` es accesible sin credenciales (la nube responde 400 por validación, no 401), porque el servicio admite reseñas anónimas | Sin límite de peticiones, se puede llenar de reseñas falsas |
| H4 | CORS responde `Access-Control-Allow-Origin: *` (comprobado en la nube) | Cualquier sitio puede llamar a la API desde un navegador |
| H5 | En Azure, `GATEWAY_TIMEOUT_MS=8000`, aunque Booking corta a los 4 s | El gateway puede seguir esperando cuando Booking ya abandonó la petición |
| H6 | Hay una sola `BOOKING_API_KEY` y `SocioGuard` identifica siempre a `booking-prototipo` | No se puede agregar otro socio ni revocarlo por separado |
| H7 | Los microservicios aceptan el esquema `DPoP`, pero solo verifican la firma del JWT, no la prueba DPoP | Se pierde la protección que la web tiene hoy si se reutiliza sin más |
| H8 | No hay servicio que emita tokens: los microservicios verifican JWT HS256 con un secreto compartido | Sin el monolito, nadie puede iniciar sesión |

## 3. Gateway y BFF: en qué se diferencian

| | API Gateway | BFF |
|---|---|---|
| **Pregunta que responde** | ¿Puede entrar esta petición y a dónde va? | ¿Qué necesita esta pantalla? |
| **Cantidad** | Uno | Uno por tipo de cliente |
| **Hace** | TLS, enrutamiento, límites, CORS, ID de correlación, tiempos máximos | Combina servicios, recorta campos, adapta formatos, tolera fallos parciales |
| **Conoce** | Prefijos de ruta y políticas | Pantallas y flujos de su cliente |
| **No hace** | Combinar datos ni reglas de negocio | Reglas de negocio ni acceso a base de datos |

**Regla práctica:** si un cambio de pantalla obliga a tocarlo, pertenece al BFF. Si un cambio de precio, cupo o cancelación obliga a tocarlo, pertenece a un microservicio.

## 4. Los 4 clientes

| | Web | Móvil | Administración | Integraciones |
|---|---|---|---|---|
| **Quién lo usa** | Visitantes y clientes | Clientes en el teléfono | Administradores y operadores | Booking y futuros socios |
| **Estado actual** | Existe, usa el monolito | Solo la web adaptable; no hay app nativa | Existe en `/admin` de la misma app React; usa el monolito | Existe, usa el gateway |
| **Credencial** | Anónimo o JWT + DPoP | JWT con sesión larga | JWT + DPoP con rol `ADMIN` u `OPERADOR` | `X-API-Key` por socio |
| **Prioridad** | Páginas completas y rápidas, SEO | Pocos datos, red inestable, voucher sin conexión | Tablas, filtros, reportes, auditoría | Contrato estable y corte a los 4 s |
| **Forma de cambiar** | Frecuente, se despliega al instante | Convive con versiones antiguas instaladas | Frecuente | Muy poco; versionado por contrato |

**Por qué un solo BFF no basta:** estas necesidades se contradicen. Un endpoint general acabaría enviando campos de administración al teléfono, o rompiendo a Booking por un cambio en una pantalla.

## 5. Arquitectura propuesta

```
  Web          App móvil        Panel admin      Booking y socios
   │               │                │                   │
   └───────────────┴───────┬────────┴───────────────────┘
                           ▼
        ┌───────────────── API GATEWAY ─────────────────┐  único público
        │ TLS · rutas · límites · CORS · tiempos · IDs  │
        └───┬───────────┬────────────┬──────────────┬───┘
    /web/v1 │ /mobile/v1│  /admin/v1 │ /api/v2, /api/v3
            ▼           ▼            ▼              ▼
        bff-web    bff-mobile    bff-admin   bff-integraciones
            │           │            │              │
            └───────────┴─────┬──────┴──────────────┘
                              ▼   red interna
   usuarios* · catalog · location · review · pricing · inventory
   coupon · order · booking · payment · refund · invoicing

   * Servicio nuevo: no existe todavía (sección 8)
```

### Reglas

1. Un BFF atiende a **un solo** cliente, y un BFF **no llama a otro BFF**.
2. Los BFF **no tienen base de datos** ni reglas de negocio. Tampoco consumen conexiones del pooler de Supabase.
3. Las **compras** se delegan a `ms-booking`. El BFF nunca coordina la saga.
4. Los microservicios **siguen validando** el token y el rol: el BFF no reemplaza esa revisión.
5. Las rutas `/internal/` **nunca** se publican.
6. Si falla un dato **secundario**, el BFF responde con lo demás e indica qué faltó. Si falla el **principal**, responde el error.
7. Los errores siguen RFC 7807 y conservan el `code` del servicio. Se propaga `X-Correlation-Id`.
8. `Idempotency-Key` se reenvía sin cambios. El BFF **no reintenta** escrituras por su cuenta.

## 6. Diseño del API Gateway

Se propone **ampliar el gateway NestJS actual** en lugar de instalar Kong: ya está desplegado, tiene pruebas y las funciones que faltan son pocas.

### Rutas

| Ruta pública | Destino | Nota |
|---|---|---|
| `/web/v1/*` | `bff-web` | Nueva |
| `/mobile/v1/*` | `bff-mobile` | Nueva |
| `/admin/v1/*` | `bff-admin` | Nueva |
| `/api/v2/*`, `/api/v3/*`, `/api/v1/calendario/*.ics` | `bff-integraciones` | **Misma URL que hoy.** Hasta que exista ese BFF, sigue yendo directo a los servicios |
| `/api/v{2,3}/health`, `/api/v{2,3}/atracciones/health` | El propio gateway | Sin cambios |
| `/ms/*` | **Se elimina** | Resuelve la exposición de H3; el panel usará `bff-admin` |

### Políticas por cliente

Los valores son un **punto de partida**; hay que ajustarlos con mediciones.

| Política | Web | Móvil | Admin | Integraciones |
|---|---|---|---|---|
| **Límite** | 120/min por IP | 120/min por usuario o IP | 300/min por usuario | 600/min por socio |
| **Límite en login y escrituras anónimas** | 10/min por IP | 10/min por IP | 10/min por IP | No aplica |
| **Tiempo máximo** | 8 s | 8 s | 15 s (reportes) | **3,8 s** |
| **CORS** | Solo el dominio de la web | No aplica (app nativa) | Solo el dominio del panel | Sin CORS |
| **Revisión previa** | Ninguna en rutas públicas | Versión mínima de la app | Exige `Authorization` | Exige `X-API-Key` |

El límite puede vivir en memoria mientras el gateway tenga una sola réplica, como hoy (`max-replicas 1`). Con más réplicas necesitará un almacén compartido, como Redis.

## 7. Diseño de cada BFF

Las rutas son una propuesta; `usuarios` y las rutas para clientes en `booking` todavía no existen.

### 7.1 `bff-web`

| Ruta | Combina | Si falla algo |
|---|---|---|
| `GET /inicio` | catalog (destacadas, categorías) + location | Sin ciudades: se muestra lo demás |
| `POST /explorar` | catalog (búsqueda) | Error |
| `GET /atracciones/:slug` | catalog + review (resumen y últimas) + inventory (próximas fechas) + pricing | Sin reseñas o fechas: la ficha se muestra igual |
| `GET /atracciones/:id/turnos?fecha=` | inventory | Error |
| `POST /reservas` | booking + `Idempotency-Key` | Error de la saga, sin cambios |
| `GET /mis-reservas` | booking + catalog (foto y nombre) | Sin foto: se muestra la reserva |
| `POST /reservas/:id/cancelar` | booking | Error |
| `/sesion/*`, `/perfil`, `/favoritos` | usuarios | Error |

**Respuesta parcial de ejemplo:**

```json
{
  "atraccion": { "id": "4fcd5948-…", "nombre": "Snorkel en el León Dormido", "fotos": ["…"] },
  "precio": { "adulto": "85.00", "moneda": "USD" },
  "resenas": null,
  "avisos": [{ "seccion": "resenas", "code": "DEPENDENCY_UNAVAILABLE" }]
}
```

### 7.2 `bff-mobile`

Comparte los flujos de la web, pero responde con menos datos y tolera versiones antiguas de la app.

| Ruta | Combina | Diferencia con la web |
|---|---|---|
| `GET /inicio` | catalog | 10 tarjetas: id, nombre, precio, calificación, foto pequeña |
| `GET /explorar?cursor=` | catalog | Paginación por cursor y campos mínimos |
| `GET /atracciones/:id` | catalog + pricing + review | Sin itinerario completo ni lista de reseñas; se piden aparte |
| `POST /reservas` | booking | Reintentos seguros con la misma `Idempotency-Key` |
| `GET /reservas/:id/voucher` | booking | Todo lo necesario **sin conexión**: QR, punto de encuentro, coordenadas, hora |

**Reglas propias:**
- La app envía `X-App-Version`. Si es inferior a la mínima, responde `426` con la instrucción de actualizar.
- Las lecturas usan `ETag` para evitar descargas repetidas.
- Los cambios incompatibles se publican como `/mobile/v2`, porque las versiones antiguas seguirán instaladas.

**Referencia medida:** por `/api/v3`, el listado de 24 atracciones pesa **40,6 KB** (~1,7 KB por tarjeta) y una ficha, **8,9 KB**. La meta inicial sería reducir esas tarjetas a menos de 0,5 KB.

### 7.3 `bff-admin`

| Ruta | Combina | Quién |
|---|---|---|
| `GET /dashboard` | booking + order + inventory + review + salud | Admin; operador solo lo suyo |
| `/atracciones/*` | catalog + pricing + inventory | Admin y operador |
| `GET /reservas` | booking + order + payment + invoicing | Admin; operador solo su empresa |
| `POST /reservas/:id/checkin` | booking | Admin y operador |
| `/disponibilidad/*`, `/fechas-bloqueadas/*` | inventory | Admin y operador |
| `/resenas/*` | review | Admin |
| `/cupones/*`, `/promociones` | coupon | Admin |
| `/usuarios/*`, `/operadores/*`, `/solicitudes/*` | usuarios + catalog | Admin |
| `GET /reportes/*` | Requiere definir su fuente (sección 8) | Admin |
| `GET /sistema` | Salud de servicios + stock pendiente hacia Booking | Admin |

**Reglas propias:**
- El BFF reduce lo que muestra según el rol, y **el servicio vuelve a verificarlo**.
- El panel nunca recibe números completos de tarjeta ni secretos.
- Cada escritura registra quién la hizo con su `X-Correlation-Id`.

### 7.4 `bff-integraciones`

Es el BFF más delgado: **su función es proteger el contrato**.

| Hace | No hace |
|---|---|
| Autentica por socio con su propia clave (resuelve H6) | Cambiar nombres o formatos del contrato sin nueva versión |
| Aplica cuota por socio y registra su uso | Agregar lógica de pantallas |
| Publica `/api/v2` y `/api/v3` tal como están | Superar los 3,8 s de respuesta |
| Da un lugar a los mapeos de contrato para nuevos socios | Exponer rutas `/ms/` o `/internal/` |

**Mapeos existentes:** `mapper-booking.ts` y `alias.middleware.ts` **se quedan donde están** al principio. Moverlos cambiaría código que Paúl ya está consumiendo. Solo conviene hacerlo al llegar un segundo socio o una nueva versión.

**Tiempo disponible:** la reserva tarda ~2,4 s en caliente y 3,4 s en la primera compra tras desplegar (medido el 2026-10-29). Un salto más consume ese margen, así que este BFF debe medirse antes de activarlo.

## 8. Lo que falta en los microservicios

Los BFF solo combinan lo que existe. Esto compara lo que usa [`client.js`](../frontend/src/api/client.js) con las rutas de los 11 servicios:

| Función | Web | Admin | Hoy en microservicios | Qué hace falta |
|---|---|---|---|---|
| Login, registro, Google, perfil | ✔ | ✔ | ❌ | **Servicio de usuarios** que emita tokens |
| Gestión de usuarios y roles | | ✔ | ❌ | Servicio de usuarios |
| Reservar con cuenta de cliente | ✔ | | ❌ Solo `X-API-Key` o JWT `ADMIN` | Rutas para clientes en `ms-booking` |
| Mis reservas y cancelar la propia | ✔ | | ❌ Listado solo `ADMIN` | Rutas para clientes en `ms-booking` |
| Check-in por operador | | ✔ | ⚠️ Solo `X-API-Key` o `ADMIN` | Permitir `OPERADOR` de su empresa |
| Favoritos | ✔ | | ❌ | Servicio de clientes o `ms-catalog` |
| Mensajes de contacto | ✔ | ✔ | ❌ | Servicio nuevo o módulo |
| Solicitudes de proveedores | ✔ | ✔ | ❌ | Servicio nuevo o módulo |
| Subir imágenes | | ✔ | ❌ | Servicio de medios |
| Reportes de ventas y clientes | | ✔ | ❌ | Proyección alimentada por eventos |
| Crear/editar categorías, destinos, operadores | | ✔ | ⚠️ Solo lectura | Escritura en `ms-catalog` y `ms-location` |
| Aprobar atracciones de empresas | | ✔ | ⚠️ Sin ruta `review` | Agregar a `ms-catalog` |
| Calendario mensual de cupos | ✔ | ✔ | ⚠️ Solo por día | Ruta nueva o composición |
| Puede reseñar / borrar reseña | ✔ | ✔ | ⚠️ Solo crear y ocultar | Agregar a `ms-review` |
| Observabilidad y telemetría | | ✔ | ⚠️ Solo salud y stock | Definir fuente |
| Catálogo, ficha, turnos, tarifas, cupones, moderación | ✔ | ✔ | ✔ | Nada |

> **Riesgo principal:** si `/reservas` de la web sigue en el monolito mientras Booking compra por `ms-inventory`, **hay dos inventarios y puede venderse el mismo cupo dos veces**. La compra de la web debe pasar a `ms-booking`, y los datos deben haberse copiado una última vez justo antes.

Antes de crear servicios, conviene revisar si el script del equipo (`02_microservicios_v2_bases_de_datos.sql`, con 16 servicios) ya define alguno de estos dueños.

## 9. Seguridad

| Tema | Propuesta |
|---|---|
| **Emisión de tokens** | El servicio de usuarios emite los JWT. Conviene firmar con llave asimétrica (RS256/ES256) para que nadie más necesite el secreto |
| **DPoP** | La prueba la verifica `bff-web` y `bff-admin` antes de reenviar (resuelve H7) |
| **Claves de socios** | Una por socio, guardadas como huella y revocables por separado |
| **BFF → servicio** | Se reenvía el JWT del usuario, y `X-Servicio-Token` en rutas internas |
| **Red** | Solo el gateway es público. Los BFF y los servicios se mantienen con ingreso interno en Container Apps |
| **Datos en respuestas** | Cada BFF devuelve solo los campos que su cliente usa. Los datos personales no van a los logs |

## 10. Plan de implementación

Cada fase se puede desplegar y probar por separado.

| Fase | Entrega | Criterio para terminar |
|---|---|---|
| **0. Reforzar el gateway** | Límites, CORS y tiempo por ruta (3,8 s para integraciones). Mantener `/ms/*` hasta que el panel deje de necesitarlo, o quitarlo si nadie lo usa | La prueba de humo sigue verde; las pruebas de gateway cubren las políticas |
| **1. Lecturas de `bff-web`** | Inicio, explorar y ficha. La web las usa detrás de un interruptor | Misma información que hoy; respuesta parcial probada apagando `ms-review` |
| **2. Identidad** | Servicio de usuarios, con usuarios copiados y mismos IDs | Se inicia sesión sin el monolito; los tokens funcionan en todos los servicios |
| **3. Compra de la web** | Rutas para clientes en `ms-booking` y `bff-web` completo; copia final de datos | Web y Booking descuentan del mismo inventario; prueba de sobreventa concurrente |
| **4. `bff-admin`** | Funciones restantes de la sección 8 | Todas las pantallas de `/admin` funcionan; pruebas por rol |
| **5. `bff-mobile`** | Según D1 | Voucher disponible sin conexión; versión mínima probada |
| **6. `bff-integraciones`** | Claves por socio y cuotas | Contrato v3 sin cambios; reserva bajo 3,8 s; **Paúl avisado antes de activar** |
| **7. Retiro del monolito** | Apagar `/api/v1` en Vercel | Una semana sin tráfico al monolito |

**Estructura propuesta:**

```
microservicios/
├── gateway/              # se amplía
├── bff-web/
├── bff-mobile/
├── bff-admin/
├── bff-integraciones/
└── ms-*/                 # servicios actuales
```

Siguen el patrón actual: NestJS, `src/comun`, una sola imagen elegida con `SERVICIO` y `contract/openapi.yaml` por BFF.

**Pruebas por BFF:**
- Respuestas validadas contra su contrato.
- Fallo de cada dependencia secundaria: la respuesta sigue siendo útil.
- Propagación de `X-Correlation-Id`, `Idempotency-Key` y errores.
- Permisos por rol, en `bff-admin`.
- Contrato oficial v3 y `prueba-humo.js`, en `bff-integraciones`.

**Costo en Azure:** cada BFF suma una app. Con `min-replicas 1` pasarían de 12 a 16 apps encendidas, con cargo al crédito de Azure for Students. Se puede usar `min-replicas 0` en `bff-admin` y `bff-mobile`, aceptando un arranque lento en la primera petición. `bff-integraciones` y `bff-web` deben quedar siempre encendidos.

## 11. Decisiones pendientes

| # | Decisión | Recomendación | Por qué importa |
|---|---|---|---|
| **D1** | ¿Existe o se construirá una app móvil nativa? | Si no hay app, dejar `bff-mobile` diseñado y atender teléfonos con `bff-web` | Un BFF sin cliente real agrega costo y no se puede validar |
| **D2** | ¿REST o GraphQL hacia la web? [`ARQUITECTURA-MICROSERVICIOS.md`](ARQUITECTURA-MICROSERVICIOS.md) dice que la UI lee por GraphQL (según la pizarra) | REST al inicio, por menos piezas nuevas. Si el curso exige GraphQL, puede vivir **dentro** de `bff-web` sin cambiar lo demás | Puede ser un requisito de evaluación |
| **D3** | ¿Sincronizar monolito y microservicios mientras dure la transición (H1)? | Congelar el panel para cambios de catálogo o repetir la copia tras cada cambio; una sincronización real sería trabajo que luego se descarta | Booking puede ver datos desactualizados |
| **D4** | ¿Cuándo activar `bff-integraciones`? | Después de terminar la integración con Paúl | Evita cambios durante sus pruebas |

## 12. Alternativas consideradas

| Alternativa | Decisión | Motivo |
|---|---|---|
| Un solo BFF para todos | Descartada | Vuelve a ser una API general; un cambio afecta a todos los clientes |
| Web y panel en un BFF, por ser la misma app React | Descartada | Tienen permisos, datos y riesgos distintos; un fallo de autorización expondría funciones de administración |
| Clientes llamando directo a cada servicio | Descartada | Expone los servicios y traslada la composición a cada cliente |
| Kong como gateway (propuesto en `ARQUITECTURA-MICROSERVICIOS.md`) | Pospuesta | Es otra pieza que operar; hoy bastan unas pocas funciones sobre el gateway actual |
| Lógica de composición en el gateway | Descartada | Convertiría al gateway en un punto único con conocimiento de cada pantalla |
