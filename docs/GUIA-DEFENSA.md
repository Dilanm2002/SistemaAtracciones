# Guía para la demostración y la defensa

## Guion de demostración (≈10 minutos)

1. **Está en la nube** — abrir `…/api/v1/atracciones/health`: muestra la API y la base de datos de Supabase (`status: UP`, 44 tablas, migraciones aplicadas, conteos reales).
2. **Marketplace** — https://descubre-ec.vercel.app: buscar por región o categoría, abrir una atracción, elegir fecha en el calendario (cupos reales), reservar con tarjeta de prueba `4111 1111 1111 1111` (cliente@descubre-ec.com / Cliente123), ver la confirmación y "Mis reservas", cancelar.
3. **Administración** — admin@descubre-ec.com / Admin123: crear/editar una atracción (tarifas, horarios, fotos), categorías con subcategorías, destinos, operadores; confirmar un pago pendiente en Reservas; bloquear una fecha en Disponibilidad; ver Reportes y exportar a Excel.
4. **Operador** — operador@descubre-ec.com / Operador123: solo ve las reservas y la disponibilidad de su empresa.
5. **APIs** — Swagger (`/api/docs`, probar un endpoint con el token) y Redoc (`/api/redoc`, el contrato acordado).
6. **Integración** — panel › Eventos y contratos: los eventos que generó la reserva del paso 2 y los contratos OpenAPI / AsyncAPI / GraphQL / gRPC.
7. **Base de datos** — Supabase › Table Editor (esquema `public`) o SQL Editor: `SELECT * FROM ops.migracion;` y `SELECT count(*) FROM reserva;`.

## Dónde está cada cosa

| Pregunta | Archivo |
|---|---|
| ¿Cómo se reserva sin sobreventa? | `backend/src/modules/atracciones/reservas.service.ts` (`reserve`): bloquea la fila de `disponibilidad` con `FOR UPDATE` dentro de una transacción |
| ¿Qué tablas escribe una compra? | `backend/src/modules/atracciones/compras.ts` (`registrarCompra`, `cancelarCompra`, `confirmarCompra`) |
| ¿Cómo evitan el doble cobro por doble clic? | `backend/src/common/idempotency/idempotency.service.ts`: reserva atómica de la `Idempotency-Key` con `INSERT … ON CONFLICT DO NOTHING` |
| ¿Cómo se traduce la base al contrato? | `backend/src/modules/atracciones/modelo.ts` (consulta única con `json_agg`) y `atraccion.mapper.ts` |
| ¿Cómo se aplica el modelo en la nube? | `backend/src/database/migrator.ts` + `sql/001…003`; se ejecuta en `npm run vercel-build` |
| ¿Cómo funcionan los permisos? | `backend/src/common/auth/` (JWT, `sesion`, scopes por rol desde `usuario_rol`) |
| ¿Dónde están los eventos? | `backend/src/common/db/eventos.ts` y `backend/src/modules/integracion/` |
| ¿Cómo se prueba? | `backend/src/**/*.spec.ts` y `.github/workflows/ci.yml` |

## Preguntas probables

- **¿Por qué SQL explícito y no entidades de TypeORM?** El modelo es SQL-first (prefijos, FK compuestas, dominios, triggers). Escribir SQL parametrizado permite leer una atracción completa en una sola consulta (sin N+1) y usar bloqueos y `ON CONFLICT` con precisión. TypeORM se usa para el pool de conexiones y las transacciones.
- **¿Qué pasa si dos personas reservan el último cupo a la vez?** Ambas intentan bloquear la misma fila de `disponibilidad`; la segunda espera a que la primera termine y ya ve el cupo actualizado → recibe 409. Además, un `CHECK` en la base impide reservar más que el total.
- **¿Qué es el outbox?** El evento se guarda en la tabla `evento` en la misma transacción que la reserva: si la reserva falla, no queda evento; si se confirma, el evento existe seguro. Un proceso aparte lo publica después.
- **¿Qué es API-First aquí?** El contrato `atracciones-openapi.yaml` venía de la plantilla y se respetó (UUID, idempotencia, RFC 7807, HATEOAS, scopes); las extensiones son campos opcionales. Redoc muestra el contrato y Swagger la implementación.
- **¿Por qué UUID públicos si las PK son BIGINT?** Las PK numéricas son eficientes para las FK internas; el UUID evita exponer cantidades y permite que otros sistemas generen referencias sin colisiones.
- **¿Cómo se integraría con vuelos?** Por Apollo Federation (entidad `Ciudad` compartida), por eventos (`reserva.creada` con ciudad y fecha) o por REST/gRPC con los contratos publicados en `/api/v1/contracts`.
- **¿Cómo se protege la base en Supabase?** RLS en todas las tablas y sin permisos para los roles públicos; solo la API (con su usuario) accede. Las credenciales viven en las variables de Vercel.
