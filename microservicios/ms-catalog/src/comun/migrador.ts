import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { schemaPropio } from './db.service';

/**
 * Aplica en orden los archivos `sql/NNN_*.sql` que aún no se aplicaron (SQL-first, como la tienda).
 * Cada archivo corre en su transacción y queda registrado en `migracion` con su huella: si alguien
 * edita una migración ya aplicada, el servicio no arranca (hay que crear una nueva).
 */
export async function aplicarMigraciones(pool: Pool, dir = join(__dirname, '..', '..', 'sql')): Promise<string[]> {
  const archivos = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const aplicadas: string[] = [];
  const c = await pool.connect();
  try {
    const schema = schemaPropio();
    if (schema) await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`CREATE TABLE IF NOT EXISTS migracion (
      mig_nombre     VARCHAR(120) PRIMARY KEY,
      mig_huella     CHAR(64)     NOT NULL,
      mig_aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const nombre of archivos) {
      const sql = readFileSync(join(dir, nombre), 'utf8');
      const huella = createHash('sha256').update(sql).digest('hex');
      await c.query('BEGIN');
      try {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('migracion'))`);
        const previa = await c.query<{ mig_huella: string }>('SELECT mig_huella FROM migracion WHERE mig_nombre = $1', [nombre]);
        if (previa.rows[0]) {
          if (previa.rows[0].mig_huella !== huella) throw new Error(`La migración ${nombre} cambió después de aplicarse: crea una nueva.`);
        } else {
          await c.query(sql);
          await c.query('INSERT INTO migracion (mig_nombre, mig_huella) VALUES ($1, $2)', [nombre, huella]);
          aplicadas.push(nombre);
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    c.release();
  }
  return aplicadas;
}
