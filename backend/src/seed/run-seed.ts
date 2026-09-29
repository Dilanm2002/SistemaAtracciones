import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeedService } from './seed.service';

/**
 * Carga los datos de demostración en la base de DATABASE_URL (solo si no hay atracciones).
 * Uso: npm run seed   (se usa una vez para poblar una base nueva, p. ej. la de Supabase).
 */
async function main() {
  process.env.SEED_ON_START = 'false'; // el seed lo ejecuta este script, no el arranque
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const cargo = await app.get(SeedService).sembrar();
    // eslint-disable-next-line no-console -- salida de una herramienta de línea de comandos
    console.log(cargo ? 'Datos de demostración cargados.' : 'La base ya tenía atracciones: no se cargó nada.');
  } finally {
    await app.close();
  }
}

main().catch((e: Error) => {
  console.error('Error al cargar los datos de demostración:', e.message);
  process.exit(1);
});
