import 'dotenv/config';
import { DataSource } from 'typeorm';
import { configurarBucket, moverImagenesAStorage } from './imagenes-storage';
import { migrar } from './migrator';

/**
 * Aplica las migraciones SQL pendientes y termina. Se ejecuta en `npm run vercel-build`
 * (solo en el despliegue de producción; los previews la omiten) y con `npm run migration:run`.
 * Cada archivo se aplica en su propia transacción: si el build falla a mitad, no queda a medias. Después lleva las fotos del
 * catálogo a Supabase Storage (ver imagenes-storage.ts).
 */
async function main() {
  // V2-OPS-01: en Vercel el DDL solo corre en el despliegue de PRODUCCIÓN. Los builds de
  // preview (ramas y pull requests) compilan pero nunca tocan el esquema de la base.
  const entorno = process.env.VERCEL_ENV;
  if (entorno && entorno !== 'production') {
    // eslint-disable-next-line no-console -- salida de una herramienta de línea de comandos
    console.log(`Build de ${entorno}: no se aplican migraciones (solo en producción).`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await ds.initialize();
  try {
    const aplicadas = await migrar(ds, (m) => console.warn(m));
    // eslint-disable-next-line no-console -- salida de una herramienta de línea de comandos
    console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'La base ya está al día (sin migraciones pendientes).');
    // eslint-disable-next-line no-console -- salida de una herramienta de línea de comandos
    const log = (m: string) => console.log(m);
    await configurarBucket({ log });
    await moverImagenesAStorage((sql, params) => ds.query(sql, params), { log });
  } finally {
    await ds.destroy();
  }
}

main().catch((e: Error) => {
  console.error('Error al aplicar migraciones:', e.message);
  process.exit(1);
});
