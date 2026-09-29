/**
 * Validación de variables de entorno al arrancar (fail-fast).
 * Si algo crítico falta o tiene un valor inseguro, la API no inicia
 * en lugar de funcionar de forma insegura (auditoría SEG-003, OPS-006, OPS-007).
 */
const EJEMPLOS_INSEGUROS = ['cambia-este-secreto', 'changeme', 'secret', 'your-secret'];

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const errores: string[] = [];
  const get = (k: string) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  const prod = get('NODE_ENV') === 'production';

  const jwt = get('JWT_SECRET');
  if (!jwt) errores.push('JWT_SECRET es obligatorio.');
  else if (jwt.length < 32) errores.push('JWT_SECRET debe tener al menos 32 caracteres.');
  else if (EJEMPLOS_INSEGUROS.some((e) => jwt.toLowerCase().includes(e))) errores.push('JWT_SECRET tiene un valor de ejemplo; genera uno aleatorio.');

  const db = get('DATABASE_URL');
  if (!db) errores.push('DATABASE_URL es obligatorio.');
  else if (prod && /@(localhost|127\.0\.0\.1)[:/]/.test(db)) errores.push('DATABASE_URL apunta a localhost en producción.');

  const sbUrl = get('SUPABASE_URL');
  const sbKey = get('SUPABASE_SERVICE_ROLE_KEY');
  if (!!sbUrl !== !!sbKey) errores.push('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben definirse juntas.');
  // La clave de servidor debe ser la secreta (sb_secret_… o JWT service_role), nunca la pública (anon / sb_publishable_…)
  if (sbKey && (sbKey.startsWith('sb_publishable_') || /"role"\s*:\s*"anon"/.test(decodeJwtPayload(sbKey)))) {
    errores.push('SUPABASE_SERVICE_ROLE_KEY contiene la clave pública (anon); usa la clave secreta.');
  }

  if (prod && get('DB_SYNC') === 'true') errores.push('DB_SYNC=true no está permitido en producción: usa migraciones.');

  if (errores.length) {
    throw new Error(`Configuración inválida:\n - ${errores.join('\n - ')}`);
  }
  return env;
}

function decodeJwtPayload(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  try {
    return Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return '';
  }
}
