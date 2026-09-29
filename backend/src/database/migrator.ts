import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

/**
 * Migraciones SQL-first: el esquema lo definen los archivos `sql/NNN_nombre.sql`
 * (el 001 es database/01_esquema.sql). Cada archivo se aplica una sola vez, en
 * orden y dentro de su propia transacción.
 *
 * El registro vive en `ops.migracion`, fuera de `public`, para no mezclar tablas
 * de control con el modelo del negocio (02_verificacion.sql revisa solo `public`).
 * El bloqueo es por transacción (pg_advisory_xact_lock) porque el pooler de
 * Supabase en modo transacción no conserva bloqueos de sesión.
 */
export const SQL_DIR = join(__dirname, 'sql');

export interface Migracion {
  nombre: string;
  sql: string;
  checksum: string;
}

export function leerMigraciones(dir = SQL_DIR): Migracion[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((nombre) => {
      const sql = readFileSync(join(dir, nombre), 'utf8');
      return { nombre, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export async function migrar(ds: DataSource, log: (m: string) => void = () => undefined): Promise<string[]> {
  await ds.query('CREATE SCHEMA IF NOT EXISTS ops');
  await ds.query(
    `CREATE TABLE IF NOT EXISTS ops.migracion (
       mig_id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       mig_nombre      VARCHAR(120) NOT NULL UNIQUE,
       mig_checksum    CHAR(64)     NOT NULL,
       mig_aplicada_en TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
  );

  const aplicadas: string[] = [];
  for (const m of leerMigraciones()) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      await qr.query(`SELECT pg_advisory_xact_lock(hashtext('ops.migracion'))`);
      const previa: { mig_checksum: string }[] = await qr.query('SELECT mig_checksum FROM ops.migracion WHERE mig_nombre = $1', [m.nombre]);
      if (previa.length) {
        if (previa[0].mig_checksum !== m.checksum) {
          log(`AVISO: ${m.nombre} cambió después de aplicarse. Crea una migración nueva en lugar de editarla.`);
        }
        await qr.commitTransaction();
        continue;
      }
      await qr.query(m.sql);
      await qr.query('INSERT INTO ops.migracion (mig_nombre, mig_checksum) VALUES ($1, $2)', [m.nombre, m.checksum]);
      await qr.commitTransaction();
      aplicadas.push(m.nombre);
      log(`Migración aplicada: ${m.nombre}`);
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw new Error(`Falló la migración ${m.nombre}: ${(e as Error).message}`);
    } finally {
      await qr.release();
    }
  }
  return aplicadas;
}
