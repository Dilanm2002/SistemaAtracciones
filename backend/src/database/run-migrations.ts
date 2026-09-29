import 'dotenv/config';
import { DataSource } from 'typeorm';
import { migrar } from './migrator';

/**
 * Aplica las migraciones SQL pendientes y termina. Se ejecuta en `npm run vercel-build`
 * (antes de publicar) y con `npm run migration:run` (local).
 */
async function main() {
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
  } finally {
    await ds.destroy();
  }
}

main().catch((e: Error) => {
  console.error('Error al aplicar migraciones:', e.message);
  process.exit(1);
});
