# Observabilidad — Descubre EC

Cómo saber, en cualquier momento, si el sistema funciona bien. Y cuando algo falla: qué falló, a quién afectó y dónde está el error.

**Contenido:**
1. Qué se mide.
2. Cómo se sigue una petición de punta a punta.
3. Objetivos de servicio (SLO).
4. Panel de Observabilidad.
5. Monitor sintético y alertas.
6. Runbook de incidentes.
7. Plantilla de postmortem.
8. Privacidad.
9. Límites conocidos.

---

## 1. Qué se mide

| Señal | Dónde se genera | Dónde se guarda | Para qué sirve |
|---|---|---|---|
| **Logs estructurados** | API: una línea JSON por evento y por petición | Logs de Vercel (Runtime Logs) | Ver el detalle de una petición concreta |
| **Métricas HTTP** | API: cada petición al terminar | `ops.metrica_http`: agregadas por minuto, método, ruta y código | Tráfico, latencia p50/p95/p99, tasa de errores, tiempo en la base |
| **Incidentes de la API** | Errores 500 no controlados (`ProblemDetailsFilter`) | `ops.incidente` (origen `api`) | Errores del servidor agrupados por huella, con su pila |
| **Incidentes de la web** | El navegador del usuario: excepciones, promesas rechazadas, fallos al dibujar la página (`ErrorBoundary`) y llamadas a la API sin respuesta o con 5xx | `ops.incidente` (origen `web`) | Errores que antes solo veía el usuario (por ejemplo, una pantalla en blanco) |
| **Core Web Vitals** | Navegador de los usuarios reales (librería `web-vitals`): LCP, INP, CLS, FCP y TTFB | `ops.web_vital` | La experiencia real: qué tan rápida y estable se siente la web en el teléfono y en la computadora |
| **Consultas lentas** | `DbService`: toda consulta de más de 500 ms | Logs (`msg: "consulta lenta"`) | Encontrar el SQL que hay que optimizar |
| **Salud** | `/ops/health/live`, `/ops/health/ready`, `/atracciones/health` | Respuesta en vivo | Saber si el servicio está vivo y listo para recibir tráfico |
| **Negocio** | Eventos de dominio (tabla `evento`) | Panel | Reservas, pagos, cancelaciones y reembolsos del periodo |

**¿Por qué las métricas se guardan en la base y no en memoria?** En Vercel cada instancia de la función vive poco y tiene su propia memoria. Un contador en memoria se pierde y no se puede sumar entre instancias.
- Cada instancia acumula sus peticiones en un búfer y lo vuelca cada 15 s con un `UPSERT`.
- Las instancias que atienden al mismo tiempo suman sobre la misma fila.
- El volcado ocurre después de responder (`waitUntil` de Vercel), así que no retrasa al usuario.
- Al apagarse, cada instancia guarda lo que tenía pendiente.

**Retención:** las métricas y los Web Vitals se guardan 30 días; los incidentes, 90. La propia API borra lo antiguo.

## 2. Seguir una petición de punta a punta

Cada petición lleva dos identificadores:

| Identificador | Origen | Dónde aparece |
|---|---|---|
| `request_id` | Lo genera la web en cada llamada (cabecera `X-Request-Id`); si no viene, lo genera la API | Cabecera `X-Request-Id`, cuerpo de cada error RFC 7807 (`request_id`), cada línea de log, cada incidente y el «Código de soporte» que ve el usuario |
| `trace_id` | [W3C Trace Context](https://www.w3.org/TR/trace-context/): se continúa el `traceparent` que llega (API Gateway o Booking), o se crea uno nuevo | Cabecera `traceparent` de la respuesta, cada línea de log y cada incidente |

Además, cada respuesta trae **`Server-Timing`** con el tiempo total y el tiempo en la base: `db;dur=12.4;desc="3 consultas", total;dur=48.1`. Se ve en **DevTools → Network → Timing**, sin tener acceso a los logs.

**Ejemplo:** un usuario reporta «me salió un error, código de soporte `684f5609`».
1. **Panel → Observabilidad → Incidentes:** buscar el código en la columna «Código de soporte». Ahí está el error, la ruta, la versión y el navegador.
2. **Vercel → proyecto `sistemaatracciones-backend` → Logs:** filtrar por `684f5609`. Salen todas las líneas de esa petición: la petición, las consultas lentas y la pila del error.
3. Si la petición vino de Booking, con el `trace_id` se une con sus propios logs.

## 3. Objetivos de servicio (SLO)

| SLO | Objetivo | Cómo se mide |
|---|---|---|
| **Disponibilidad** | ≥ 99,5 % de peticiones sin error 5xx | `ops.metrica_http`, en el periodo del panel |
| **Latencia** | p95 ≤ 1 s | Histograma de `ops.metrica_http` (cubetas ≤100/250/500/1000/2500 ms) |
| **Experiencia web** | LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1, en el p75 | `ops.web_vital`, con los umbrales de Google |

**Presupuesto de errores:** con 99,5 % de disponibilidad, se permite que fallen 5 de cada 1000 peticiones. El panel muestra cuánto de ese margen queda en el periodo:
- **100 %:** no hubo errores.
- **0 %:** el margen se agotó.

Mientras quede presupuesto, se puede publicar con normalidad. Si se agota, primero se estabiliza y después se agregan funciones.

Los objetivos están en el código, en `SLO` y `UMBRALES_VITALES` de [observabilidad.service.ts](../backend/src/modules/observabilidad/observabilidad.service.ts).

## 4. Panel de Observabilidad

**Panel de administración → Integración → Observabilidad** (`/admin/observabilidad`, solo para el administrador). Permite elegir el periodo (1 h, 24 h o 7 días) y se actualiza solo cada minuto. Muestra:
- **Estado:** si la API está lista (base de datos y migraciones al día).
- **Objetivos de servicio:**
  - peticiones;
  - disponibilidad frente al 99,5 %;
  - p95 frente a 1 s (con p50 y p99);
  - presupuesto de errores restante;
  - incidentes distintos.
- **Gráficas:**
  - tráfico;
  - tiempo de respuesta p95, con la línea del objetivo;
  - errores 5xx;
  - códigos de respuesta;
  - rutas más lentas.

  Cada gráfica tiene «Ver tabla», como alternativa accesible.
- **Core Web Vitals:** el p75 de cada métrica, con su calificación (bueno, mejorable o malo, con ícono y texto), el reparto de las mediciones y la comparación entre móvil y escritorio.
- **Incidentes:** agrupados por huella, con cantidad de veces, origen, mensaje, pila desplegable, ruta, versión, navegador y código de soporte.
- **Actividad del negocio** en el periodo.

Los datos salen de `GET /api/v1/ops/resumen?rango=1h|24h|7d`.

## 5. Monitor sintético y alertas

[`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml) se ejecuta **cada 5 minutos** desde GitHub Actions contra producción. Comprueba:
1. `/atracciones/health`: API, base de datos y Storage arriba.
2. `/ops/health/ready`: la base responde y no hay migraciones pendientes.
3. **Latencia real:** 3 mediciones del catálogo y del detalle. Una lenta solo genera un aviso (puede ser un arranque en frío); dos o más por encima de 1 s hacen fallar el monitor.
4. El sitio web responde.

**Alerta:** cuando el monitor falla, GitHub envía un correo a quien tenga activadas las notificaciones de Actions del repositorio (*Settings → Notifications → Actions → «Only notify for failed workflows»*). La tabla de latencias de cada ejecución queda en el resumen del workflow.

| Sonda | Responde | Para |
|---|---|---|
| `GET /ops/health/live` | 200 si el proceso responde (no consulta la base) | *Liveness* de un orquestador (Kubernetes) |
| `GET /ops/health/ready` | 200, o **503** si la base no responde o hay migraciones pendientes | *Readiness*: no enviar tráfico a una instancia que no está lista |
| `GET /atracciones/health` | Estado completo: base, Storage, conteos e instancia | API Gateway y contrato con Booking |

## 6. Runbook de incidentes

### Severidad

| Nivel | Criterio | Ejemplo en Descubre EC | Respuesta |
|---|---|---|---|
| **SEV1** | Servicio caído para todos | La API responde 503; la base no responde; nadie puede iniciar sesión | Inmediata |
| **SEV2** | Función principal degradada para muchos | No se puede reservar ni pagar; p95 > 5 s; presupuesto de errores agotado en 1 h | En 15 min |
| **SEV3** | Función secundaria con fallas para algunos | Fotos que no cargan, reseñas o calendario con error, LCP «malo» en móvil | En 1 h |
| **SEV4** | Bajo impacto o cosmético | Un incidente web aislado en un navegador antiguo | Siguiente día hábil |

### Triage paso a paso

1. **¿Está caído o lento?** Revisar el último run del monitor en GitHub Actions y abrir `/ops/health/ready`.
   - **503 con `database: DOWN`:** revisar el panel de Supabase. ¿El proyecto está pausado o agotó el límite de conexiones?
   - **503 con `migrations` pendientes:** el último despliegue no aplicó su migración. Revisar el log de build en Vercel (`vercel-build` ejecuta las migraciones).
2. **¿Desde cuándo y cuánto?** En el panel, con el periodo de 1 h, ver la gráfica de errores 5xx y la de p95. Si el problema empezó con un despliegue, comparar la versión de los incidentes (`v2.x.x`).
3. **¿Qué falla?** En la tabla de incidentes:
   - la huella con más «Veces» es el error principal;
   - desplegar la pila;
   - tomar su código de soporte.
4. **Detalle:** en los logs de Vercel, filtrar por ese `request_id`. En las peticiones lentas, `db_ms` y las líneas «consulta lenta» indican si el tiempo se va en la base.
5. **Mitigar primero, investigar después:**
   - **Despliegue con errores:** en Vercel → Deployments → el anterior → *Promote to Production* (rollback en segundos). Ojo: las migraciones no se revierten solas; que sean aditivas lo hace seguro.
   - **Base saturada:** revisar las conexiones en Supabase. `DB_POOL_MAX` es 1 por instancia.
   - **Ataque o abuso:** los límites por IP (Throttler) responden 429. Si hace falta, bloquear la IP en el firewall de Vercel.
6. **Comunicar** con el formato de abajo cada 30 min (SEV1/SEV2) hasta resolverlo.
7. **Confirmar la resolución:** el monitor vuelve a verde, los 5xx vuelven a 0 y el p95 queda dentro del objetivo durante 30 min.
8. **Postmortem** (SEV1 y SEV2) dentro de los 3 días siguientes.

### Formato de actualización de estado

```markdown
## Incidente: <título>
**Severidad:** SEV<1-4> | **Estado:** Investigando | Identificado | Monitoreando | Resuelto
**Impacto:** <quién y qué está afectado>
**Última actualización:** <hora Ecuador>

### Estado actual
<lo que se sabe ahora, sin especular>

### Acciones tomadas
- <acción>

### Siguientes pasos
- <qué sigue y cuándo>
```

## 7. Plantilla de postmortem (sin culpables)

```markdown
## Postmortem: <título>
**Fecha:** <fecha> | **Duración:** <x h> | **Severidad:** SEV<x> | **Autores:** <nombres>

### Resumen
<2-3 frases: qué pasó, a quién afectó y cómo se resolvió>

### Impacto
- Usuarios afectados: <n o %> · Duración: <minutos> · Peticiones con error: <n> (panel: errores 5xx)
- Presupuesto de errores consumido: <%>

### Línea de tiempo (hora Ecuador)
| Hora | Evento |
|---|---|
| hh:mm | Detección (monitor / panel / usuario) |
| hh:mm | Mitigación |
| hh:mm | Resolución confirmada |

### Causa raíz (5 porqués)
1. ¿Por qué <síntoma>? → Porque …
2. ¿Por qué …? → Porque …
3. … → <causa raíz: un proceso o sistema, nunca una persona>

### Qué funcionó / qué no
- ✅ …
- ❌ …

### Acciones
| Acción | Responsable | Prioridad | Fecha |
|---|---|---|---|
| <prueba o alerta que lo habría detectado antes> | <nombre> | P0/P1/P2 | <fecha> |
```

## 8. Privacidad

- **Logs:** nunca se registran cuerpos, query strings ni cabeceras. La ruta se guarda como plantilla (`/atracciones/:id`).
- **Telemetría de la web:** solo envía la ruta como plantilla (sin ids ni query string), el navegador resumido («Chrome 141 · Android») y mensajes recortados. Además, la API depura todo antes de guardarlo: correos → `[correo]`, tokens JWT → `[token]`, números de 7 o más dígitos (cédulas, teléfonos, tarjetas) → `[número]`.
- **Incidentes:** no guardan el usuario; solo el `request_id`, que lleva a los logs.
- **Tablas:** viven en el esquema `ops`, con RLS y sin permisos para los roles públicos de Supabase. Solo la API accede a ellas.
- **Límites:** la entrada de telemetría (`POST /ops/telemetria`) acepta 30 lotes por minuto e IP, con un máximo de 20 señales por lote. Cada navegador envía como máximo 15 errores por sesión y nunca repite el mismo.

## 9. Límites conocidos

- Si una instancia se mata de golpe, sin apagado ordenado, se pierden como máximo 15 s de métricas suyas. Los incidentes se guardan al momento.
- Las pruebas automáticas (`navigator.webdriver`) no envían telemetría, para no ensuciar los datos reales.
- Los logs de Vercel se conservan según el plan contratado. Para guardarlos más tiempo se puede configurar un *Log Drain* (por ejemplo, Datadog) sin cambiar el código: los logs ya son JSON con `request_id` y `trace_id`.
- En la arquitectura de microservicios ([ARQUITECTURA-MICROSERVICIOS.md](ARQUITECTURA-MICROSERVICIOS.md), sección 9) esto pasa a OpenTelemetry + Jaeger + Prometheus/Grafana. Los identificadores (`traceparent` W3C) ya son compatibles.
