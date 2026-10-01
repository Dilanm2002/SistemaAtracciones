/**
 * Catálogo de tipos de problema (RFC 7807 / RFC 9457 §3.1.1): el campo `type` de cada
 * `application/problem+json` es una URI del propio proyecto que se puede resolver
 * (GET /api/v1/errores/{tipo}) y devuelve qué significa el error y cómo resolverlo.
 */
export const PROBLEMAS: Record<string, { titulo: string; descripcion: string; status: number }> = {
  validation: { status: 400, titulo: 'Datos de entrada inválidos', descripcion: 'Uno o más campos no cumplen las reglas del contrato. El arreglo `errors` indica cada campo y su motivo.' },
  'invalid-value': { status: 400, titulo: 'Valor con formato inválido', descripcion: 'Un valor (por ejemplo un UUID o una fecha) no tiene el formato esperado.' },
  constraint: { status: 400, titulo: 'Regla de datos incumplida', descripcion: 'El dato no cumple una regla de la base (cédula o teléfono ecuatorianos, correo, RUC, valor fuera de rango).' },
  'in-use': { status: 409, titulo: 'Registro en uso', descripcion: 'No se puede eliminar o cambiar porque otros datos dependen de él.' },
  duplicate: { status: 409, titulo: 'Registro duplicado', descripcion: 'Ya existe un registro con esos datos únicos.' },
  'missing-idempotency-key': { status: 400, titulo: 'Falta la cabecera Idempotency-Key', descripcion: 'Las operaciones transaccionales exigen Idempotency-Key (UUID v4) para evitar cobros duplicados.' },
  'invalid-idempotency-key': { status: 400, titulo: 'Idempotency-Key inválida', descripcion: 'La cabecera Idempotency-Key debe ser un UUID v4.' },
  'idempotency-conflict': { status: 409, titulo: 'Idempotency-Key reutilizada', descripcion: 'La clave ya se usó con una solicitud diferente; genera una clave nueva por operación.' },
  'idempotency-in-progress': { status: 409, titulo: 'Operación en curso', descripcion: 'La misma operación todavía se está procesando; reintenta en unos segundos.' },
  internal: { status: 500, titulo: 'Error interno', descripcion: 'Error inesperado del servidor. El `request_id` permite rastrearlo en los registros.' },
  '400': { status: 400, titulo: 'Solicitud inválida', descripcion: 'La solicitud no es válida.' },
  '401': { status: 401, titulo: 'No autenticado', descripcion: 'Falta el token o expiró; inicia sesión de nuevo.' },
  '403': { status: 403, titulo: 'Sin permiso', descripcion: 'Tu rol no tiene el permiso (scope) que exige la operación.' },
  '404': { status: 404, titulo: 'No encontrado', descripcion: 'El recurso no existe o no es visible para ti.' },
  '409': { status: 409, titulo: 'Conflicto', descripcion: 'El estado actual del recurso no permite la operación.' },
  '413': { status: 413, titulo: 'Solicitud demasiado grande', descripcion: 'El cuerpo supera el tamaño máximo permitido.' },
  '429': { status: 429, titulo: 'Demasiadas solicitudes', descripcion: 'Se superó el límite de solicitudes; espera el tiempo indicado en Retry-After.' },
};

const base = () => `${(process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/errores`;

/** URI resoluble del tipo de problema. Los códigos desconocidos usan el estado HTTP. */
export const tipoError = (slug: string | number) => `${base()}/${String(slug)}`;
