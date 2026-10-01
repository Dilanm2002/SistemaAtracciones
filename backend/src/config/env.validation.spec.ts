import { validateEnv } from './env.validation';

const base = { JWT_SECRET: 'a'.repeat(48), DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' };

describe('validateEnv (SEG-003, OPS-006, OPS-007)', () => {
  it('acepta una configuración correcta', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('rechaza JWT_SECRET ausente, corto o de ejemplo', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET es obligatorio/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'corto' })).toThrow(/al menos 32/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'cambia-este-secreto-en-produccion-xxxxxxxx' })).toThrow(/valor de ejemplo/);
  });

  it('rechaza una base en localhost en producción y DB_SYNC=true en producción', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost:5432/x' })).toThrow(/localhost/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', DB_SYNC: 'true' })).toThrow(/DB_SYNC/);
  });

  it('en producción exige SEED_ON_START=false de forma explícita (V2-SEG-01)', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => validateEnv(prod)).toThrow(/SEED_ON_START/);
    expect(() => validateEnv({ ...prod, SEED_ON_START: 'true' })).toThrow(/SEED_ON_START/);
    expect(() => validateEnv({ ...prod, SEED_ON_START: 'false' })).not.toThrow();
    expect(() => validateEnv({ ...base })).not.toThrow(); // en desarrollo no se exige
  });

  it('exige SUPABASE_URL y la clave secreta juntas, y rechaza la clave pública', () => {
    expect(() => validateEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/deben definirse juntas/);
    expect(() => validateEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_abc' })).toThrow(/clave pública/);
    expect(() => validateEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc' })).not.toThrow();
  });
});
