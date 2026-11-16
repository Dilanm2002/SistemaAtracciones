# Auditoría del Reto 2 — Descubre EC · v1.1

> **Antes de copiar:** cada `## Hoja N` es una página completa del cuaderno universitario (unos 30 renglones a mano).
> Escribe el número de hoja en la esquina superior derecha. Cada subtema sigue el orden de las auditorías V1–V4:
> **concepto → situación encontrada → hallazgo → corrección o implementación → evidencia → lección → estado**.

---

## Hoja 1 — Portada

| Dato | Detalle |
|---|---|
| Universidad | ______________________________ |
| Carrera | ______________________________ |
| Asignatura | Integración de Sistemas |
| Docente | ______________________________ |
| Estudiante | Dilan Nicolás Mena Vera |
| Documento | Auditoría del Reto 2 (semanas 7 a 11) |
| Versión del registro | 1.1 — 15 de noviembre de 2026 |
| Versión del sistema | 3.0.0 |

**Proyecto auditado.** Descubre EC es una tienda en línea para reservar atracciones turísticas del Ecuador, como
recorridos, parques y excursiones. El turista elige una atracción, escoge el día y la hora, reserva sus cupos y paga.
La empresa que ofrece la atracción administra sus horarios, cupos y precios desde un panel.

**Integración.** Descubre EC está integrada con **Booking Prototipo**, el sistema de otro equipo del curso, que vende
nuestras atracciones a sus propios clientes. Booking consulta nuestro catálogo, nuestros cupos y crea, cancela y hace
check-in de reservas por medio de un contrato acordado (versión 3.1). Nosotros le avisamos cuando cambia el stock y
cuando un turista llega a la atracción.

**Arquitectura.** El sistema funciona con 12 microservicios, un BFF para la web y un API Gateway, desplegados en Azure
Container Apps. La base de datos está en Supabase (PostgreSQL) y la web en Vercel.

**Objetivo del registro.** Revisar el proyecto tema por tema contra el temario del Reto 2 y dejar escrito qué estaba mal
o qué faltaba, cómo se corrigió o se implementó, con qué evidencia se comprobó y qué queda pendiente para la siguiente
versión.

**Alcance.** La auditoría cubre los cinco temas del Reto 2 (semanas 7 a 11) aplicados al sistema real que está en
producción: el gateway, el BFF y los 12 microservicios en Azure, el monolito y la web en Vercel, y la integración con
Booking. No cubre la parte visual de la web, que ya se revisó en las auditorías V1 a V4 y en la auditoría móvil.

**Fuentes revisadas.**

1. Código fuente del repositorio en la rama principal, versión 3.0.0.
2. Contratos: OpenAPI, archivos .proto, WSDL, AsyncAPI y GraphQL.
3. Registros de Azure Log Analytics de los días de integración con Booking.
4. Mensajes del equipo de Booking con los problemas que encontraron.
5. Reportes del script de pruebas con coeficiente Kappa.

**Período.** Del 29 de septiembre, cuando se hizo la primera auditoría (V1), al 15 de noviembre de 2026, cuando se cerró
este registro con la última corrida de pruebas.

**Cómo leer este registro.** Cada hoja corresponde a un subtema del PDF del Reto 2. Las tablas resumen los datos y los
párrafos explican qué pasó, por qué y cómo se resolvió.

---

## Hoja 2 — Índice y componentes

| Hojas | Contenido |
|---|---|
| 1 – 4 | Portada, índice, metodología y resumen |
| 5 – 14 | Semana 7 — Esquemas, compatibilidad y contratos |
| 15 – 22 | Semana 8 — API Gateways y Service Mesh |
| 23 – 31 | Semana 9 — Pruebas de integración y contract testing |
| 32 – 39 | Semana 10 — Observabilidad y trazas distribuidas |
| 40 – 48 | Semana 11 — Seguridad en integraciones |
| 49 | Pendientes y plan |
| 50 | Conclusiones y firma |

| Componente | Protocolo | Función |
|---|---|---|
| gateway | REST | Única entrada pública |
| bff-web | REST | Adapta los datos a la web |
| ms-catalog | REST | Atracciones y fotos |
| ms-location | REST | Provincias y lugares |
| ms-review | REST | Reseñas de turistas |
| ms-identity | REST | Turistas (clientes) |
| ms-pricing | gRPC | Precios y tarifas |
| ms-inventory | gRPC | Cupos por turno |
| ms-order | gRPC | Órdenes de compra |
| ms-booking | gRPC / REST | Reservas y saga |
| ms-payment | REST | Pagos |
| ms-refund | REST | Reembolsos |
| ms-coupon | REST | Cupones de descuento |
| ms-invoicing | SOAP | Facturas electrónicas |

**Por qué tres protocolos.** REST se usa donde otro equipo o la web consumen la API, porque es simple de probar. gRPC se
usa dentro de la saga, donde importa la velocidad y el tipado fuerte. SOAP se usa en la facturación para practicar la
integración con sistemas antiguos, como los de facturación tributaria.

**Cómo están organizadas las hojas.** Cada semana del temario empieza con una hoja de conceptos y sigue con los hallazgos
de ese tema. Cada subtema del PDF tiene una o dos hojas, según cuántos problemas reales hubo en el proyecto. Al final hay
una hoja de pendientes con su plan y una de conclusiones.

**Cómo se nombran los hallazgos.** La letra S y el número de semana, seguidos del número de hallazgo: S7-04 es el cuarto
hallazgo de la semana 7. Cuando un hallazgo viene de una auditoría anterior se indica también su código original (por
ejemplo, SEG-003 de la V1), para que se pueda seguir su historia completa.

**Dónde está la base de datos de cada servicio.** Cada microservicio tiene su propio esquema en Supabase (por ejemplo,
`ms_catalog` o `ms_booking`) y no lee las tablas de los otros; si necesita un dato ajeno, lo pide por la API del servicio
dueño. Así un cambio en una tabla no rompe a otro servicio.

---

## Hoja 3 — Metodología y versiones

**Cómo se hizo la auditoría.** Se tomó cada subtema del PDF del Reto 2 y se comparó con cuatro fuentes: el código del
repositorio, los contratos (OpenAPI, .proto y WSDL), los registros (logs) de Azure Log Analytics y los reportes del
script de pruebas. Cuando algo estaba mal se registró como **hallazgo** con un código: por ejemplo, S7-03 es el hallazgo
número 3 de la semana 7. Cuando algo del temario no existía en el proyecto se indicó si se implementó o, si no se
implementó, por qué y qué se hizo en su lugar.

**Cómo se decidió la prioridad.** Se miró el impacto en el negocio: si impedía vender o rompía la integración con
Booking era alto; si solo se veía mal o era una mejora, era bajo.

| Prioridad | Significado | Plazo |
|---|---|---|
| P0 | Crítico: impide entregar | Inmediato |
| P1 | Alto: rompe un flujo con Booking | Mismo día |
| P2 | Medio: error visible o riesgo | Esta versión |
| P3 | Bajo: mejora | Siguiente versión |

| Estado | Significado |
|---|---|
| Corregido | Arreglado y comprobado |
| Justificado | No se usa la herramienta, hay reemplazo |
| Pendiente | Sigue abierto, con plan |
| Externo | Lo corrige otro equipo |

| Versión del sistema | Fecha | Qué cambió |
|---|---|---|
| 2.0.0 | 30-sep | Base de datos SQL primero (auditoría V1) |
| 2.4.3 | 05-oct | Seguridad DPoP y móvil (V3, V4) |
| 2.9.x | 04-nov | 12 microservicios, gateway y BFF |
| 3.0.0 | 12-nov | Regla de cancelación de 24 h y cédula |

**Qué se considera evidencia.** Un hallazgo solo se marca como corregido si hay una prueba concreta: un caso de prueba
automática que pasa, una consulta a los registros que muestra el resultado correcto, una respuesta real de Booking o una
medición antes y después. No basta con haber cambiado el código.

**Cómo se trabajó cada corrección.**

1. Reproducir el problema en local o encontrarlo en los registros.
2. Encontrar la causa raíz, no solo el síntoma.
3. Corregir con el cambio más pequeño que no rompa la integración que ya funciona.
4. Correr las pruebas del servicio afectado.
5. Desplegar en Azure y comprobar la salud de los 13 servicios.
6. Avisar a Booking cuando el cambio lo afecta.

---

## Hoja 4 — Resumen de la auditoría

| Semana | Hallazgos | Corregidos | Justificados | Abiertos |
|---|:-:|:-:|:-:|:-:|
| 7 Contratos | 9 | 6 | 0 | 3 |
| 8 Gateway | 11 | 6 | 2 | 3 |
| 9 Pruebas | 10 | 6 | 0 | 4 |
| 10 Observabilidad | 9 | 4 | 1 | 4 |
| 11 Seguridad | 11 | 7 | 0 | 4 |
| **Total** | **50** | **29** | **3** | **18** |

**Lectura del resumen.** «Justificado» significa que no se usó la herramienta del temario (Kong, Istio, Jaeger o ELK)
por una razón explicada y que existe un reemplazo funcionando. Ningún hallazgo abierto es crítico. Casi todos son
herramientas que el proyecto aún no usa, como Kafka, Pact, OpenTelemetry, mTLS o un WAF, y para cada una se explica qué
cumple su función hoy. Un hallazgo depende del equipo de Booking.

**Hallazgos más graves que se corrigieron.** Los de mayor impacto fueron los que impedían que Booking trabajara con
nosotros: el catálogo que respondía error con `limit=100` (S7-04), la cancelación que Booking enviaba y nosotros
rechazábamos (S7-08), la web y Booking leyendo bases distintas (S8-04) y las listas que se cortaban en 64 KB (S8-02).
Todos se corrigieron antes o durante la semana de la defensa.

| Resultado de pruebas (15-nov) | Valor |
|---|---|
| Casos ejecutados | 592 |
| Coinciden con lo esperado | 100 % |
| Kappa de Cohen total | 1,000 (casi perfecta) |
| Servicios en línea | 13 de 13 |

**Conclusión rápida.** El sistema cumple los flujos calificados con Booking y lo pendiente queda planificado para la
versión 3.1.

**Qué significan los números.** De 50 hallazgos, 29 están corregidos y comprobados, 3 están justificados (no se usó la
herramienta del temario, pero hay un reemplazo que funciona) y 18 siguen abiertos. Los abiertos se dividen así: 7 de
prioridad media (P2), que están en el plan de la versión 3.1, y 11 de prioridad baja (P3), que son mejoras.

**Relación con las auditorías anteriores.** Las auditorías V1 a V4 encontraron 166 hallazgos en el monolito y la web. Los
7 críticos de la V1 se cerraron en la versión 2.0.0 y varios aparecen aquí de nuevo porque pertenecen a temas del Reto 2,
como SEG-003 (secreto del JWT) y SEG-004 (operador que veía todo).

**Qué se priorizó.** Primero se corrigió todo lo que impedía a Booking vender nuestras atracciones (catálogo, reservas,
cancelaciones y check-in), después lo que afectaba la seguridad de los datos de los turistas y al final lo que mejoraba
el diagnóstico de problemas. Las herramientas del temario que no se implementaron quedaron documentadas con su reemplazo
y su plan, para que la siguiente versión sepa por dónde empezar.

**Resultado general.** El sistema pasó de tres áreas que «no cumplían» en la auditoría V1 a cero hallazgos críticos abiertos.

---

# SEMANA 7 — Esquemas, compatibilidad y gestión de contratos

## Hoja 5 — 7.1 Contratos REST vs. gRPC (1 de 2)

**Concepto.** Un contrato en integración de sistemas es el acuerdo escrito de cómo se comunican dos sistemas: qué rutas
o métodos existen, qué datos se envían, qué tipo tiene cada campo, qué respuestas y errores pueden volver. Si el contrato
no está escrito, cada equipo supone cómo funciona el otro y los errores aparecen recién al integrar.

**Situación encontrada.** Al empezar la integración había contratos, pero Booking y nosotros los interpretábamos
distinto. Booking enviaba `identificacion` en unas llamadas e `identification` en otras, y usó dos formatos distintos
para el aviso de check-in (`external_order_id` en uno y `order_id` en otro). Era un **contrato implícito**: cada equipo
suponía cómo era el otro.

**Hallazgo S7-01 (P2).** El contrato v3 no estaba cerrado entre los dos equipos y había campos con nombres distintos.

**Corrección.** Se pasó a **Contract-Driven Development**: primero se acordó el contrato v3.1 por escrito
(`booking-atracciones-v3.yaml`) y recién después se programó. Mientras Booking ajustaba su código, el endpoint `/clientes`
aceptó los dos nombres del campo para no romperlo. El aviso de check-in quedó con el formato acordado.

| Tipo de contrato | Archivo en el proyecto |
|---|---|
| REST (OpenAPI 3) | booking-atracciones-v3.yaml y openapi.yaml de cada servicio |
| gRPC (Protobuf) | pricing, inventario, orden, reserva e inventory .proto |
| SOAP | facturacion.wsdl |
| Eventos | atracciones-asyncapi.yaml |
| GraphQL | atracciones.graphql |

**Catálogo de contratos.** Todos los contratos están en carpetas conocidas del repositorio, igual que los catálogos de
APIs de la industria, para que cualquier equipo sepa dónde buscarlos.

**Impacto en el negocio.** Mientras el contrato no estuvo cerrado, Booking no podía buscar a un turista por su cédula de
forma confiable: dependiendo del nombre del campo, la búsqueda devolvía el turista o un error. Eso habría impedido
asociar reservas a clientes reales durante la defensa.

**Cómo se verificó.**

1. Se consultó `/api/v3/clientes` con `identificacion` y con `identification`: ambas respuestas fueron 200 con el mismo
   turista.
2. Se probó la cédula con y sin guiones: también respondió el mismo turista.
3. Booking hizo un check-in real y el aviso quedó ENVIADO en nuestra base.

**Del contrato implícito al explícito.** El cambio de fondo no fue técnico sino de proceso: desde entonces cada cambio en
la integración se escribe primero en el contrato y se confirma con Booking por mensaje antes de programarlo.

**Lección.** Un contrato que no está escrito y aceptado por los dos lados no es un contrato.

**Estado:** corregido. Booking confirmó el formato y los avisos quedan en estado ENVIADO.

---

## Hoja 6 — 7.1 Contratos REST vs. gRPC (2 de 2)

**Tipado fuerte vs. débil.** En REST con JSON el tipado es débil: un precio puede llegar como texto `"20"` o como número
`20` y el error aparece tarde, cuando ya se usó el dato. En gRPC el archivo `.proto` obliga a que cada campo tenga tipo y
número, y el código cliente y servidor se genera a partir de él; si un tipo no coincide, falla al compilar o al
serializar. Por eso las llamadas internas más críticas de la saga (precios, cupos, orden y reserva) usan **gRPC**, y lo que
consume Booking usa **REST**, que es más fácil de probar con cualquier herramienta y de integrar entre equipos.

**Hallazgo S7-02 (P1).** El stock no llegaba a Booking. La variable `BOOKING_GRPC_URL`, que debía apuntar al servidor gRPC
de Booking, apuntaba a nuestro propio ms-booking. Al publicar el stock la respuesta era `UNIMPLEMENTED PushStockUpdate`,
porque nuestro servicio no implementa ese método del `.proto` de Booking.

**Causa.** El nombre de la variable era ambiguo: servía tanto para «nuestro booking» como para «el Booking de Paúl».

**Corrección.** Se separó en una variable propia, `BOOKING_STOCK_GRPC_URL`, para el stock hacia Booking. Además se dejó como
canal principal el endpoint REST `/api/v3/inventory/stock`, acordado con Booking, porque era más fácil de verificar.

| Criterio | REST | gRPC |
|---|---|---|
| Formato | JSON (texto) | Protobuf (binario) |
| Tipado | Débil | Fuerte |
| Velocidad | Menor | Mayor |
| Herramientas | Navegador, curl | Cliente generado |
| Uso en el proyecto | Booking y web | Saga interna |

**Evidencia.** En los logs de Booking apareció «Stock sincronizado exitosamente» después del cambio.

**Por qué la saga interna usa gRPC.** Una reserva hace siete llamadas entre servicios. Con gRPC cada llamada viaja en
binario por una conexión que se reutiliza, y el contrato `.proto` impide enviar un campo con el tipo equivocado. El
resultado medido es que una reserva completa, con sus siete pasos, tarda unos 81 ms.

**Por qué Booking usa REST.** Booking es otro equipo con otro código. REST con JSON se puede probar desde el navegador o
con cualquier herramienta, no necesita generar código y los errores se leen fácilmente. Para una integración entre equipos
distintos es más práctico, aunque sea más lento.

**Relación con otros hallazgos.** Este error es parecido al de la llave ajena (S8-09): en ambos casos una configuración
apuntaba al sistema equivocado y el error no se veía hasta probar con datos reales.

**Lección.** Los nombres de variables de configuración deben decir exactamente a qué sistema apuntan.

**Estado:** corregido.

---

## Hoja 7 — 7.2 Schema-first y code-first (1 de 2)

**Concepto.** En **code-first** se escribe primero el código y el esquema (de la base o de la API) se genera a partir de él.
En **schema-first** se escribe primero el esquema o contrato y el código debe cumplirlo. Code-first es rápido para empezar
pero el contrato puede cambiar sin que nadie lo note; schema-first exige más trabajo inicial pero el contrato es la
fuente de verdad.

**Situación encontrada.** Antes de la versión 2.0.0 el backend era **code-first**: TypeORM creaba y modificaba las tablas a
partir de las clases del código con la opción `synchronize`. La auditoría V1 lo marcó como crítico (DAT-001), porque un
cambio en una clase podía borrar o cambiar columnas en producción sin aviso y sin forma de volver atrás.

**Corrección.** Se pasó a **schema-first** en dos niveles:

1. **Base de datos:** el esquema se escribe en SQL (`database/01_esquema.sql`) en tercera forma normal y se aplica con
   migraciones numeradas. Cada migración guarda su huella SHA-256 para detectar si alguien la modificó.
2. **APIs:** el contrato OpenAPI se escribe antes que el controlador. Una prueba (`contract-coverage.spec.ts`) falla si
   existe una ruta en el código que no está en el contrato.

| Enfoque | Ventaja | Riesgo |
|---|---|---|
| Schema-first | El contrato es la fuente de verdad | Más trabajo inicial |
| Code-first | Rápido para empezar | El contrato se desfasa |

**Evidencia.** El CI aplica las migraciones sobre una base PostgreSQL vacía, carga los datos de prueba y verifica el modelo
con `database/02_verificacion.sql` en cada cambio.

**Riesgo que se eliminó.** Con `synchronize`, renombrar una propiedad en el código hacía que TypeORM borrara la columna
vieja y creara una nueva vacía: los datos de esa columna se perdían. Con migraciones SQL, cada cambio en la base es un
archivo que se revisa, se prueba en el CI y se aplica una sola vez, en una transacción.

**Cómo se ve una migración.** Cada archivo tiene un número (`001_`, `002_`…) y se aplica en orden. El sistema guarda en una
tabla qué migraciones ya se aplicaron y su huella. Si alguien edita una migración ya aplicada, el servicio no arranca y
avisa, en lugar de dejar la base en un estado desconocido.

**Code-first en los microservicios.** Los microservicios también son schema-first: cada uno tiene su carpeta `sql/` con
sus migraciones y su `contract/openapi.yaml` escrito a mano.

**Relación con la semana 9.** Las migraciones también se prueban: el CI crea una base vacía, aplica todas las migraciones en
orden y corre las pruebas E2E sobre ella. Si una migración tuviera un error, el CI fallaría antes de llegar a producción.

**Lección.** En integración, el contrato debe existir antes que el código, porque otro equipo depende de él.

**Estado:** corregido desde la versión 2.0.0.

---

## Hoja 8 — 7.2 Schema-first y code-first (2 de 2)

**Hallazgo S7-03 (P1).** Tres microservicios no arrancaban en local con el mensaje «la migración 002 cambió después de
aplicarse». Cada migración guarda su huella SHA-256 y la huella calculada ya no coincidía con la guardada.

**Causa.** Git en Windows (`core.autocrlf=true`) convierte los saltos de línea LF en CRLF al descargar los archivos. El
contenido visible era el mismo pero los bytes no, así que la huella cambiaba. Primero se intentó forzar LF con un archivo
`.gitattributes`, pero eso rompía las bases de Azure, que ya se habían migrado con huellas calculadas sobre CRLF.

**Corrección.** El migrador (`comun/migrador.ts`) calcula la huella con LF y con CRLF y acepta cualquiera de las dos. Así
funcionan las bases ya creadas y las nuevas, sin modificar ninguna migración aplicada.

**Evidencia.** Los 13 servicios arrancaron con las bases existentes y ms-booking se desplegó en Azure sin error.

**Versionamiento por fecha y por cabeceras.** Stripe versiona su API por **fecha**: cada cuenta queda fijada en una versión
como `2024-06-20` y puede subir cuando quiera. GitHub versiona por **cabeceras** (`X-GitHub-Api-Version`). Descubre EC
versiona por **ruta** (`/api/v1`, `/v2`, `/v3`), pero las rutas antiguas anuncian su retiro con la cabecera
`X-API-Deprecation-Date: 2027-12-31`, una idea tomada del versionamiento por cabeceras.

| Estrategia | Ejemplo | Ventaja |
|---|---|---|
| Por ruta | /api/v3 | Fácil de ver |
| Por fecha | Stripe | Cambios graduales |
| Por cabecera | GitHub | URL estable |

**Por qué no se podía simplemente borrar la huella.** Una opción rápida habría sido borrar las huellas guardadas en Azure y
volver a calcularlas. Pero eso habría quitado la protección contra migraciones modificadas en producción, que es
justamente lo que la huella existe para detectar. La solución elegida mantiene la protección y solo acepta las dos formas
de escribir el mismo contenido.

**Cómo se comprobó que era seguro.** Se calculó la huella de cada migración con LF y con CRLF y se comparó contra las
guardadas en las bases de Azure y en las de prueba: cada base coincidía con una de las dos. Ninguna migración tenía un
contenido realmente distinto.

**Qué haría diferente.** Configurar desde el inicio del proyecto los saltos de línea del repositorio, antes de aplicar la
primera migración en producción.

**Relación con la semana 11.** La huella de cada migración usa SHA-256, la misma familia de funciones hash que se estudia en
cifrado y hashing: cualquier cambio en el archivo, aunque sea un solo byte, produce una huella distinta.

**Lección.** Una huella de integridad debe calcularse siempre igual, sin depender del sistema operativo.

**Estado:** corregido.

---

## Hoja 9 — 7.3 JSON Schema, Avro y Protobuf (1 de 2)

**Concepto.** JSON Schema describe cómo debe ser un documento JSON: tipos (`string`, `integer`), campos obligatorios
(`required`), límites (`minimum`, `maximum`) y formatos (`email`, `uuid`). Permite anidar esquemas y combinarlos con
`allOf` (cumple todos), `oneOf` (cumple exactamente uno), `anyOf` (cumple al menos uno) y `not` (no cumple).

**Situación encontrada.** Los contratos OpenAPI describen cada respuesta con JSON Schema. Para no repetir estructuras se
usa composición con `allOf` (10 usos en los contratos), por ejemplo una reserva que extiende los datos básicos de la
atracción. No se usan `oneOf`, `anyOf` ni `not`.

**Hallazgo S7-04 (P1).** Booking pedía el catálogo con `limit=100` y recibía error 400, porque el esquema fija un máximo
de 50 (`maximum: 50`). Por eso las atracciones nuevas, como «Descubre EC Lunes», no aparecían en Booking: su pedido
fallaba entero. Se encontró en los logs del gateway: 8 llamadas `GET /api/v3/atracciones?limit=100 → 400`.

**Corrección.** Se aplicó el principio del **lector tolerante** (ley de Postel: ser estricto al enviar y tolerante al
recibir). Si piden más de 50, el servicio responde 50 y no un error. El contrato no cambió; solo cambió cómo se interpreta
el pedido, en `ms-catalog/src/dto.ts`.

| Composición | Significado | Uso en el proyecto |
|---|---|---|
| allOf | Cumple todos | Extender un esquema base |
| oneOf | Exactamente uno | No usado |
| anyOf | Al menos uno | No usado |
| not | No cumple | No usado |

**Evidencia.** `?limit=100` responde 200 con las 28 atracciones y se agregó una prueba nueva en ms-catalog. Booking
confirmó que ya veía la atracción nueva.

**Cómo se encontró.** Booking avisó que la atracción nueva no aparecía. Primero se revisó la base: la atracción existía y
estaba activa. Después se revisaron los registros del gateway y apareció el patrón: todas las llamadas de Booking al
catálogo terminaban en 400, mientras que las de nuestra web, que pide 12 por página, terminaban en 200.

**Por qué no se cambió el contrato.** Subir el máximo a 100 habría sido un cambio del contrato que Booking y otros nodos
tendrían que conocer. Responder 50 cuando piden más respeta el contrato tal como está escrito y Booking igual recibe todas
las atracciones, porque hoy hay 28.

**Riesgo pendiente.** Si algún día hubiera más de 50 atracciones, Booking necesitaría pedir la segunda página con el
parámetro de paginación del contrato. Se le avisó de este límite.

**Relación con la semana 9.** Se agregó el caso «Catálogo v3 con limit=100, como lo pide Booking» al script E2E, para que
este error no vuelva a aparecer sin que se note.

**Lección.** Un límite del contrato debe decir qué pasa cuando se supera; si no, el consumidor queda bloqueado.

**Estado:** corregido.

---

## Hoja 10 — 7.3 JSON Schema, Avro y Protobuf (2 de 2)

**Avro y Kafka.** Apache Avro es un formato binario con esquema que se usa mucho con Kafka: cada mensaje lleva el
identificador de su esquema y el consumidor sabe cómo leerlo. El proyecto **no usa Avro ni Kafka**.

**Qué se hizo en su lugar.** Los eventos se guardan en una tabla `evento` (patrón **outbox**) en la misma transacción del
cambio; así, si la reserva se guarda, el evento también, y si falla, ninguno. Un despachador los envía cada 3 segundos,
en orden, con formato **CloudEvents 1.0** por REST a los servicios interesados, y reintenta hasta 20 veces. El script
`003_eventos.sql` deja preparada la columna `evt_publicado_en` para que un relay publique esos eventos en Kafka o
RabbitMQ en el futuro.

**Hallazgo S7-05 (P3).** No hay un formato binario con esquema para los eventos (Avro); los eventos son JSON.

**Protobuf y evolución de esquemas.** En los `.proto` cada campo tiene un número fijo que es lo que viaja en el mensaje,
no el nombre. Reglas seguidas en el proyecto:

1. Nunca cambiar el número ni el tipo de un campo existente.
2. Agregar los campos nuevos con números nuevos.
3. No reutilizar el número de un campo borrado.

Así un cliente viejo ignora el campo nuevo y sigue funcionando (compatibilidad hacia atrás).

| Formato | Tipo | En el proyecto |
|---|---|---|
| JSON Schema | Texto | Contratos OpenAPI y stock-actualizado.schema.json |
| Protobuf | Binario | 5 archivos .proto |
| Avro | Binario | No se usa |

**Justificación.** Sin un broker de mensajes, Avro no aporta; el outbox ya garantiza que ningún evento se pierda.

**Cómo funciona el despachador.** Cada 3 segundos el despachador busca los eventos que aún no se enviaron, los envía en el
orden en que se crearon y marca cada uno como enviado cuando el destino responde bien. Si el destino no responde, el
evento se queda en la tabla y se intenta en la siguiente vuelta, hasta 20 veces. Así un servicio caído unos minutos no hace
perder ningún evento.

**Formato CloudEvents.** Cada evento lleva los campos estándar `specversion`, `type`, `source`, `id` y `time`, y los datos
en `data`. Si en el futuro se usa Kafka, el mismo formato se puede publicar sin cambiar a los consumidores.

**Qué haría diferente.** Si el proyecto creciera, usaría un broker con un registro de esquemas, para que cada servicio
reciba eventos sin que el emisor tenga que conocer la dirección de todos los destinos.

**Estado:** pendiente (P3).

---

## Hoja 11 — 7.4 Schema Registry y versionamiento (1 de 2)

**Concepto.** Un Schema Registry es un servidor que guarda todas las versiones de cada esquema y, antes de aceptar una
versión nueva, comprueba que sea compatible con las anteriores. Resuelve el problema de que un productor cambie el
formato de un mensaje y rompa a todos los consumidores sin darse cuenta.

**Situación encontrada.** El proyecto no tiene un Schema Registry, porque no usa Kafka y los esquemas no viajan dentro de
los mensajes.

**Hallazgo S7-06 (P3).** No hay un registro central de esquemas.

**Qué se hizo en su lugar.** Los contratos viven en el repositorio, versionados con Git, en carpetas conocidas:
`backend/contracts`, `microservicios/proto` y `contract/` dentro de cada servicio. El contrato de Booking está copiado en
los servicios que lo implementan (booking, catalog, coupon e inventory), y las pruebas validan cada respuesta contra ese
archivo. Git cumple el papel de historial de versiones y las pruebas cumplen el papel de control de compatibilidad.

| Función del Schema Registry | Reemplazo en Descubre EC |
|---|---|
| Guardar versiones | Historial de Git |
| Un solo lugar | Carpetas contract/ y proto/ |
| Rechazar incompatibles | Pruebas con ajv |
| Avisar a consumidores | Mensaje directo a Booking |

**Niveles de compatibilidad.** NONE no revisa nada. BACKWARD: el consumidor nuevo puede leer datos viejos. FORWARD: el
consumidor viejo puede leer datos nuevos. FULL: ambas cosas. Las versiones *transitivas* (BACKWARD_TRANSITIVE, etc.)
comparan contra **todas** las versiones anteriores y no solo contra la última. En el proyecto se busca FULL: solo se
agregan campos opcionales, nunca se quitan.

**Cómo se controla la compatibilidad sin registro.** Cuando se cambia un contrato:

1. Se edita primero el archivo del contrato en el repositorio.
2. Se corren las pruebas de integración del servicio, que validan cada respuesta contra el contrato con ajv.
3. Se corren los 35 casos E2E de la API, que incluyen las llamadas reales de Booking.
4. Si el cambio afecta a Booking, se le avisa antes de desplegar.

**Problema que esto no resuelve.** El contrato de Booking está copiado en cuatro servicios. Si se actualiza en uno y no en
los demás, quedarían versiones distintas. Hoy se controla a mano; un registro central lo evitaría.

**Ventaja de tener los contratos en Git.** Cada cambio queda con fecha, autor y motivo, y se puede comparar una versión con
otra para ver exactamente qué campo se agregó.

**Lección.** Sin registro, la disciplina de «solo agregar» tiene que cumplirse a mano y revisarse en las pruebas.

**Estado:** pendiente (P3), con reemplazo funcionando.

---

## Hoja 12 — 7.4 Schema Registry y versionamiento (2 de 2)

**SemVer aplicado.** El versionamiento semántico usa tres números: MAJOR.MINOR.PATCH. Hasta el 12 de noviembre la última
etiqueta publicada era `v2.0.0`, aunque el sistema ya iba por la versión 2.9; las versiones intermedias no tenían
etiqueta, así que no se sabía qué código correspondía a cada versión.

**Hallazgo S7-07 (P2).** Versiones sin etiquetar y sin registro de cambios claro.

**Corrección.**

1. Se escribió el `CHANGELOG.md` con la sección de la versión **3.0.0** y lo que cambió.
2. Se creó la etiqueta `v3.0.0` en Git y la publicación (release) en GitHub.
3. Una prueba (`version.spec.ts`) comprueba que la versión sea la misma en todos los `package.json`.

Se subió el número **mayor** porque cambió una regla de negocio que afecta a los consumidores: la cancelación ahora solo
devuelve el dinero con 24 horas o más de anticipación. Quien cancelaba antes con menos tiempo ahora recibe 409.

| SemVer | Cuándo sube | Ejemplo del proyecto |
|---|---|---|
| MAJOR | Cambio incompatible | 3.0.0: regla de 24 h |
| MINOR | Función nueva compatible | 2.9: microservicios |
| PATCH | Corrección | 2.4.3: arreglos |

**Versionamiento de rutas REST.** `/api/v1` es la API propia de Descubre EC; `/api/v2` y `/api/v3` son las versiones del
contrato con Booking. La v2 se mantiene viva para no romper a quien todavía la use, y la v3 es la actual.

**Evidencia.** Prueba `version.spec.ts`: 3 de 3; etiqueta `v3.0.0` visible en GitHub.

**Por qué importa el CHANGELOG.** Cuando Booking pregunta qué cambió, el registro de cambios responde con la versión y la
fecha. Sin él, la única forma de saberlo era revisar los commits uno por uno.

**Qué incluye la versión 3.0.0.**

1. Regla de cancelación de 24 horas, con reembolso del 100 % solo con anticipación suficiente.
2. Cédula obligatoria en el registro de la web, con validación del dígito verificador.
3. Reservas de Booking visibles en «Mis reservas».
4. Búsqueda por cédula y teléfono en el panel.
5. Actualización automática del panel y de los cupos en vivo.

**Relación con la semana 9.** La prueba de versión es un gate: si alguien sube la versión en un paquete y se olvida de los
demás, el CI falla.

**Lección.** El número de versión comunica a los consumidores si deben preocuparse por un cambio.

**Estado:** corregido.

---

## Hoja 13 — 7.5 Validación y backward compatibility (1 de 2)

**Concepto.** Un cambio es **compatible hacia atrás** (backward) si los consumidores actuales siguen funcionando sin
modificarse. Un **breaking change** obliga a los consumidores a cambiar su código.

**Situación encontrada.** Cuando Booking cancelaba una reserva, nuestro sistema respondía 400 y la reserva seguía activa en
la web. Se encontró en Azure Log Analytics: `POST /api/v3/reservas/DEC-R9ES2A/cancel → 400`.

**Hallazgo S7-08 (P1).** La validación era tan estricta que rompía la compatibilidad con el consumidor. Había dos causas:

1. Se exigía la cabecera `Idempotency-Key`, que Booking no enviaba al cancelar.
2. La validación rechazaba campos que no estaban en el DTO (`client_id`, `cancelled_by`) que Booking sí enviaba.

**Corrección.** La cabecera pasó a ser opcional para cancelar, porque cancelar dos veces ya da el mismo resultado: la
operación es idempotente por naturaleza. Del cuerpo solo se lee el motivo y lo demás se ignora
(`ms-booking/src/controladores.ts`). Además se **agregaron** campos a la respuesta (`cancel_code`, `refund`,
`stock_restoration`) sin quitar ninguno, lo cual es un cambio compatible.

| Cambio | ¿Compatible? |
|---|---|
| Agregar un campo a la respuesta | Sí |
| Volver opcional un campo obligatorio | Sí |
| Aceptar más valores de entrada | Sí |
| Quitar o renombrar un campo | No (breaking) |
| Volver obligatorio un campo opcional | No (breaking) |
| Cambiar el tipo de un campo | No (breaking) |

**Evidencia.** Cancelar sin cabecera responde 200 con el comprobante de reembolso; repetirlo responde 200 con el mismo
resultado; los cupos vuelven al turno.

**Por qué la cabecera era obligatoria antes.** `Idempotency-Key` evita que una petición repetida por un error de red cree
dos reservas. Para **crear** una reserva sigue siendo obligatoria, porque crear dos veces sí tiene efecto doble. Para
**cancelar** no hace falta: cancelar una reserva ya cancelada no cambia nada y devuelve el mismo resultado.

**Qué responde ahora la cancelación.**

| Campo | Contenido |
|---|---|
| cancel_code | Código único de la cancelación |
| refund | Monto y estado del reembolso |
| stock_restoration | Cupos devueltos al turno |

**Relación con otros hallazgos.** Este problema se encontró gracias a los registros centralizados (S10-01) y al
correlation_id (hoja 38).

**Lección.** Validar es necesario, pero rechazar lo que no se usa solo rompe a los consumidores.

**Estado:** corregido.

---

## Hoja 14 — 7.5 Validación y backward compatibility (2 de 2)

**Validación de requests y respuestas con ajv.** ajv es una librería que valida un JSON contra un JSON Schema. Cada
microservicio tiene en `test/helpers.ts` una función que carga el contrato OpenAPI y valida con ajv cada respuesta de sus
pruebas de integración. Si un servicio devuelve un campo con otro tipo o le falta uno obligatorio, la prueba falla antes
de que el error llegue a Booking.

**Verificación en CI.** El workflow `.github/workflows/ci.yml` se ejecuta en cada cambio que se sube a GitHub:

| Paso del CI | Qué revisa |
|---|---|
| redocly lint | Que el contrato OpenAPI esté bien escrito |
| contract-coverage.spec | Que cada ruta del código esté en el contrato |
| test:e2e | Que la API responda según el contrato |
| npm audit | Dependencias sin fallas graves |

**Hallazgo S7-09 (P2).** El CI valida el contrato del monolito, pero no los de los 12 microservicios, que solo se validan
cuando se corren sus pruebas en la computadora del desarrollador.

**Qué se hizo.** El script `pruebas/ejecutar-pruebas.mjs` corre las pruebas de integración de los 12 servicios (242 casos)
contra sus bases de prueba y termina con error si alguno no coincide, de modo que se puede agregar al CI como un paso
más. Mientras tanto, se ejecuta antes de cada despliegue.

**Cómo se detecta un breaking change antes de desplegar.** Si alguien quitara un campo obligatorio de una respuesta, la
validación con ajv de ese servicio fallaría, el script terminaría con código 1 y el despliegue no debería hacerse.

**Ejemplo de lo que detecta ajv.** Si ms-catalog devolviera el precio como texto (`"20.00"`) cuando el contrato dice
número, la prueba fallaría con un mensaje que indica el campo y el tipo esperado. Si faltara un campo obligatorio como
`attraction_id`, también fallaría. Así los errores de formato se encuentran en la computadora del desarrollador y no en
Booking.

**Validación de las peticiones.** Además de las respuestas, cada servicio valida lo que recibe con DTO de class-validator:
tipos, largos, formatos de correo y de cédula. Lo que no cumple se rechaza con 400 o 422 y un mensaje claro en formato
RFC 7807.

**Qué haría diferente.** Agregar desde el principio un job del CI por cada microservicio, igual que existe para el monolito.

**Relación con la semana 8.** El gateway no valida los datos de las peticiones; solo enruta. La validación vive en cada
microservicio, que es el dueño de sus reglas. Así, si mañana se reemplaza el gateway por Kong, la validación sigue igual y
no hay que repetirla.

**Resultado.** En la última corrida, las 242 pruebas de integración pasaron y todas las respuestas cumplieron su contrato.

**Lección.** Una validación que no corre automáticamente termina olvidándose.

**Estado:** corregido en local; agregarlo al CI queda pendiente.

---

# SEMANA 8 — API Gateways y Service Mesh

## Hoja 15 — 8.1 Funciones del API Gateway (1 de 2)

**Concepto.** Un API Gateway es la puerta única de entrada a un conjunto de servicios. Recibe todas las peticiones de
afuera y las envía al servicio correcto. Puede centralizar enrutamiento, compresión, autenticación del borde, límites y
registros. **No** debe contener reglas de negocio: si el gateway decide precios o permisos, se vuelve un monolito
escondido. La historia va de Zuul (Netflix, Java) a gateways modernos como Kong o Envoy.

**Situación encontrada.** Antes del 4 de noviembre cada microservicio tenía su propia dirección pública. Booking habría
tenido que conocer 12 direcciones y cada servicio debía protegerse por su cuenta.

**Implementación.** Se creó un **API Gateway** propio en NestJS con `http-proxy-middleware`. Es la única entrada pública y
envía cada ruta al servicio dueño.

| El gateway hace | El gateway no hace |
|---|---|
| Enrutar por prefijo | Reglas de negocio |
| Comprimir respuestas grandes | Guardar datos |
| Unir la salud de los 13 servicios | Validar reservas |
| Bloquear rutas /internal | Calcular precios |
| Traducir alias de rutas | Decidir permisos de un turista |

**Hallazgo S8-01 (P2).** Booking usaba la ruta en inglés `/reservations/` y recibía 404 «no es parte del contrato», porque
solo existía `/reservas/`.

**Corrección.** Se agregó un alias en el gateway (`ALIAS_RESERVAS` en `gateway/src/rutas.ts`) que traduce
`/reservations/` a `/reservas/` sin tocar el microservicio. Es justo el tipo de tarea que sí le corresponde a un gateway.

**Evidencia.** El caso E2E «Ruta en inglés /reservations» responde igual que la ruta en español.

**Cómo se decide a qué servicio va cada ruta.** El archivo `rutas.ts` tiene una tabla de prefijos. Por ejemplo,
`/api/v3/atracciones` va a ms-catalog, `/api/v3/clientes` a ms-identity y `/api/v3/reservas` a ms-booking. Si una ruta no
está en la tabla, el gateway responde 404 con un mensaje que dice que no es parte del contrato del nodo, en lugar de
reenviarla a ciegas.

**Por qué el gateway no valida reservas.** Si el gateway revisara reglas como la de 24 horas, habría dos lugares con la
misma regla y tarde o temprano dirían cosas distintas. La regla vive solo en ms-booking, que es su dueño.

**Salud agregada.** `/api/v3/health` consulta a los 13 servicios y responde UP si todos están bien, DEGRADED si alguno está
lento y DOWN si alguno no responde. Booking usa esta respuesta para su semáforo.

**Lección.** El gateway sirve para adaptar rutas a los consumidores sin cambiar los servicios.

**Estado:** corregido.

---

## Hoja 16 — 8.1 Funciones del API Gateway (2 de 2)

**Hallazgo S8-02 (P1).** La lista de reservas del panel nunca terminaba de cargar en Azure. Siempre se cortaba en
65 235 bytes; con el catálogo pasaba lo mismo.

**Diagnóstico.** Se descartaron las hipótesis una por una, cambiando solo una cosa a la vez:

| Hipótesis | Prueba | Resultado |
|---|---|---|
| Red de la casa | Probar desde otra red | Falló igual |
| Código del BFF | Correrlo en Docker local | Funcionó |
| Protocolo HTTP/1 | Otro transporte | Falló igual |
| Proxy del gateway | Revisar cabeceras | Connection: close |

**Causa.** El proxy abría y cerraba una conexión por cada petición interna (`Connection: close`). Con respuestas de más de
64 KB, la conexión se cerraba antes de terminar de enviar.

**Corrección.** Se le dio al proxy un agente HTTP con **keep-alive**, que reutiliza conexiones, y se agregó compresión
gzip/br para las listas grandes (`gateway/src/proxy.ts`). El primer intento, solo con compresión, dejó las listas sin
respuesta y se revirtió en minutos a la revisión anterior.

**Evidencia.** Catálogo de 96 KB en 0,9 s; reservas de 170 KB comprimidas a 14 KB en 1 s.

**Caching en el gateway.** No se implementó caché. La salud responde con `Cache-Control: no-store` porque debe ser
siempre actual, y el catálogo cambia en vivo con los cupos. **Hallazgo S8-03 (P3):** se podría guardar 30 segundos la ficha
de una atracción (nombre, fotos, descripción), que casi no cambia, para aliviar a ms-catalog.

**Por qué el problema no aparecía en local.** En Docker local no hay un balanceador delante del gateway y las conexiones se
comportaban distinto. Por eso era necesario probar en Azure con la misma configuración que usa Booking, y no confiar en que
«en mi máquina funciona».

**Cómo se midió la mejora.** Se pidió la misma lista varias veces antes y después del cambio, anotando el tamaño recibido y
el tiempo.

| Lista | Antes | Después |
|---|---|---|
| Catálogo | Se cortaba en 64 KB | 96 KB en 0,9 s |
| Reservas del panel | Se cortaba en 64 KB | 14 KB comprimidos en 1 s |

**Qué haría diferente.** Probar desde el primer día con listas grandes y no solo con pocos datos de prueba.

**Relación con la semana 10.** Este problema se diagnosticó midiendo el tamaño y el tiempo de cada respuesta, que son
métricas de latencia y throughput. Sin medir, la causa habría parecido la red de la casa o el código del BFF.

**Lección.** Medir y descartar hipótesis evita corregir lo que no está roto.

**Estado:** S8-02 corregido; S8-03 pendiente.

---

## Hoja 17 — 8.2 Patrones BFF, Aggregator y Proxy (1 de 2)

**Concepto.** Un **proxy inverso** recibe peticiones y las reenvía sin cambiarlas. Un **BFF** (Backend for Frontend) es un
backend hecho a la medida de un tipo de cliente: arma los datos en el formato que esa pantalla necesita. Un
**Aggregator** llama a varios servicios y une sus respuestas en una sola.

**Situación encontrada.** La web y el panel escribían en el monolito, y Booking leía los microservicios. Una atracción
creada en la web no aparecía en Booking.

**Hallazgo S8-04 (P0 para la defensa).** Dos fuentes de datos separadas para el mismo negocio.

**Opciones evaluadas.**

| Opción | Ventaja | Desventaja |
|---|---|---|
| A) Web a microservicios por un BFF | Un solo dato | Más trabajo |
| B) Sincronizar las dos bases | Rápida | Datos duplicados |
| C) Booking al monolito | Simple | Rompe el contrato |

**Decisión e implementación.** Se eligió la **opción A**. Se creó `bff-web`, que habla el formato que la web ya conocía y
por dentro llama a los microservicios. La web cambia a este modo con la variable `VITE_BFF_URL`; si se quita, vuelve al
monolito sin cambiar código, lo que sirve como plan de vuelta atrás. El inicio de sesión y las fotos siguen en el monolito
en Vercel, y ambos lados usan el mismo `JWT_SECRET` para reconocer el mismo token.

**Evidencia.** Se ensayaron los dos flujos calificados en Azure: crear una atracción en la web y verla en Booking, y
reservar desde Booking y verla en el panel.

**Qué cambió para la web.** Antes, la web pedía todo al monolito. Ahora pide las atracciones, cupos, precios y reservas al
BFF, que a su vez las pide a los microservicios. La web no tuvo que reescribirse: el BFF responde con los mismos nombres de
campos que respondía el monolito, así que solo se cambió la dirección base.

**Qué se quedó en el monolito y por qué.** El inicio de sesión y las fotos siguen en Vercel porque mover el inicio de sesión
habría obligado a cambiar el manejo de tokens DPoP justo antes de la defensa, con riesgo de romper el acceso de todos los
usuarios. Se dejó para una versión posterior.

**Riesgo controlado.** El plan de vuelta atrás (quitar `VITE_BFF_URL`) se probó antes de activar el BFF en producción.

**Relación con la semana 11.** Como la web y los microservicios aceptan el mismo token, la seguridad depende de que el
`JWT_SECRET` esté protegido en los dos lugares. Se guardó como variable de entorno en Vercel y en Azure, nunca en el código.

**Lección.** Antes de duplicar datos conviene unificar la fuente, aunque cueste más trabajo.

**Estado:** corregido.

---

## Hoja 18 — 8.2 Patrones BFF, Aggregator y Proxy (2 de 2)

**Cómo se combinan los tres patrones en Descubre EC.**

| Patrón | Dónde está | Qué hace |
|---|---|---|
| Proxy inverso | gateway | Envía /api/v3 al servicio dueño |
| BFF | bff-web | Formato propio de la web |
| Aggregator | bff-web | Une catálogo, ubicación, cupos y precios |

Booking entra por el proxy (`/api/v3`), la web entra por el BFF (`/bff/v1`) y los dos llegan a los mismos microservicios.
Es lo que hacen empresas como Netflix o Spotify: un gateway común y un BFF para cada tipo de cliente (web, móvil, socios).

**Hallazgo S8-05 (P2).** Las atracciones nuevas perdían sus fotos al guardarse. El BFF buscaba las fotos en el monolito,
pero las atracciones creadas por microservicios las tenían en `ms_catalog`. **Corrección:** la tienda sirve también las
fotos guardadas en `ms_catalog`, sin tocar el flujo de Booking que ya funcionaba.

**Hallazgo S8-06 (P2).** Había dos atracciones con el mismo nombre («Hoy DescubreEC Sábado»): una con reservas y 10 cupos, y
otra sin reservas y 20 cupos. El panel mostraba «0/20» y parecía que el stock estaba mal. Al revisar los datos se vio que
el stock era correcto y que la confusión venía del nombre repetido. **Corrección:** el BFF rechaza nombres repetidos y los
selectores del panel muestran la fecha junto al nombre.

**Hallazgo extra del calendario.** Hoy, después de la última salida, el día aparecía como «agotado». Se corrigió para
mostrarlo como día pasado.

**Cómo trabaja el aggregator.** Cuando la web muestra una atracción, el BFF hace en paralelo varias llamadas: datos y fotos a
ms-catalog, la provincia a ms-location, los cupos a ms-inventory y el precio a ms-pricing. Después une todo en una sola
respuesta. Para la web es una sola llamada, aunque por dentro sean cuatro.

**Cómo se verificó el stock.** Se sumaron los cupos reservados de cada turno y se compararon con los cupos disponibles que
mostraba el panel. Los números coincidían. La reserva que Booking veía con 5 personas y el panel con 20 cupos eran de
atracciones distintas con el mismo nombre.

**Qué haría diferente.** Validar nombres únicos desde el primer día en la creación de atracciones.

**Lo que se aprendió del caso del stock.** Antes de concluir que un cálculo está mal hay que revisar los datos con los que
se calcula. Aquí el cálculo de cupos estaba bien desde el principio: el problema era que había dos registros que el usuario
no podía distinguir.

**Resultado.** El BFF rechaza crear una atracción con un nombre que ya existe y lo explica con un mensaje.

**Lección.** Antes de cambiar el cálculo del stock, revisar los datos: el error era de presentación.

**Estado:** ambos corregidos.

---

## Hoja 19 — 8.3 Kong, Apigee o Nginx

**Concepto.** Kong y Nginx son gateways de código abierto (Kong tiene además versión comercial); Apigee es comercial, de
Google. Nginx puro es un servidor web y proxy muy rápido, pero cada función extra se configura a mano. Kong está construido
sobre Nginx y agrega plugins listos: autenticación, rate limiting, registros y transformaciones.

**Situación encontrada.** El proyecto **no usa ninguno** de estos gateways.

**Hallazgo S8-07 (P3).** Gateway propio en lugar de uno de mercado.

**Justificación.** Se eligió un gateway propio en NestJS por tres motivos:

1. El equipo ya usa NestJS en los 12 servicios y el BFF, así que no hay que aprender otra herramienta.
2. Se necesitaban funciones específicas: unir la salud de los 13 servicios para el semáforo de Booking y traducir alias
   de rutas.
3. Azure Container Apps ya trae **Envoy** en la entrada, que da TLS y balanceo; Kong habría sido otro contenedor más con
   su propia configuración y costo.

| Criterio | Kong | Gateway propio |
|---|---|---|
| Tipo | Open source / comercial | Código propio |
| Rate limiting | Plugin listo | No implementado |
| Autenticación | Plugin listo | En cada servicio |
| Salud agregada | Hay que programarla | Implementada |
| Costo | Otro contenedor | Ninguno extra |

**Kong DB-less vs. con base de datos.** En modo DB-less toda la configuración está en un archivo YAML y se cambia
redesplegando; con base de datos (PostgreSQL) se cambia en caliente por una API. Nuestro gateway equivale al modo
DB-less: las rutas están en `rutas.ts` y se cambian con un despliegue.

**Qué tendría que cambiar para usar Kong.** Se crearía un contenedor de Kong en modo DB-less con un archivo YAML que declare
cada servicio y su ruta, y se activarían los plugins `key-auth` para la llave de Booking y `rate-limiting` para el límite
de peticiones. La salud agregada de los 13 servicios seguiría necesitando un servicio propio, porque Kong no la ofrece así.

**Nginx puro vs. Kong.** Con Nginx puro todo se escribe en su archivo de configuración y no hay plugins de autenticación
listos; Kong agrega esa capa encima de Nginx y una API para administrarla.

**Conclusión.** Para la versión 3.1 se evaluará Kong si se necesitan varias de sus funciones a la vez (llaves, límites y
registros), porque en ese punto ya no convendría programarlas a mano.

**Lección.** Usar una herramienta de mercado conviene cuando se necesitan muchas de sus funciones; aquí bastaba con pocas.

**Estado:** justificado.

---

## Hoja 20 — 8.4 Istio y Linkerd

**Tráfico norte-sur y este-oeste.** El tráfico **norte-sur** entra desde afuera: Booking y la web hacia el gateway. El
**este-oeste** va de un servicio a otro, por ejemplo ms-booking llamando a ms-inventory por gRPC. En Descubre EC el
este-oeste viaja por la red interna del entorno de Azure y nunca sale a internet.

**Concepto.** Un **Service Mesh** (Istio o Linkerd) controla el tráfico este-oeste poniendo un **sidecar** (un proxy, por
ejemplo Envoy) junto a cada servicio. El sidecar da mTLS, reintentos, tiempos de espera y trazas sin cambiar el código.
Istio tiene más funciones y es más pesado; Linkerd es más simple y liviano.

**Hallazgo S8-08 (P3).** No hay Service Mesh ni sidecar.

**Qué se hizo en su lugar.** Las funciones que daría un mesh se programaron en el código común de cada servicio:

| Función de un mesh | Implementación propia |
|---|---|
| Tiempo máximo de espera | 3 s en HTTP y deadline en gRPC |
| Error ante caída | 503 DEPENDENCY_UNAVAILABLE |
| Identidad entre servicios | X-Servicio-Token |
| Trazas | X-Correlation-Id |
| mTLS | No implementado |

**Cuándo conviene un mesh.** Con decenas de servicios, varios equipos y lenguajes distintos, porque evita repetir el mismo
código en todos. Con 12 servicios en un solo lenguaje y un solo desarrollador, Istio agregaría un sidecar por contenedor,
más memoria de la que el plan gratuito permite y más complejidad para depurar.

**Cómo funciona el tiempo máximo de espera.** Cada llamada HTTP entre servicios usa `AbortSignal.timeout(3000)` y cada
llamada gRPC usa un *deadline* de 3 segundos. Si el otro servicio no responde a tiempo, la llamada se corta y se devuelve
503 DEPENDENCY_UNAVAILABLE, en vez de quedarse esperando indefinidamente.

**Identidad entre servicios.** Las llamadas internas llevan `X-Servicio-Token`, un secreto compartido de al menos 16
caracteres que se compara en tiempo constante. Un servicio que recibe una llamada interna sin el token correcto responde
401, aunque la llamada venga de dentro de la red.

**Qué haría diferente.** Si el sistema creciera a más equipos, usaría Linkerd por ser más liviano que Istio, para obtener
mTLS automático sin cambiar el código.

**Relación con la semana 11.** Sin mTLS, el tráfico interno entre servicios no va cifrado de extremo a extremo dentro del
entorno de Azure. Se considera aceptable porque esa red no es accesible desde internet, pero queda anotado como pendiente
(S11-04).

**Lección.** Un mesh resuelve un problema de escala; sin esa escala, el costo supera el beneficio.

**Estado:** justificado.

---

## Hoja 21 — 8.5 Políticas de seguridad y despliegue (1 de 2)

**JWT vs. API Key en el borde.** Una **API Key** identifica a un sistema: es una clave fija que se envía en cada llamada.
Un **JWT** identifica a una persona con sus roles y vence. Booking es un sistema: se le dio una API Key (`X-API-Key`). La
web y el panel son personas: usan JWT con rol.

**Hallazgo S8-09 (P1, seguridad).** Booking indicó usar una llave que pertenecía a otro nodo (el de autos). Usarla habría
mezclado credenciales de dos equipos: si una se filtraba, se comprometían ambos.

**Corrección.** Se acordó con Booking una llave propia para nuestro nodo en ambos sentidos y se compara en tiempo constante
para no dar pistas por el tiempo de respuesta.

**Despliegue canary.** Un despliegue canary envía primero una parte del tráfico a la versión nueva y, si falla, se vuelve
atrás. Azure Container Apps crea una **revisión** nueva por cada despliegue y solo le pasa el tráfico si arranca bien.

**Incidente del 12 de noviembre.** Se desplegó el gateway con Docker apagado: la imagen no se construyó y la revisión nueva
quedó *Unhealthy*. El tráfico siguió en la revisión anterior, así que nadie notó caída, y se hizo *rollback*.

**Corrección del proceso.**

| Paso | Acción |
|---|---|
| 1 | Construir la imagen |
| 2 | Confirmar que existe en el registro (az acr show-tags) |
| 3 | Recién actualizar el servicio |
| 4 | Revisar la salud: 13 UP |

**Por qué comparar en tiempo constante.** Una comparación normal de textos se detiene en el primer carácter distinto, así que
tarda un poco más cuando más caracteres coinciden. Un atacante podría medir esos tiempos para adivinar la llave carácter por
carácter. `timingSafeEqual` siempre tarda lo mismo.

**Qué pasó con la revisión fallida.** Azure intentó arrancar la revisión nueva, no encontró la imagen y la marcó como no
saludable. Como la revisión anterior seguía activa, el tráfico nunca pasó a la nueva. Se volvió a la imagen anterior, se
encendió Docker, se construyó la imagen, se confirmó que existía en el registro y se desplegó de nuevo.

**Relación con la semana 10.** El semáforo de salud mostró 13 UP durante todo el incidente, lo que confirmó que los usuarios
no se vieron afectados.

**Qué se aprendió.** Un despliegue es seguro cuando se puede volver atrás rápido. Las revisiones de Azure permitieron hacerlo
en minutos y sin que Booking ni los turistas notaran el problema.

**Lección.** Nunca desplegar sin comprobar que el artefacto existe.

**Estado:** corregido.

---

## Hoja 22 — 8.5 Políticas de seguridad y despliegue (2 de 2)

**Rate limiting.** Limitar cuántas peticiones puede hacer un cliente por minuto protege de abusos y de errores en bucle. El
monolito limita con Throttler (5 intentos por minuto en el login, desde la auditoría V1, SEG-005). El gateway de
microservicios **no** limita peticiones.

**Hallazgo S8-10 (P2).** Sin límite de peticiones por llave en el gateway. Si Booking entrara en un ciclo de reintentos
por un error suyo, podría saturar los servicios y la base de datos.

**Hallazgo S8-11 (P2).** Límite de conexiones de la base. Supabase permite 15 conexiones y los servicios usan 14. Durante un
despliegue conviven dos revisiones del mismo servicio, y ms-identity aparecía caído con el error `EMAXCONNSESSION`.
**Corrección:** ms-identity libera su conexión si está inactivo 30 segundos y reintenta una vez antes de marcarse caído.
**Regla operativa:** no desplegar durante la defensa.

**Gobernanza de APIs.** Es el conjunto de reglas sobre qué APIs existen, quién es su dueño y cómo cambian. En Descubre EC:

1. Cada ruta publicada tiene un servicio dueño y un contrato.
2. Las rutas `/internal/` nunca se publican: el gateway las bloquea con una expresión regular y responde 404 «no es parte
   del contrato de este nodo».
3. Hay un catálogo de rutas de microservicios con la versión actual.

| Hallazgo | Estado |
|---|---|
| S8-09 Llave ajena | Corregido |
| S8-10 Sin rate limit | Pendiente |
| S8-11 Conexiones | Mitigado |

**Cómo se implementaría el rate limiting.** En el gateway se contaría cuántas peticiones hace cada llave por minuto. Al pasar
el límite se respondería 429 con la cabecera `Retry-After`, que le dice al cliente cuántos segundos esperar. El límite de
Booking se acordaría con su equipo para no cortar su tráfico normal.

**Por qué las conexiones son un problema.** Cada servicio mantiene conexiones abiertas a Supabase para responder rápido.
Con 13 servicios y un límite de 15, queda muy poco margen. Durante un despliegue, la revisión vieja y la nueva están vivas a
la vez y suman sus conexiones.

**Relación con otros hallazgos.** El semáforo DEGRADED de ms-identity (S10-09) también venía de la reconexión a la base.

**Relación con la semana 10.** El error de conexiones se encontró gracias al registro del motivo de fallo en el chequeo de
salud (S10-02): sin ese mensaje solo se veía «DOWN». Además, para revisar datos se usaron consultas por la API en lugar de
abrir conexiones nuevas a la base, para no ocupar el poco margen disponible.

**Resultado.** En las revisiones de salud posteriores al cambio, los 13 servicios aparecieron en estado UP.

**Lección.** Los límites protegen tanto de atacantes como de errores honestos de otros sistemas.

---

# SEMANA 9 — Pruebas de integración y contract testing

## Hoja 23 — 9.1 Pruebas unitarias, de integración y E2E (1 de 2)

**Concepto.** La **pirámide de pruebas** dice que debe haber muchas pruebas unitarias (rápidas, prueban una función),
menos de integración (prueban varias piezas reales juntas) y pocas E2E (prueban el sistema completo como un usuario),
porque estas últimas son lentas y frágiles.

**Situación encontrada.** La auditoría V4 marcó que la web no tenía pruebas (V4-CAL-01) y no había una forma única de
correr todas las pruebas del proyecto ni de medir sus resultados.

**Implementación.** Se armó la pirámide completa:

| Nivel | Herramienta | Casos | Ejemplo |
|---|---|:-:|---|
| Unitarias | Jest, node:test | 250 | Regla de 24 h, cédula |
| Integración | Jest + Supertest + PostgreSQL | 242 | Saga con 7 servicios |
| E2E API | Script con fetch | 35 | Reservar y cancelar |
| E2E navegador | Playwright + axe | 65 | 4 celulares |

**Jest en NestJS.** Las pruebas de integración levantan el módulo real de NestJS con una base PostgreSQL de prueba en
Docker (puerto 5434) y le hacen peticiones HTTP con **supertest**. No se simula la base de datos: se prueba igual que en
producción, con las mismas migraciones.

**Snapshot testing.** Guarda una «foto» de una respuesta y avisa si cambia. No se usa. **Hallazgo S9-01 (P3):** en su lugar
las respuestas se comparan contra el contrato con ajv, que es más útil, porque una foto falla con cualquier cambio (incluso
compatible), y el contrato solo falla con los que rompen.

**Ejemplo de prueba unitaria.** La validación de la cédula ecuatoriana se prueba con cédulas válidas e inválidas: diez
dígitos, código de provincia entre 01 y 24 (o 30 para ecuatorianos registrados en el exterior), tercer dígito menor a 6 y dígito verificador calculado con el módulo 10. Es una función pura, sin base de
datos, y su prueba tarda milisegundos.

**Ejemplo de prueba de integración.** La saga de reserva levanta siete servicios reales con sus bases de prueba
(catálogo y ubicación son falsos), hace una reserva y comprueba que los cupos bajaron, que se creó la orden, el pago y la
factura, y que cada respuesta cumple el contrato.

**Ejemplo de prueba E2E.** Playwright abre la web en un iPhone simulado, busca una atracción, reserva y revisa que la página
no tenga problemas de accesibilidad con axe.

**Cómo se corren.** El script `pruebas/ejecutar-pruebas.mjs` las ejecuta todas en orden. La última corrida tardó 374
segundos y las 592 pruebas coincidieron con lo esperado.

**Lección.** Probar con la base real detecta errores de SQL que un mock nunca mostraría.

**Estado:** implementado.

---

## Hoja 24 — 9.1 Pruebas unitarias, de integración y E2E (2 de 2)

**TDD (rojo-verde-refactor).** Se aplicó en la regla de cancelación de 24 horas:

1. **Rojo:** se escribió `politica.spec.ts` con los casos (24 h exactas, 23 h 59 min, con check-in hecho, como
   administrador, como compensación de la saga) y todos fallaron porque la función no existía.
2. **Verde:** se programó `politicaCancelacion` lo mínimo para que pasaran.
3. **Refactor:** se ordenó el código sin cambiar el comportamiento, con las pruebas en verde.

**Hallazgo S9-02 (P2).** Pruebas inestables. Una prueba de la saga pasaba sola pero fallaba con 409 al correr todas, porque
las pruebas nuevas gastaban los cupos del mismo turno. Otra de stock fallaba a veces porque dos turnos se publicaban a la
vez en orden variable. **Corrección:** cada prueba sube el cupo del turno al empezar, y la de stock compara sin depender del
orden.

| Herramienta | Lenguaje | ¿Se usa? |
|---|---|---|
| Jest | JavaScript / TS | Sí |
| node:test | JavaScript | Sí (web) |
| xUnit / JUnit | C# / Java | Solo el formato de reporte JUnit |
| pytest | Python | No |

**Cobertura de código.** Mide qué porcentaje del código ejecutan las pruebas. El backend tiene `npm run test:cov`.
**Hallazgo S9-03 (P3):** no hay un mínimo de cobertura obligatorio en el CI.

**Evidencia.** ms-booking 18 de 18 y ms-inventory 9 de 9 en corridas repetidas.

**Ejemplo del ciclo TDD.** La primera prueba decía: «una reserva para dentro de 23 horas y 59 minutos no se puede cancelar
como turista». La función todavía no existía, así que falló (rojo). Se escribió la comparación de horas y pasó (verde).
Después se agregó la prueba del administrador, que falló porque la regla no lo exceptuaba, y se agregó la excepción.

**Por qué importa la cobertura mínima.** Sin un mínimo, alguien puede agregar código nuevo sin pruebas y el CI no lo nota.
Con un mínimo (por ejemplo, 80 %), el CI fallaría si la cobertura baja.

**Qué haría diferente.** Escribir las pruebas de integración con datos propios de cada prueba desde el principio, para que
nunca dependan de otras.

**Relación con la semana 7.** Las pruebas de integración son también pruebas de contrato: cada respuesta se valida con ajv
contra el `openapi.yaml` del servicio, así que una prueba que pasa confirma tanto la lógica como el formato.

**Resultado.** Las 18 pruebas de ms-booking pasan siempre, en cualquier orden.

**Lección.** Una prueba que falla a veces es peor que no tenerla, porque enseña a ignorar fallas.

**Estado:** S9-02 corregido; S9-03 pendiente.

---

## Hoja 25 — 9.2 Contract testing con Pact y Postman

**Qué no resuelven las pruebas E2E.** Una prueba E2E dice que todo funciona hoy con lo que nosotros probamos, pero no avisa
cuando el otro equipo usa la API de otra forma. Así pasó con Booking: pidió `limit=100` y nuestra API respondió 400.
Ninguna prueba nuestra lo detectó, porque nuestras pruebas pedían como máximo 50.

**Concepto.** En **Pact** (consumer-driven contracts) el consumidor escribe lo que espera de la API, eso se guarda como
contrato y el proveedor lo verifica en su CI. Así el proveedor sabe exactamente qué usa cada consumidor. Postman/Newman es
una alternativa más simple: colecciones de peticiones con verificaciones que se corren desde la línea de comandos.

**Hallazgo S9-04 (P2).** No hay pruebas de contrato dirigidas por el consumidor (Pact).

**Qué se hizo.** Se aplicó **contract testing dirigido por el proveedor**: nuestras pruebas validan cada respuesta contra
el contrato oficial con ajv. Además, en el script E2E se agregaron los casos que Booking usa de verdad, copiados de sus
llamadas reales en los logs:

| Caso real de Booking | Resultado esperado |
|---|---|
| Catálogo con limit=100 | Acepta |
| Cancelar sin Idempotency-Key | Acepta |
| Cancelar con campos de más | Acepta |
| Ruta en inglés /reservations | Responde igual |

**Bidireccional.** El contract testing bidireccional compara el contrato del proveedor con lo que el consumidor dice usar,
sin pruebas compartidas. Es lo más parecido a lo que se hizo con Booking a mano.

**Postman / Newman.** No se usa; el script `ejecutar-pruebas.mjs` cumple ese papel.

**Lo que hizo falta en la práctica.** Como no había un contrato del consumidor, cada problema de Booking se conoció por
mensaje después de que ocurrió: el límite del catálogo, la ruta en inglés, la cancelación sin cabecera y la búsqueda por
cédula. Con Pact, Booking habría publicado esas expectativas y nuestro CI las habría verificado antes de desplegar.

**Cómo se implementaría Pact.**

1. Booking escribe en su código las llamadas que hace y las respuestas que espera.
2. Pact genera un archivo de contrato y lo sube a un broker.
3. Nuestro CI descarga ese contrato y lo verifica contra nuestra API.
4. Antes de desplegar se consulta `can-i-deploy`.

**Limitación.** Requiere que Booking también use Pact, por eso se planificó con su equipo para la versión 3.1.

**Relación con la semana 7.** Pact es una forma de Contract-Driven Development en la que el contrato lo escribe el
consumidor; en este proyecto el contrato lo escribió el proveedor y se acordó por mensaje.

**Estado:** Pact pendiente; casos reales de Booking implementados.

---

## Hoja 26 — 9.3 Provider–consumer testing (1 de 2)

**Concepto.** En una integración, el **proveedor** ofrece la API y el **consumidor** la usa. El flujo completo es: el
consumidor define qué necesita, el proveedor lo implementa y lo verifica, y ambos acuerdan cuándo se puede desplegar.

**Roles en la integración.**

| Operación | Proveedor | Consumidor |
|---|---|---|
| Catálogo, cupos, reservas | Descubre EC | Booking |
| Aviso de check-in | Booking | Descubre EC |
| Stock en vivo | Booking (recibe) | Descubre EC (envía) |

En la mayoría de flujos somos **proveedor**, pero en el aviso de check-in somos **consumidor** de la API de Booking.

**Hallazgo S9-05 (P1).** El aviso de check-in a Booking respondía 404 «Cannot POST», porque Booking aún no había publicado su
ruta. Nuestro sistema no guardaba si el aviso había llegado o no, así que no había forma de saber qué reservas faltaba
avisar.

**Corrección.**

1. Reintento cada 30 segundos durante una hora.
2. Columna `res_aviso_checkin` con tres estados: PENDIENTE, ENVIADO y FALLIDO.
3. El panel muestra «Booking avisado» cuando el aviso llega.
4. Se informó a Booking, que publicó la ruta.

**Evidencia.** Los avisos reales quedan en estado ENVIADO y Booking muestra el check-in en su sistema.

**Cómo se reintenta el aviso.** Cuando un turista hace check-in, el aviso queda PENDIENTE y se intenta enviar de inmediato.
Si Booking responde con error o no responde, se intenta de nuevo cada 30 segundos. Si después de una hora sigue fallando,
queda FALLIDO y el panel lo muestra para que el administrador sepa que Booking no se enteró.

**Por qué no se esperó a Booking.** Si el check-in esperara la respuesta de Booking, un problema en su sistema impediría que
nuestros turistas entraran a la atracción. Por eso el aviso es asíncrono: nuestro check-in se completa siempre y el aviso
se envía después.

**Relación con la semana 10.** El estado del aviso es un dato de observabilidad: permite saber, sin revisar registros,
cuántos avisos están pendientes o fallidos.

**Qué se aprendió.** En una integración, depender de otro sistema para completar una acción propia crea fallos en cascada.
Separar la acción (el check-in) del aviso (a Booking) evita que un problema ajeno afecte a nuestros turistas.

**Lección.** Cuando somos consumidores, debemos tolerar que el proveedor no esté listo y registrar el resultado.

**Estado:** corregido.

---

## Hoja 27 — 9.3 Provider–consumer testing (2 de 2)

**Detección de breaking changes antes del despliegue.** Pact usa un **Pact Broker**, que guarda los contratos de cada
consumidor, y el comando **can-i-deploy**, que responde si una versión puede desplegarse sin romper a nadie. Los
**matchers** permiten decir «aquí va cualquier texto» o «un número» en lugar de un valor exacto, para que el contrato no
sea frágil.

**Sin Pact, el proyecto evita los cambios incompatibles con tres reglas:**

1. Solo se **agregan** campos a las respuestas; nunca se quitan ni se renombran.
2. Lo que llega se lee con tolerancia (lector tolerante), como en `limit` y en la cancelación.
3. Antes de desplegar se corren los 35 casos E2E de la API, que incluyen los casos reales de Booking.

**Hallazgo S9-06 (P2).** La regla nueva de cancelación (versión 3.0.0) era un breaking change para Booking: antes podía
cancelar siempre y ahora, con menos de 24 horas, recibe **409**. Para no romper la saga de Booking se hicieron excepciones:
la compensación de la saga (`SAGA_ORCHESTRATOR`) y el administrador pueden cancelar siempre. El cambio se avisó a Booking
antes de desplegarlo.

| Quién cancela | Menos de 24 h | 24 h o más |
|---|---|---|
| Turista o Booking | 409 | 200 y reembolso |
| Saga de Booking | 200 | 200 |
| Administrador | 200 | 200 |
| Reserva con check-in | 409 | 409 |

**Cómo se comunicó el cambio a Booking.** Antes de desplegar la regla de 24 horas se le explicó a Booking qué respuestas iba
a recibir, con ejemplos: 200 con reembolso cuando faltan 24 horas o más, 409 con un mensaje claro cuando falta menos y 409
cuando ya se hizo check-in.

**Asistentes en el check-in.** También se agregó el campo de personas que llegaron. Si se reservaron 4 cupos y llegaron 3, se
registra 3, y no hay reembolso por la persona que no asistió.

**Qué haría diferente.** Agregar al contrato una sección de reglas de negocio, no solo de campos, para que estas decisiones
queden escritas en el mismo lugar.

**Relación con la semana 11.** Las excepciones de la regla (administrador y saga) se deciden en el servidor según quién hace
la petición: la llave de Booking, el token del turista o el token del administrador. El cliente no puede declarar por sí
mismo que es administrador para saltarse la regla.

**Resultado.** Se enviaron a Booking ejemplos de cada respuesta (200 y 409) para que los muestre a sus clientes.

**Lección.** Un breaking change se negocia con el consumidor antes de desplegarlo, no después.

**Estado:** corregido y acordado con Booking.

---

## Hoja 28 — 9.4 Mocking de servicios (1 de 2)

**Concepto.** Un *test double* reemplaza una pieza real en una prueba. Se usan cuando la pieza real es lenta, cara, de
otro equipo o difícil de poner en un estado determinado (por ejemplo, «Booking caído»).

**Tipos de test doubles usados.**

| Tipo | Qué es | Dónde se usa |
|---|---|---|
| Stub | Devuelve una respuesta fija | db.one con mockResolvedValue (auth-google.spec) |
| Mock | Verifica que se llamó | jest.fn en auth-guards.spec |
| Spy | Observa una función real | jest.spyOn en imagenes-storage.spec |
| Fake | Versión simple que funciona | ms-catalog y ms-location falsos (saga.spec) |
| Fake HTTP | Servidor que imita a otro | Booking falso del aviso de check-in |

**Mocks de llamadas HTTP externas.** Para probar el aviso de check-in sin depender del Booking real, `saga.spec.ts` levanta
un **Booking falso**: un pequeño servidor HTTP que recibe el aviso. Primero responde 503 y después 200, para comprobar que
nuestro sistema reintenta. Ese comportamiento no se puede forzar con el sistema real de otro equipo.

**Mocks internos con Jest.** En el backend se simulan con `jest.fn()` el almacenamiento de imágenes y el inicio de sesión
con Google, que son servicios de terceros y no se pueden llamar en una prueba automática.

**Cómo funciona el Booking falso.** Es un pequeño servidor HTTP que se levanta dentro de la prueba en un puerto libre. En
la prueba del aviso de check-in primero responde 503: el aviso queda PENDIENTE con 1 intento. Después se le cambia a 200 y
se fuerza el reintento: el aviso pasa a ENVIADO con 2 intentos. Un tercer reintento ya no envía nada, porque el aviso está
confirmado. La prueba también revisa que el aviso lleve la X-API-Key y el cuerpo oficial del contrato v3.1.

**Ejemplo de stub.** En `auth-google.spec.ts` la consulta a la base se reemplaza con un `jest.fn()` que devuelve siempre el
mismo usuario, para probar el inicio de sesión sin una base real.

**Ejemplo de spy.** En `imagenes-storage.spec.ts` se usa `jest.spyOn` para observar llamadas a funciones reales sin
cambiar su comportamiento.

**Riesgo de los mocks.** Un doble puede quedar desactualizado si el servicio real cambia; por eso el Booking falso responde
con el mismo formato que define el contrato.

**Qué se aprendió.** Cada tipo de doble tiene un uso: el stub fija datos, el mock verifica llamadas y el fake reemplaza un
sistema completo. Elegir el correcto hace que la prueba sea clara y que, si falla, se sepa por qué.

**Resultado.** Con estos dobles, las pruebas de la saga y del aviso de check-in no dependen de que el sistema de otro
equipo esté encendido, y se pueden correr en cualquier momento.

**Lección.** Se simula lo que no controlamos; lo nuestro se prueba de verdad.

**Estado:** implementado.

---

## Hoja 29 — 9.4 Mocking de servicios (2 de 2)

**Error común: exceso de mocks.** Si se simula todo, la prueba pasa aunque el sistema real falle, porque solo prueba que
el código llama a sus simulaciones. Por eso la regla del proyecto es:

| Se simula | No se simula |
|---|---|
| Booking (otro equipo) | La base de datos |
| Google y almacenamiento | Los servicios de la saga |
| Catálogo y ubicación en la saga | gRPC, REST y SOAP |

La prueba de la saga usa **7 microservicios reales** (booking, pricing, inventory, order, payment, refund e invoicing), cada
uno con su propio esquema en la base de pruebas, y solo ms-catalog y ms-location son falsos, porque solo aportan los datos
de la atracción. Así se prueba de verdad que gRPC, REST y SOAP funcionan juntos.

**Hallazgo S9-07 (P2).** Una prueba lanzada en Azure con el job de migración falló. El job ignoró los argumentos que
empezaban con `-` y ejecutó la migración en vez de la prueba.

**Corrección.**

1. Se comprobó que no se cambiaron datos: 24 atracciones y 15 turistas, igual que antes.
2. La migración no hizo nada porque ya estaba aplicada y el pool estaba lleno.
3. Ese job ya no se usa para pruebas; las pruebas se corren con el script local.

**Ejemplo de exceso de mocks evitado.** Una opción era simular ms-inventory en la prueba de la saga. Pero así no se habría
detectado que dos reservas simultáneas podían tomar el mismo último cupo: ese error solo aparece con la base real y el
bloqueo `SELECT … FOR UPDATE`. Con el servicio real, la prueba de concurrencia lanza 10 retenciones simultáneas de 3 cupos
sobre un turno de 20 y comprueba que solo 6 pasan, sin sobreventa.

**Qué se verificó después del incidente.**

1. Cantidad de atracciones, turistas y reservas, comparada con la de antes.
2. Lista de migraciones aplicadas: no había ninguna nueva.
3. Salud de los 13 servicios: todos UP.

**Qué haría diferente.** Crear un job separado y con nombre claro para cada tarea, en lugar de reutilizar el de migración
con otros argumentos.

**Relación con la semana 10.** Además de contar los datos, se revisó la salud de los 13 servicios, que confirmó que todo
seguía funcionando. El fallo de la migración se explicó por el error de conexiones del pool lleno que quedó en el registro.

**Resultado.** La prueba de concurrencia y la de la saga se ejecutan con servicios y bases reales en cada corrida del
script, y las dos pasan.

**Lección.** Verificar que la prueba hizo lo que se cree que hizo, y no reutilizar una herramienta para algo distinto a su
propósito.

**Estado:** corregido.

---

## Hoja 30 — 9.5 Pruebas automáticas en CI/CD (1 de 2)

**Concepto.** Un workflow de CI ejecuta automáticamente las pruebas en cada cambio. Un **gate de calidad** es una condición
que debe cumplirse para continuar: si falla, el cambio no se integra.

**Estructura del workflow** (`.github/workflows/ci.yml`):

| Job | Qué hace | Gate de calidad |
|---|---|---|
| Backend | lint, tipos, pruebas, build | Falla si algo falla |
| Modelo relacional | migraciones, seed, E2E | Base real PostgreSQL |
| Frontend | lint, pruebas, build | Falla si algo falla |
| Frontend móvil | Playwright, axe, peso | Presupuesto de KB |
| gitleaks | Busca secretos | Bloquea si hay uno |
| CodeQL | Análisis de seguridad | Alertas |
| Dependencias | npm audit y revisión | Falla con high |

**Hallazgo S9-08 (P2).** No había una forma única de correr todas las pruebas y medir si los resultados coinciden con lo
esperado.

**Implementación.** Se creó `pruebas/ejecutar-pruebas.mjs` con esta regla: no modifica el backend ni el frontend, solo
ejecuta las pruebas que ya existen. Corre las cuatro capas (unitarias, integración, E2E de API y E2E en navegador), anota
para cada caso el resultado esperado y el obtenido, y calcula el **coeficiente Kappa de Cohen**. Guarda un reporte `.md` y
`.json` en `pruebas/reportes/` y termina con código 1 si algún caso no coincide, así puede ser un gate de CI. Si algo no
está encendido (la base de prueba o el gateway local), esa parte se marca como omitida y el resto se ejecuta igual.

**Cómo se lee el reporte.** El reporte tiene una tabla por capa con la cantidad de casos, la coincidencia, el Kappa y su
interpretación; la matriz de confusión total; la lista de casos que no coinciden (vacía en la última corrida) y la lista de
casos omitidos con su motivo.

**Opciones del script.**

| Opción | Efecto |
|---|---|
| --solo=unitarias,e2e | Corre solo esas capas |
| --e2e-url | Prueba contra otro gateway |
| --e2e-escritura | En la nube, también crea reservas |
| --sin-navegador | Omite Playwright |

**Seguridad del script.** Contra la nube, por defecto solo hace consultas que no cambian datos; para crear reservas de prueba
hay que pedirlo de forma explícita.

**Relación con la semana 7.** Los casos E2E del script usan el contrato v3: comprueban que cada respuesta tenga el código HTTP
que el contrato indica (200, 201, 400, 401, 404, 409 o 422) según el caso.

**Lección.** Medir con un número (Kappa) permite comparar corridas y demostrar calidad.

**Estado:** implementado.

---

## Hoja 31 — 9.5 Pruebas automáticas en CI/CD (2 de 2)

**Fórmula.** κ = (po − pe) / (1 − pe). *po* es la proporción de casos donde lo obtenido coincide con lo esperado; *pe* es
la coincidencia que se daría por azar. κ = 1 es acuerdo perfecto; κ = 0 es lo mismo que el azar.

| Capa | Casos | Coincidencia | κ |
|---|:-:|:-:|:-:|
| Unitarias | 250 | 100 % | n/a |
| Integración | 242 | 100 % | n/a |
| E2E API | 35 | 100 % | 1,000 |
| E2E navegador | 65 | 100 % | n/a |
| **Total** | **592** | **100 %** | **1,000** |

**Hallazgo S9-09 (P2).** En una corrida la integración salió con κ = 0 («leve») aunque el 97,9 % coincidía. Es la
**paradoja de prevalencia**: si todos los casos se esperan «aprobada», el azar ya explica toda la coincidencia y el Kappa
pierde sentido. **Corrección:** en capas de una sola categoría se informa la coincidencia, y el κ se calcula donde hay
casos que deben aceptarse y otros que deben rechazarse, y en el total. En otra corrida hubo 5 fallas por tiempo en
ms-invoicing con la máquina muy cargada; corridas solas pasaron 5 de 5, así que era el entorno y no el código.

**Pipeline con Pact y mutation testing.** Un pipeline con Pact publicaría el contrato del consumidor y verificaría al
proveedor antes de desplegar. **Mutation testing** cambia el código a propósito (por ejemplo, `>=` por `>`) y comprueba que
alguna prueba falle. Ninguno se implementó (S9-04 y **S9-10, P3**).

**Matriz de confusión total.** Filas: lo esperado. Columnas: lo obtenido.

| Esperado | Obtenido igual | Distinto |
|---|:-:|:-:|
| aprobada | 557 | 0 |
| acepta | 13 | 0 |
| cumple | 6 | 0 |
| rechaza | 16 | 0 |

**Por qué hay casos que deben rechazarse.** Un sistema correcto no solo acepta lo válido: también rechaza lo inválido.
Reservar sin llave, con una cédula falsa o cancelar después del check-in deben dar error. Si el sistema aceptara esos casos,
el Kappa bajaría aunque «todo funcione».

**Interpretación del resultado.** Un Kappa de 1,000 significa que, en todos los casos, el sistema hizo exactamente lo que se
esperaba: aceptó lo que debía aceptar y rechazó lo que debía rechazar. Según la escala de Landis y Koch, un valor mayor a
0,80 es un acuerdo «casi perfecto».

**Resultado.** La última corrida (15 de noviembre) no tuvo ningún caso distinto de lo esperado; solo 7 pruebas del
navegador quedaron omitidas a propósito porque se ejecutan en otros dispositivos.

**Lección.** Una métrica sola puede engañar; hay que entender cuándo aplica.

**Estado:** κ total 1,000 (casi perfecta según Landis y Koch).

---

# SEMANA 10 — Observabilidad y trazas distribuidas

## Hoja 32 — 10.1 Logs, métricas y trazas (1 de 2)

**Concepto.** Los tres pilares de la observabilidad son: **logs** (qué pasó, evento por evento), **métricas** (números en
el tiempo, como latencia o errores por minuto) y **trazas** (el recorrido de una petición por varios servicios).

| Pilar | Implementación en Descubre EC |
|---|---|
| Logs | Una línea JSON por petición: método, ruta, estado, ms |
| Métricas | Panel de Observabilidad: p50, p95, p99, errores |
| Trazas | X-Correlation-Id en todas las llamadas |

**Situación encontrada.** Cada servicio escribía sus logs en la consola de su contenedor. Cuando Azure creaba una réplica
nueva (por un despliegue o por escala), los logs anteriores dejaban de verse en la consola.

**Hallazgo S10-01 (P1).** No se podía investigar un error de hace horas. Pasó al buscar por qué no llegaba una cancelación
de Booking: los logs del gateway estaban vacíos porque la réplica era nueva.

**Corrección.** Se usó **Azure Log Analytics** (tabla `ContainerAppConsoleLogs_CL`), que guarda los logs de todas las
réplicas de todos los servicios en un solo lugar y permite consultarlos. Con una consulta se encontró
`POST /reservas/DEC-R9ES2A/cancel → 400` y se corrigió la causa (S7-08).

**Monitoreo vs. observabilidad.** El monitoreo responde preguntas conocidas: ¿el servicio está arriba? (el semáforo de
salud). La observabilidad permite responder preguntas nuevas: ¿por qué esta cancelación falló? Para eso se necesitan los
tres pilares juntos.

**Ejemplo de una línea de log.** Cada petición genera una línea con este tipo de datos: fecha y hora, servicio, método
(POST), ruta (`/api/v3/reservas`), estado (201), tiempo en milisegundos (81) y el correlation_id. Al ser JSON, Log
Analytics puede filtrar por cualquiera de esos campos, por ejemplo «todas las respuestas 400 de ms-booking de hoy».

**Ejemplo de consulta usada.** Se filtró la tabla de registros por el nombre del contenedor del gateway, por el texto
«cancel» y por las últimas 24 horas, ordenando por fecha. Así apareció la petición de Booking con su estado 400.

**Qué haría diferente.** Configurar Log Analytics desde el primer despliegue y no después del primer incidente.

**Relación con la semana 11.** Los logs no guardan contraseñas, tokens ni llaves: solo el método, la ruta, el estado y el
tiempo. Así los registros sirven para auditar sin exponer secretos.

**Lección.** Los logs deben vivir fuera del contenedor, porque el contenedor puede desaparecer.

**Estado:** corregido.

---

## Hoja 33 — 10.1 Logs, métricas y trazas (2 de 2)

**Costo de no tener observabilidad.** Antes de usar Log Analytics, un problema reportado por Booking costaba horas de
prueba y error: reproducir, adivinar, cambiar y volver a desplegar. Con la consulta correcta se encontró la causa en
minutos. En una empresa, ese tiempo es dinero perdido y clientes molestos.

**Hallazgo S10-02 (P2).** Un servicio aparecía DOWN en el semáforo de salud, pero el log no decía por qué: el chequeo de
salud no registraba el error.

**Corrección.** El chequeo ahora escribe el motivo del fallo en el log (por ejemplo, el error de conexión a la base) y
reintenta una vez antes de marcar el servicio como caído. Así se distingue un tropiezo de un segundo de una caída real.

**Sampling.** Guardar el 100 % de las trazas en un sistema grande es caro. El *sampling* decide cuáles guardar:

| Tipo | Cuándo decide | Ventaja | Desventaja |
|---|---|---|---|
| Head-based | Al inicio | Simple y barato | Puede perder errores |
| Tail-based | Al final | Guarda errores y lentas | Más complejo |

**Hallazgo S10-03 (P3).** No hay sampling: se guarda el 100 % de las líneas. Con el volumen actual (pruebas, defensa y
Booking) no es un problema, pero con tráfico real aumentaría el costo de Log Analytics.

| Hallazgo | Estado |
|---|---|
| S10-01 Logs perdidos | Corregido |
| S10-02 Error sin motivo | Corregido |
| S10-03 Sin sampling | Pendiente (P3) |

**Ejemplo de motivo registrado.** Antes, el semáforo solo decía «ms-identity: DOWN». Ahora el registro incluye el motivo, por
ejemplo que la base rechazó la conexión porque el pool estaba lleno. Con ese dato se llegó directamente al problema de
conexiones (S8-11) sin tener que adivinar.

**Cuánto se guarda hoy.** Cada petición genera una línea de log. Con el tráfico actual son pocos miles de líneas por día, que
entran en la capa gratuita de Log Analytics.

**Cómo se haría el sampling.** Se guardarían siempre las peticiones con error o más lentas que el SLO, y solo una parte de
las peticiones normales. Esto es sampling tail-based y conserva lo importante para investigar.

**Qué se aprendió.** Un chequeo de salud que solo dice «arriba» o «abajo» sirve para alertar, pero no para corregir. Agregar
el motivo convirtió el semáforo en una herramienta de diagnóstico.

**Resultado.** Desde el cambio, cada vez que el semáforo marca un servicio caído el registro dice por qué.

**Lección.** Un error sin motivo registrado obliga a adivinar.

---

## Hoja 34 — 10.2 OpenTelemetry

**Concepto.** OpenTelemetry es el estándar abierto para generar trazas, métricas y logs. Un **trace** es el recorrido de
una petición; está formado por **spans**, cada uno una operación con inicio, fin y atributos. El contexto (trace_id y
span_id) se **propaga** entre servicios en la cabecera W3C `traceparent`. En NestJS se configura en un archivo
`tracing.ts` que se carga antes que la aplicación.

**Situación encontrada.** El proyecto **no usa OpenTelemetry**. No hay un archivo `tracing.ts` ni un recolector.

**Hallazgo S10-04 (P2).** Sin trazas estándar con spans.

**Qué se hizo en su lugar.** Se implementó a mano la **propagación de contexto**, que es la base de OpenTelemetry:

| Parte de OpenTelemetry | Equivalente en Descubre EC |
|---|---|
| trace_id | X-Correlation-Id (uno por pedido) |
| Propagación | Cabecera REST, metadata gRPC, columna del outbox |
| Contexto en proceso | AsyncLocalStorage en comun/correlacion.ts |
| W3C traceparent | Expuesto por el monolito |

El identificador viaja en las tres formas de comunicación: cabecera HTTP en REST, metadata en gRPC y columna
`evt_correlacion` en cada evento del outbox. Así, una reserva de Booking se puede seguir por los 7 servicios de la saga.

**Tipos de span (SpanKind).** SERVER cuando un servicio recibe una petición; CLIENT cuando llama a otro; PRODUCER y CONSUMER
en eventos; INTERNAL para trabajo interno. En nuestro caso equivalen a la línea de log de entrada y a la llamada de salida.

**Convenciones semánticas.** Son nombres estándar de atributos (`http.method`, `http.status_code`); nuestros logs usan
nombres propios en español.

**Ejemplo de propagación.** Booking crea una reserva. El gateway genera un correlation_id si no viene uno y lo envía a
ms-booking en la cabecera. ms-booking lo guarda en AsyncLocalStorage y lo agrega a la metadata de cada llamada gRPC a
pricing, inventory y order, y a la cabecera de cada llamada REST a payment e invoicing. Cuando se registra un evento en el
outbox, también se guarda. Todas las líneas de log de esa reserva llevan el mismo identificador.

**Qué faltaría para ser OpenTelemetry completo.** Medir la duración de cada paso como un span, enviar los spans a un
recolector y verlos como una línea de tiempo. Con eso se sabría cuántos milisegundos de los 81 de una reserva tomó cada
servicio.

**Plan.** Agregar `tracing.ts` con la instrumentación automática de HTTP y gRPC para NestJS.

**Resultado.** Hoy se puede seguir cualquier reserva de punta a punta buscando un solo identificador.

**Estado:** pendiente (P2), con propagación propia funcionando.

---

## Hoja 35 — 10.3 Jaeger, ELK y Grafana

**Concepto.** Cada herramienta cubre un pilar: **Jaeger** muestra trazas como una línea de tiempo de spans; **ELK**
(Elasticsearch, Logstash y Kibana) guarda y busca logs; **Prometheus** guarda métricas y **Grafana** las dibuja en
tableros. Se combinan usando el trace_id: desde un error en Grafana se salta a la traza en Jaeger y a los logs en Kibana.

**Situación encontrada.** No se usan Jaeger, ELK, Grafana ni Prometheus.

**Hallazgo S10-05 (P3).** Sin herramientas de visualización de mercado.

**Qué cumple cada función hoy.**

| Herramienta | Función | Reemplazo actual |
|---|---|---|
| Jaeger | Ver trazas | Buscar el correlation_id en Log Analytics |
| ELK | Buscar en logs | Azure Log Analytics |
| Prometheus | Guardar métricas | Tabla de métricas del monolito |
| Grafana | Dibujar métricas | Panel de Observabilidad |

**Autoalojado vs. SaaS.** Jaeger y ELK autoalojados necesitan servidores, almacenamiento y mantenimiento (actualizaciones,
respaldos, espacio en disco). Log Analytics es **SaaS**: viene incluido con Azure, no hay que instalarlo y se paga por lo
que se guarda. Para un proyecto académico con presupuesto limitado y un solo desarrollador se eligió SaaS.

| Criterio | Autoalojado | SaaS |
|---|---|---|
| Costo inicial | Servidores | Ninguno |
| Mantenimiento | Propio | Del proveedor |
| Control de datos | Total | Del proveedor |

**Ejemplo de cómo se combinarían.** Una alerta en Grafana avisa que el p95 de ms-booking pasó de 1 segundo. Desde el panel
se abre una traza lenta en Jaeger y se ve que el paso lento es la llamada a ms-invoicing. Con el trace_id se buscan en
Kibana los logs de ms-invoicing de esa petición y se encuentra el error.

**Qué se puede hacer hoy con Log Analytics.** El mismo recorrido se hace a mano: se busca la petición lenta en el log del
gateway, se copia su correlation_id y se buscan las líneas de los otros servicios con ese identificador.

**Qué haría diferente.** Con más presupuesto, usaría Grafana Cloud o Azure Monitor con Application Insights, que ofrecen las
tres vistas sin instalar servidores.

**Relación con la semana 8.** El semáforo de Booking es un ejemplo de monitoreo entre sistemas: Booking consulta
`/api/v3/health` y muestra en su semáforo si nuestro nodo está UP, DEGRADED o DOWN, sin tener que revisar
los 13 servicios uno por uno.

**Lección.** Lo importante no es la herramienta sino poder unir logs, métricas y trazas con un mismo identificador.

**Estado:** justificado.

---

## Hoja 36 — 10.4 KPIs: latencia, throughput, SLO y SLI (1 de 2)

**Concepto.** Un **SLI** es un indicador medido (por ejemplo, el p95 de latencia). Un **SLO** es el objetivo para ese
indicador (p95 menor a 1 segundo). La **latencia** es cuánto tarda una respuesta y el **throughput** cuántas peticiones se
atienden por unidad de tiempo. El p95 significa que el 95 % de las respuestas tardó menos que ese valor.

**Implementación.** El monolito tiene un **Panel de Observabilidad** (`observabilidad.service.ts`) que calcula:

| Indicador (SLI) | Qué mide |
|---|---|
| p50, p95, p99 | Latencia en ms |
| Peticiones por minuto | Throughput |
| Tasa de errores | Respuestas 5xx |
| Rutas más lentas | Las 8 con peor p95 |
| Web Vitals | Velocidad vista por el usuario |

**Objetivos (SLO).** Disponibilidad **99,5 %** y p95 **menor a 1000 ms**.

**Error budget.** Con 99,5 % de disponibilidad se permite 0,5 % de errores; eso es el presupuesto de errores. El panel
muestra cuánto queda (`error_budget_remaining`): 1 es intacto, 0 es agotado y menos de 0 es SLO incumplido. Si el
presupuesto se agota, la regla es dejar de agregar funciones y dedicarse a la estabilidad.

**Mediciones reales de la integración.**

| Operación | Tiempo |
|---|---|
| Reservar (saga de 7 servicios) | 81 ms |
| Catálogo (96 KB) | 0,9 s |
| Límite que exige Booking | 4 s |

**Cómo se calcula el p95.** Las latencias de cada petición se agrupan en rangos (cubetas). Para el p95 se busca el rango
donde se acumula el 95 % de las peticiones. Así no hace falta guardar cada tiempo individual, solo cuántas peticiones cayeron
en cada rango.

**Por qué p95 y no el promedio.** El promedio esconde a los usuarios que esperan mucho. Si 95 respuestas tardan 50 ms y 5
tardan 5 segundos, el promedio es 297 ms y parece bueno, pero 5 de cada 100 usuarios tuvieron una mala experiencia. El p95
lo muestra.

**Rutas más lentas.** El panel lista las 8 rutas con peor p95 que tengan al menos 3 peticiones, para no confundirse con una
sola petición lenta.

**Relación con la integración.** Booking exige que una reserva responda en menos de 4 segundos. Es un SLO del consumidor: si
se supera, Booking cancela su propio proceso. Nuestra reserva tarda 81 ms, muy por debajo del límite, y el script de
pruebas lo verifica en el caso «La reserva responde antes de los 4 s de Booking».

**Lección.** Un SLO convierte «el sistema va bien» en un número que se puede comprobar.

**Estado:** implementado en el monolito.

---

## Hoja 37 — 10.4 KPIs: latencia, throughput, SLO y SLI (2 de 2)

**Hallazgo S10-06 (P2).** Los SLO y el error budget solo se miden en el monolito. Los 12 microservicios registran el tiempo
de cada petición en sus logs, pero no hay un panel que calcule p95 ni presupuesto de errores para ellos.

**Hallazgo S10-07 (P3).** No hay alertas por *burn rate* ni índice **Apdex**.

**Burn rate.** Mide qué tan rápido se gasta el error budget. Un burn rate de 1 gasta el presupuesto justo en el mes; uno de
14 lo gasta en dos días. Las alertas por burn rate avisan cuando el gasto es muy rápido, en lugar de avisar por cada error
suelto, lo que reduce las falsas alarmas.

**Apdex.** Índice de 0 a 1 que mide la satisfacción del usuario:
Apdex = (satisfechos + tolerantes / 2) / total. Con un umbral T de 500 ms, son satisfechas las respuestas menores a T,
tolerables las menores a 4T y frustrantes las demás. Una reserva de 81 ms es «satisfecha».

| SLO de la industria | Objetivo |
|---|---|
| Servicios críticos de nube | 99,9 % o más |
| Descubre EC (monolito) | 99,5 % |
| Booking (tiempo de reserva) | Menos de 4 s |

**Plan.**

1. Llevar el cálculo del panel a los microservicios con una consulta a Log Analytics.
2. Agregar una alerta cuando el burn rate supere 14 en una hora.
3. Mostrar el Apdex junto al p95.

**Ejemplo de error budget.** Con un SLO de 99,5 % y 100 000 peticiones en un mes, se permiten 500 errores. Si en la primera
semana ya hubo 400, quedó el 20 % del presupuesto y conviene congelar los cambios riesgosos hasta fin de mes.

**Ejemplo de burn rate.** Si en una hora se gastó el 2 % del presupuesto mensual, el ritmo es unas 14 veces mayor de lo
normal: a esa velocidad el presupuesto se acabaría en dos días. Esa es la condición típica para despertar a alguien de
guardia.

**Por qué no hay alertas hoy.** El proyecto no tiene personas de guardia; durante la integración se revisó el semáforo y los
registros a mano.

**Qué se aprendió.** Tener SLO sin alertas obliga a revisar el panel a mano. Para un sistema en producción con usuarios
reales, las alertas por burn rate serían el siguiente paso, porque avisan antes de que el presupuesto de errores se agote.

**Prioridad.** Este pendiente es P2 porque no afecta a Booking hoy, pero sin estas mediciones no se sabría a tiempo si los
microservicios empiezan a responder lento o con errores frecuentes.

**Lección.** Medir solo una parte del sistema da una imagen incompleta de su salud.

**Estado:** pendiente.

---

## Hoja 38 — 10.5 Correlación y debugging distribuido (1 de 2)

**Concepto.** En un sistema distribuido, un error puede nacer en un servicio y mostrarse en otro. El **trace_id** (en
nuestro caso el `correlation_id`) es el hilo conductor que une todas las líneas de log de una misma petición, sin importar
en qué servicio se escribieron.

**Reconstrucción de un incidente real** (12 de noviembre): Booking canceló una reserva y en nuestra web seguía activa.

| Paso | Qué se hizo | Resultado |
|:-:|---|---|
| 1 | Buscar reservas canceladas en 3 h | Ninguna |
| 2 | Revisar logs del gateway | Vacíos (réplica nueva) |
| 3 | Buscar «cancel» en Log Analytics | 400 en DEC-R9ES2A |
| 4 | Seguir el correlation_id | Rechazo en ms-booking |
| 5 | Reproducir en local | 3 causas posibles de 400 |
| 6 | Corregir y probar | Pasa la validación |

**Análisis.** Con el mismo `correlation_id` se vio que el gateway recibió y pasó la petición, y que el rechazo venía de la
validación de ms-booking, no de la red ni del gateway. Al reproducir en local con un código inexistente se encontraron las
tres causas posibles del 400 (cabecera obligatoria, campos de más y formato del cuerpo). Después de corregir, la misma
prueba respondió 404 «no existe», que demuestra que ya pasaba la validación.

**Sin el identificador** habría que revisar los logs de los 13 servicios uno por uno y por hora aproximada.

**Las tres causas posibles que se encontraron.**

1. Falta la cabecera `Idempotency-Key` → 400.
2. El cuerpo trae campos que no están en el DTO → 400.
3. El formato del cuerpo no es válido → 400.

Booking enviaba la petición sin cabecera y con campos de más, así que fallaba por las dos primeras; la tercera no
aplicaba a su caso.

**Cómo se confirmó la corrección en producción.** Después de desplegar se pidió a Booking que cancelara una reserva de prueba.
En el registro apareció la misma ruta con estado 200, y la reserva cambió a CANCELADA en el panel con el reembolso
registrado y los cupos devueltos.

**Relación con la semana 7.** El origen del incidente fue una diferencia de contrato: Booking enviaba campos que nuestro DTO
no esperaba. La observabilidad permitió encontrarlo, pero la corrección real fue aplicar el principio del lector tolerante.

**Resultado.** Las cancelaciones de Booking ahora se aplican en nuestra base y se reflejan en el panel y en «Mis
reservas»; el caso E2E «Cancelar como Booking» lo comprueba en cada corrida.

**Lección.** Cada petición debe llevar un identificador desde que entra hasta que sale.

**Estado:** corregido (ver S7-08).

---

## Hoja 39 — 10.5 Correlación y debugging distribuido (2 de 2)

**Fallos en cascada en la Saga de Pedidos.** La saga de una reserva recorre 7 servicios en orden: catalog → pricing →
inventory → order → payment → booking → invoicing. Si uno no responde y los demás lo esperan sin límite, todos se quedan
bloqueados y el sistema cae en cadena.

**Cómo se evita.**

| Medida | Implementación |
|---|---|
| Tiempo máximo | 3 s por llamada (HTTP y gRPC) |
| Error claro | 503 DEPENDENCY_UNAVAILABLE |
| Compensación | Liberar cupos, cancelar orden, reembolsar |
| Orden | Se compensa al revés |
| Registro | Cada compensación fallida va al log |

Si falla el pago, la saga libera los cupos reservados y cancela la orden, en orden inverso. Cada compensación que falla
queda en el log con su `correlation_id` para revisarla.

**Encontrar el cuello de botella.** **Hallazgo S10-08 (P2):** las listas grandes tardaban o se colgaban; la medición mostró
que el problema era el proxy del gateway y no la base de datos ni el BFF (ver S8-02).

**Hallazgo S10-09 (P2):** ms-identity salía «DEGRADED» en el semáforo y arrastraba al nodo completo a DEGRADED. La causa
fue que reabrir su conexión a la base tarda 0,5 s y el umbral de lentitud era 200 ms. **Corrección:** umbral de 1500 ms para
ms-identity. **Evidencia:** 6 revisiones seguidas con 13 servicios UP.

**Ejemplo de compensación.** Si el pago falla después de reservar los cupos y crear la orden, la saga hace en orden inverso:
primero cancela la orden y después libera los cupos. Así el turno vuelve a tener los mismos cupos que antes del intento y
nadie queda con una orden sin pagar.

**Qué pasa si falla la compensación.** Se registra en el log con el paso que falló y el correlation_id. Las reservas que
quedan a medias se pueden revisar y corregir a mano, y la reserva nunca se confirma al turista.

**Relación con la idempotencia.** Las compensaciones también son idempotentes: liberar dos veces los mismos cupos con la
misma referencia solo los libera una vez.

**Relación con la semana 9.** La prueba de la saga verifica las compensaciones: simula un fallo en un paso y comprueba que
los cupos vuelven al turno y que la orden queda cancelada. Así se sabe que la compensación funciona antes de necesitarla en
producción.

**Resultado.** El caso E2E «Cupos devueltos» comprueba que, al cancelar, los cupos vuelven al turno.

**Lección.** Un umbral mal calibrado genera falsas alarmas que hacen ignorar las verdaderas.

**Estado:** corregidos.

---

# SEMANA 11 — Seguridad en integraciones

## Hoja 40 — 11.1 OAuth2, JWT, mTLS y scopes (1 de 2)

**Anatomía del JWT del proyecto.** Un JWT tiene tres partes en Base64 separadas por puntos:

1. **Cabecera:** el algoritmo (`alg: HS256`) y el tipo.
2. **Datos (claims):** usuario, roles, `scope` y vencimiento (`exp`).
3. **Firma:** HMAC-SHA256 de las dos partes anteriores con el secreto.

**Hallazgo S11-01 (P1, auditoría V1 SEG-003).** El `JWT_SECRET` tenía un valor por defecto en el código: cualquiera que lo
leyera podía crear tokens de administrador válidos. **Corrección:** sin secreto la API no arranca.

**Hallazgo S11-02 (P1).** La web no podía usar los microservicios porque el monolito (Vercel) y Azure tenían secretos
distintos y rechazaban el token del otro. **Corrección:** el mismo secreto en los dos lados, cargado como variable de
entorno y nunca en el código.

**Validación implementada** (`comun/auth.ts`):

1. Se rechaza todo token cuyo `alg` no sea HS256; esto evita el ataque de cambiar el algoritmo a `none` o a RSA.
2. La firma se compara en tiempo constante (`timingSafeEqual`).
3. Se revisa el vencimiento.

| HMAC (HS256) | RSA (RS256) |
|---|---|
| Un secreto compartido | Llave privada y pública |
| El mismo firma y verifica | Solo el emisor firma |
| Más simple | Más seguro con muchos servicios |
| Usado en Descubre EC | Recomendado a futuro |

**Cómo se comprobó la validación del algoritmo.** Las pruebas de `auth.ts` crean tokens con `alg: none`, con otro algoritmo,
con la firma alterada y vencidos, y comprueban que todos se rechazan. Solo el token firmado correctamente con HS256 y
vigente se acepta.

**Riesgo de compartir el secreto.** Hoy el mismo `JWT_SECRET` está en Vercel y en los servicios de Azure que validan tokens.
Si cualquiera de esos lugares se filtrara, se podrían crear tokens. Con RS256 solo el emisor tendría la llave privada y los
demás solo podrían verificar.

**Qué haría diferente.** Pasar a RS256 cuando el inicio de sesión se mueva a ms-identity, publicando la llave pública para
que los servicios la descarguen.

**Relación con la semana 8.** El gateway no valida tokens: los deja pasar al servicio, y cada servicio los valida por su
cuenta. Es el principio de autenticación sin perímetro.

**Lección.** Con HMAC, todo servicio que verifica también podría firmar; por eso el secreto debe protegerse en todos.

**Estado:** corregidos.

---

## Hoja 41 — 11.1 OAuth2, JWT, mTLS y scopes (2 de 2)

**Scopes.** Un scope limita qué puede hacer un token. El token incluye *scopes* OAuth2 declarados en el contrato
(`scopes.ts`), pensados para migrar a un servidor de autorización real sin cambiar los controladores:

| Scope | Permite |
|---|---|
| attractions:read | Ver catálogo |
| attractions:book | Reservar |
| attractions:cancel | Cancelar |
| attractions:manage | Gestionar reservas (operador) |
| admin:full | Administración |

**OAuth2 y sus flujos.** *Authorization code* (usuario en navegador), *client credentials* (sistema a sistema), *refresh
token* (renovar sesión) y *device code* (televisores). Se usó *authorization code* con Google para iniciar sesión
(auditoría V3, SEG-016).

**Hallazgo S11-03 (P2).** El botón de Google no funcionaba en producción y su sesión no tenía DPoP (V4-SEG-01).
**Corrección:** se quitó el inicio con Google del login y del registro; menos funciones expuestas, menos superficie de
ataque. Para Booking, que es un sistema, lo correcto sería *client credentials*; hoy se usa API Key.

**mTLS.** En mTLS ambos lados presentan certificado. No se usa (**S11-04, P3**). Entre servicios se usa `X-Servicio-Token`,
un secreto de al menos 16 caracteres comparado en tiempo constante, también en la metadata gRPC.

**Autenticación sin perímetro.** Cada microservicio valida el token por su cuenta y no confía en que la petición venga del
gateway.

**Cómo se usan los scopes.** Cuando un turista inicia sesión recibe `attractions:read`, `attractions:book` y
`attractions:cancel`. Un operador recibe además `attractions:manage` y `attractions:write`. Un administrador recibe todos,
incluido `admin:full`. Cada ruta indica
qué scope necesita, y el guard rechaza con 403 el token que no lo tiene.

**DPoP.** El token de la web está ligado a una llave que el navegador genera y nunca envía. En cada petición el navegador
firma una prueba con esa llave. Si alguien roba el token, no puede usarlo desde otro equipo porque no tiene la llave.

**Qué haría diferente.** Para Booking usaría el flujo *client credentials* con tokens que vencen, en lugar de una API Key
fija, para poder revocar el acceso sin cambiar la llave.

**Relación con OWASP.** Quitar funciones que no se usan reduce la superficie de ataque (API8, mala configuración). Un botón de
Google que no funcionaba era una puerta abierta que nadie vigilaba.

**Resultado.** El login quedó más simple, con correo y contraseña, y la página de registro pide la cédula que necesita
Booking para reconocer al turista.

**Estado:** S11-03 corregido; S11-04 pendiente.

---

## Hoja 42 — 11.2 Autorización RBAC / ABAC (1 de 2)

**Autenticación vs. autorización.** Autenticar es saber **quién es** (el JWT o la API Key). Autorizar es decidir **qué
puede hacer** (según su rol y los datos). Un usuario autenticado no necesariamente está autorizado.

**RBAC vs. ABAC.** En **RBAC** el permiso depende del rol (ADMIN, OPERADOR, CLIENTE). En **ABAC** depende de atributos:
del usuario (su empresa), del recurso (de quién es la reserva) o del contexto (la hora). RBAC es simple; ABAC es más fino.

**RBAC implementado.** Tres roles guardados en la tabla `usuario_rol`. En NestJS se usan **guards** (código que se ejecuta
antes del controlador y decide si continúa) y el **decorador** `@Roles`:

| Ruta | Decorador |
|---|---|
| Reservas del panel | @Roles('ADMIN', 'OPERADOR') |
| Editar atracciones | @Roles('ADMIN', 'OPERADOR') |
| Operaciones de administración | @Roles('ADMIN') |

**Hallazgo S11-05 (P0, auditoría V1 SEG-004).** Un operador veía las reservas de todas las empresas, no solo las suyas.

**Corrección (ABAC).** Además del rol se revisa un **atributo**: la empresa del operador. La consulta filtra por esa empresa
en el servidor, así que aunque el operador cambie la URL no ve datos de otras empresas.

**Evidencia.** Prueba con un operador de otra empresa: 403.

**Cómo se implementa el guard.** El guard lee los roles que exige la ruta (puestos con `@Roles`), los compara con los roles
del token y, si no coincide ninguno, responde 403 antes de ejecutar el controlador. Así el controlador nunca tiene que
preguntar por el rol.

**Por qué el filtro de empresa va en el servidor.** Si la web enviara «empresa = 5» en la petición, un operador podría
cambiarlo por «empresa = 6». Por eso la empresa se toma del usuario autenticado en el servidor y nunca de lo que envía el
navegador.

**Riesgo pendiente detectado.** Un operador todavía podría cambiar precios o cupos de otra empresa si llamara directamente a
ms-pricing o ms-inventory. Está en el plan de la versión 3.1 validar el dueño también en esos servicios.

**Relación con la semana 9.** Las pruebas E2E incluyen «Reservas del panel sin sesión» (debe dar 401) y «Reservas del panel con
sesión de administrador» (debe dar 200). Así se verifica en cada corrida que el guard sigue protegiendo la ruta. Si alguien
quitara el decorador por error, la prueba fallaría.

**Resultado.** Los operadores solo ven en el panel las reservas y atracciones de su propia empresa, aunque cambien la URL a
mano.

**Lección.** El rol dice qué tipo de acción se permite; el atributo dice sobre qué datos.

**Estado:** corregido.

---

## Hoja 43 — 11.2 Autorización RBAC / ABAC (2 de 2)

**Hallazgo S11-06 (P2).** Un turista no veía en «Mis reservas» lo que compró por Booking. El riesgo al corregirlo era
mostrar reservas ajenas, el riesgo número uno de OWASP para APIs: **API1, Broken Object Level Authorization**.

**Corrección.** El **servidor** reconoce a la persona por el correo del JWT y por la cédula registrada en ms-identity; el
navegador no envía ni decide de quién son las reservas. Además, el turista no puede cancelar en la web lo comprado en
Booking, porque Booking no se enteraría y quedarían descuadrados.

| Prueba | Resultado |
|---|---|
| El dueño ve sus reservas | 3 reservas |
| Otra persona | 0 reservas |
| Otra pide una reserva ajena | 403 |

**Principio de menor privilegio.** Cada usuario debe tener solo los permisos que necesita y durante el tiempo que los
necesita.

**Hallazgo S11-07 (P2).** Para la auditoría de Booking se pidió la cuenta personal de administrador. Compartirla impide saber
quién hizo qué y no se puede quitar el acceso a uno sin afectar al otro. También se propuso la contraseña `admin123`, que se
adivina en segundos.

**Corrección.** Se creó una cuenta temporal solo para el auditor, con contraseña larga y única, que se desactiva después de
la defensa.

**Cómo se reconoce a la persona.** Cuando el turista abre «Mis reservas», el BFF toma su correo del token y le pide a
ms-identity su cédula. Con esos dos datos ms-booking busca las reservas hechas en la web y las hechas por Booking con el
mismo correo o la misma cédula. El navegador nunca envía la cédula para esta búsqueda.

**Qué se le muestra al turista.** Las reservas de Booking aparecen con una etiqueta que indica su origen. Si intenta
cancelarla desde la web, recibe un mensaje que le indica cancelar desde Booking, que es donde la compró.

**Cuenta del auditor.** Se creó con rol de administrador, una contraseña larga generada al azar y un nombre que la identifica
como cuenta de auditoría, para que en los registros se distinga de la cuenta del dueño del proyecto.

**Relación con la semana 9.** Este control se probó con tres usuarios distintos: el dueño de las reservas, otra persona sin
reservas y otra persona que pidió directamente una reserva ajena por su código. Solo el dueño vio sus datos.

**Resultado.** Los turistas ven en un solo lugar todo lo que reservaron, sin importar si lo hicieron en nuestra web o en
Booking.

**Lección.** Nunca compartir la cuenta propia de administrador.

**Estado:** corregidos.

---

## Hoja 44 — 11.3 WAF y Zero Trust

**Web Application Firewall.** Un WAF se pone delante de la aplicación y filtra ataques conocidos (inyección SQL, XSS,
bots) por patrones. **Hallazgo S11-08 (P3):** el proyecto no tiene WAF.

**WAF vs. validación en el código.** El WAF bloquea ataques genéricos, pero no conoce las reglas del negocio; la
validación en el código sí. Lo ideal es tener ambos. Sin WAF, la protección está en el código:

| Ataque | Protección en el código |
|---|---|
| Inyección SQL | SQL con parámetros ($1, $2) |
| XSS | Helmet con CSP |
| Clickjacking | X-Frame-Options |
| Datos malformados | DTO con class-validator |
| Fuerza bruta | Throttler en el login |
| Abuso de reglas | Regla de 24 h y cupos con bloqueo |

**Del modelo perimetral a Zero Trust.** El modelo perimetral confía en todo lo que está «adentro» de la red, como un
castillo con muralla. Si un atacante entra, puede moverse libremente. **Zero Trust** no confía en nadie por estar adentro:
cada petición se verifica.

| Principio Zero Trust | En Descubre EC |
|---|---|
| Verificar siempre | Cada servicio valida token o llave |
| Menor privilegio | Roles, scopes y empresa |
| Asumir brecha | Rutas /internal nunca publicadas |
| Microsegmentación | Una base por microservicio |

**Ejemplo de por qué el WAF no basta.** Un WAF no sabe que una reserva no se puede cancelar con menos de 24 horas ni que un
operador no debe ver reservas de otra empresa. Esas reglas solo las conoce el código. Al revés, el código no ve patrones de
ataque de miles de clientes a la vez, y un WAF sí.

**Opción en Azure.** Azure Front Door o Application Gateway ofrecen WAF con las reglas de OWASP. Se pondría delante del
gateway y no requeriría cambios en el código.

**Microsegmentación.** Cada microservicio tiene su propio esquema de base de datos y no puede leer el de otro. Si un servicio
fuera comprometido, el atacante no tendría acceso directo a los datos de los demás.

**Qué se aprendió.** La seguridad funciona por capas: si una falla, la siguiente detiene el ataque. Hoy las capas son el
HTTPS de Azure, el gateway que oculta las rutas internas, la validación en cada servicio y los permisos en la base de datos.

**Resultado.** Ninguna ruta interna es accesible desde internet: el caso E2E «Ruta interna publicada por error» lo comprueba
en cada corrida.

**Lección.** El WAF es una capa más, no reemplaza validar en el código.

**Estado:** WAF pendiente (P3); Zero Trust aplicado.

---

## Hoja 45 — 11.4 Cifrado TLS y prácticas criptográficas (1 de 2)

**TLS y cadena de confianza.** TLS cifra la comunicación entre cliente y servidor. El servidor presenta un certificado
firmado por una autoridad certificadora (CA), y el navegador confía en él porque confía en la CA: eso es la **cadena de
confianza**. Un **certificado autofirmado** no tiene CA que lo respalde y el navegador lo rechaza; sirve solo para pruebas.

**En Descubre EC.** Todo el tráfico externo va por HTTPS: Azure Container Apps y Vercel entregan certificados firmados por
una CA reconocida y los renuevan solos. No se usan certificados autofirmados en producción.

**Cifrado vs. hashing.** Cifrar es reversible con la llave correcta; un hash es de un solo sentido y no se puede revertir.
Las contraseñas nunca se cifran: se guardan como hash con sal.

| Uso | Técnica | ¿Reversible? |
|---|---|---|
| Contraseñas | bcrypt (10 rondas) | No |
| Huella de migraciones | SHA-256 | No |
| Enlaces de calendario | HMAC-SHA256 | No (firma) |
| Firma del JWT | HMAC-SHA256 | No (firma) |
| Tráfico | TLS | Sí, con la llave |

**Enlaces firmados.** El archivo `.ics` para añadir una reserva al calendario se sirve con `?t=<vencimiento>.<firma>`. Sin
firma, o vencida, responde 404 sin revelar que la reserva existe (`ms-booking/src/enlaces.ts`). Las fotos privadas usan el
mismo método con 2 horas de validez.

**Cómo funciona bcrypt.** bcrypt genera una sal aleatoria para cada contraseña y aplica la función muchas veces (10 rondas
equivalen a 1024 repeticiones). Dos usuarios con la misma contraseña tienen hashes distintos y probar millones de
contraseñas se vuelve muy lento para un atacante.

**Por qué el enlace del calendario responde 404 y no 403.** Si respondiera 403, el atacante sabría que la reserva existe
aunque no pueda verla. Con 404 no puede distinguir una reserva real de una inventada.

**Qué haría diferente.** Subir bcrypt a 12 rondas cuando el servidor lo permita, porque las computadoras son cada año más
rápidas y 10 rondas protegen menos que antes.

**Relación con la semana 7.** Los enlaces firmados no necesitan guardarse en la base: la firma y el vencimiento viajan en el
propio enlace, y el servidor solo recalcula la firma para comprobarla. Es el mismo principio que el JWT, que también se
verifica sin consultar la base.

**Resultado.** Ninguna contraseña se guarda en texto plano y los enlaces del calendario no se pueden adivinar ni reutilizar
después de vencidos.

**Lección.** bcrypt es lento a propósito, para que adivinar contraseñas sea caro.

**Estado:** implementado.

---

## Hoja 46 — 11.4 Cifrado TLS y prácticas criptográficas (2 de 2)

**Hallazgo S11-09 (P0, auditoría V1 SEG-001 y SEG-002).** La contraseña de la base de datos estaba en un archivo `.env`
subido al repositorio y un token de Vercel estaba expuesto. Cualquiera con acceso al repositorio podía leer y borrar los
datos o tomar el hosting.

**Corrección.**

1. Los secretos se movieron a las variables de entorno de Vercel y de Azure.
2. El token de Vercel se rotó (se anuló y se creó uno nuevo).
3. El CI corre **gitleaks** en cada cambio para detectar un secreto antes de que llegue al repositorio.
4. Los archivos `.env` nunca se suben (están en `.gitignore`).

**Buenas prácticas aplicadas.**

| Práctica | Aplicación |
|---|---|
| No escribir secretos en el código | Variables de entorno |
| Comparar en tiempo constante | timingSafeEqual |
| Una llave por consumidor | Llave propia del nodo |
| Rotar si se expone | Token de Vercel rotado |
| Largo mínimo | Token entre servicios ≥ 16 |
| Algoritmos actuales | SHA-256 y bcrypt, no MD5 |

**Rotación de claves.** Rotar es cambiar una clave cada cierto tiempo aunque no se haya filtrado, para limitar el daño de
una filtración que nadie notó.

**Hallazgo S11-10 (P3).** No hay una rotación periódica programada del `JWT_SECRET` ni de la llave de Booking; solo se rotan
si se exponen. Plan: rotar cada semestre aceptando dos claves durante el cambio.

**Qué hace gitleaks.** Revisa cada cambio buscando patrones de secretos: contraseñas en cadenas de conexión, tokens de
servicios conocidos y llaves privadas. Si encuentra uno, el CI falla y el cambio no se integra.

**Cómo se haría la rotación sin cortar el servicio.**

1. Se genera el secreto nuevo.
2. Los servicios aceptan el viejo y el nuevo durante un tiempo.
3. Los emisores empiezan a usar el nuevo.
4. Cuando ya no quedan tokens con el viejo, se retira.

Con la llave de Booking sería igual, coordinando la fecha con su equipo.

**Relación con otros hallazgos.** La llave ajena (S8-09) y la cuenta compartida (S11-07) son el mismo problema de fondo:
credenciales usadas por quien no corresponde.

**Lección.** Un secreto que llega al repositorio se considera filtrado aunque se borre después.

**Estado:** S11-09 corregido; S11-10 pendiente.

---

## Hoja 47 — 11.5 Seguridad en colas, mensajería y auditoría

**Concepto.** En un sistema con broker (RabbitMQ o Kafka) hay que proteger el broker con TLS y credenciales, y controlar
qué servicio puede publicar o leer en cada cola o tópico.

**Situación encontrada.** El proyecto **no tiene un broker**. Los eventos viajan con el patrón outbox, por REST, a la ruta
interna `/api/v1/internal/eventos` de cada servicio interesado.

**Cómo se protege la mensajería sin broker.**

| Control | Implementación |
|---|---|
| Canal cifrado | Red interna de Azure + HTTPS hacia afuera |
| Credenciales | X-Servicio-Token en cada evento |
| Acceso a las «colas» | Rutas /internal bloqueadas en el gateway |
| Entrega confiable | Outbox con 20 reintentos |
| Orden | Se envían en orden de creación |
| Auditoría | Cada evento guarda su correlation_id |

**Auditoría de eventos.** Cada evento queda en la tabla `evento` con su tipo, sus datos en JSON, la fecha y
`evt_correlacion`. Con eso se puede reconstruir qué pasó con una reserva aunque haya pasado por varios servicios, y quién
lo provocó. Los logs son JSON estructurado, así que se pueden filtrar por cualquier campo.

**Hallazgo S11-11 (P2, externo).** El check-in del lado de Booking respondía 200 con una llave incorrecta y con un código de
reserva inexistente. Cualquiera podría marcar asistencias falsas. No es código nuestro: se reportó al equipo de Booking con
la prueba que lo demuestra.

**Cómo se probó la falla de Booking.** Se envió a la ruta de check-in de Booking una petición con una llave inventada y un
código de reserva que no existe. La respuesta fue 200, cuando debería haber sido 401 por la llave y 404 por la reserva. Se le
envió a Booking la petición exacta y la respuesta recibida para que lo pudiera reproducir.

**Por qué no lo corregimos nosotros.** No tenemos acceso a su código y cambiar algo de otro equipo sin su acuerdo rompería la
confianza de la integración. Lo correcto es reportarlo con evidencia.

**Mientras tanto.** Nuestro sistema no depende de esa respuesta para nada crítico: el check-in se registra primero en
nuestra base y el aviso a Booking es solo informativo.

**Qué se aprendió.** La seguridad de una integración depende de los dos lados. Aunque nuestro sistema valide todo, una falla
en el sistema del socio afecta a los mismos turistas.

**Resultado.** Gracias al outbox, un evento que no se pudo enviar se queda guardado y se reintenta hasta 20 veces, en lugar
de perderse.

**Lección.** Reportar una falla de otro equipo también es parte de la seguridad de la integración.

**Estado:** implementado; S11-11 depende de Booking.

---

## Hoja 48 — 11.6 OWASP API Security Top 10 aplicado

**Concepto.** OWASP publica la lista de los 10 riesgos más comunes en APIs. Se revisó cada uno contra Descubre EC:

| Riesgo OWASP API | Situación en Descubre EC | Estado |
|---|---|---|
| API1 Acceso a objetos ajenos | Servidor decide el dueño (S11-06) | Corregido |
| API2 Autenticación rota | JWT con alg fijo, DPoP, API Key | Corregido |
| API3 Propiedades expuestas | Solo se leen campos del DTO | Corregido |
| API4 Consumo sin límite | Throttler en monolito; gateway sin límite | Pendiente |
| API5 Funciones sin permiso | @Roles en rutas de gestión | Corregido |
| API6 Flujos de negocio | Regla de 24 h y cupos con bloqueo | Corregido |
| API7 SSRF | No se llaman URLs del usuario | No aplica |
| API8 Mala configuración | Helmet, CORS, sin /internal | Corregido |
| API9 Inventario de APIs | Contratos y catálogo de rutas | Corregido |
| API10 Consumo inseguro | Respuestas de Booking validadas | Corregido |

**Detalle de los más importantes.** En **API1** el servidor nunca confía en un identificador que manda el navegador. En
**API6** la sobreventa se evita con `SELECT … FOR UPDATE`: dos compras al mismo tiempo no pueden tomar el mismo último cupo.
En **API10** las respuestas de Booking se tratan como datos externos: si no tienen el formato esperado, se registran y no
se usan.

**Conclusión del tema.** De los 10 riesgos, 8 están cubiertos, 1 no aplica y 1 (API4, rate limiting en el gateway) queda
pendiente con prioridad P2. La auditoría V1 encontró 6 críticos de seguridad; hoy no hay ninguno abierto.

**Riesgo que queda abierto (API4).** Sin límite de peticiones en el gateway, un cliente podría enviar miles de peticiones
por minuto. El monolito sí tiene límite (Throttler), pero los microservicios no. Es el único riesgo del Top 10 que queda
pendiente y por eso es el primero del plan de la versión 3.1.

**API3 en detalle.** Las respuestas solo incluyen los campos del contrato. Por ejemplo, la respuesta de un turista nunca
incluye su contraseña ni datos internos como el identificador de la base, solo su identificador público (`DEC-USR-…`).

**API9 en detalle.** Existe un catálogo de rutas de microservicios con la versión actual, que dice qué servicio atiende cada
ruta. Con él se puede saber qué APIs están publicadas y cuáles son internas.

**Qué se aprendió.** Revisar el Top 10 de OWASP como lista de control permitió encontrar riesgos que no se habían visto en el
día a día, como la falta de límite de peticiones en el gateway, que no había causado ningún problema todavía.

**Resultado.** La revisión del Top 10 quedó como lista de control para cada versión nueva del sistema.

---

## Hoja 49 — Pendientes y plan

| ID | P | Pendiente | Plan |
|---|:-:|---|---|
| S8-10 | 2 | Rate limit en el gateway | Límite por API Key |
| S10-04 | 2 | OpenTelemetry | tracing.ts en cada servicio |
| S10-06 | 2 | SLO de microservicios | Consulta en Log Analytics |
| S9-04 | 2 | Pact | Contrato del consumidor Booking |
| S11-11 | 2 | Check-in de Booking | Lo corrige Booking |
| S7-09 | 2 | Contratos de ms en CI | Agregar el script al CI |
| S8-03 | 3 | Caché en el gateway | 30 s en la ficha |
| S11-04 | 3 | mTLS | Certificados del entorno |
| S11-10 | 3 | Rotación de llaves | Cada semestre |

| Otros abiertos P3 | Tema |
|---|---|
| S7-05, S7-06 | Avro y Schema Registry |
| S9-01, S9-03, S9-10 | Snapshot, cobertura mínima, mutation |
| S10-03, S10-07 | Sampling, burn rate y Apdex |
| S8-11, S11-08 | Conexiones (mitigado) y WAF |

**Por qué no se hicieron antes.** La prioridad fue que la integración con Booking funcionara para la defensa del 11 de
noviembre: primero se corrigió todo lo que rompía un flujo con Booking (P0 y P1). Ningún pendiente es crítico ni rompe un
flujo calificado.

**Orden propuesto para la versión 3.1.** Primero el rate limiting del gateway (protege a todos los servicios), después
OpenTelemetry y los SLO de microservicios (mejoran el diagnóstico) y al final Pact (requiere coordinarse con Booking).

**Riesgo aceptado.** El límite de 15 conexiones de Supabase (S8-11) está mitigado, no resuelto; la solución definitiva es
un plan de pago o reducir un servicio con conexión fija.

**Cómo se decidió el orden del plan.** Se ordenó por riesgo y por esfuerzo. El rate limiting es lo que más protege y se puede
hacer solo en el gateway. OpenTelemetry y los SLO de microservicios mejoran el diagnóstico y se pueden hacer sin coordinar con
nadie. Pact necesita que Booking participe, así que va al final.

**Tareas de cierre después de la defensa.**

1. Desactivar la cuenta temporal del auditor de Booking.
2. Eliminar la atracción repetida sin reservas.
3. Agregar el script de pruebas con Kappa al CI.

**Compromiso.** Este registro se actualizará con una versión 1.2 cuando se cierren los pendientes de prioridad P2.

**Seguimiento.** Cada pendiente tiene su código, así que en la versión 1.2 de este registro se podrá marcar cuál se cerró y
con qué evidencia.

---

## Hoja 50 — Conclusiones y firma

**Conclusiones.**

1. El mayor aprendizaje del Reto 2 fue que **el contrato manda**: los problemas más graves con Booking (S7-04, S7-08,
   S8-01) vinieron de interpretar distinto el contrato, y se resolvieron siendo tolerantes al recibir y estrictos al
   responder.
2. **Medir antes de corregir:** el corte en 64 KB (S8-02) parecía un problema de red y era del proxy; el stock que parecía
   mal (S8-06) era un nombre repetido.
3. **El correlation_id** permitió seguir una reserva por 7 servicios y reconstruir incidentes en minutos en lugar de horas.
4. **La autorización la decide el servidor**, nunca el navegador (S11-06), y cada consumidor tiene su propia llave
   (S8-09).
5. **Las pruebas con Kappa** demostraron con un número que el sistema hace lo que se espera: 592 casos, κ = 1,000.
6. Las herramientas del temario que no se usan (Kafka, Kong, Istio, Pact, OpenTelemetry) tienen un reemplazo propio
   justificado y quedan en el plan de la versión 3.1.

| Indicador final | Valor |
|---|---|
| Hallazgos de la auditoría | 50 |
| Corregidos | 29 |
| Justificados con reemplazo | 3 |
| Críticos abiertos | 0 |
| Pruebas | 592, 100 % de coincidencia |
| Kappa total | 1,000 |
| Versión entregada | 3.0.0 |

**Lo que haría diferente desde el inicio.**

1. Escribir el contrato con Booking antes de programar cualquier ruta.
2. Configurar los registros centralizados el primer día.
3. Probar con listas grandes y no solo con pocos datos.
4. Verificar siempre que la imagen exista antes de desplegar.

**Reflexión final.** La integración entre dos sistemas de equipos distintos no falla tanto por la tecnología como por los
supuestos que cada equipo hace del otro. Escribir el contrato, medir y registrar todo fue lo que permitió encontrar y
corregir cada problema.

**Agradecimiento.** Al equipo de Booking por reportar cada problema con datos concretos, lo que permitió corregirlos rápido.

**Estado final.** Al 15 de noviembre de 2026, el sistema está en línea con 13 de 13 servicios en estado UP y la
integración con Booking funciona en todos sus flujos: catálogo, cupos, reservas, cancelaciones y check-in.

| Firma del estudiante | Fecha |
|---|---|
| | 15-nov-2026 |
