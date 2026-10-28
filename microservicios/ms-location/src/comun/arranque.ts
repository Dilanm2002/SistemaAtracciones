import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { correlacion } from './correlacion';
import { DbService } from './db.service';
import { aplicarMigraciones } from './migrador';
import { fabricaDeErroresDeValidacion, ProblemasFilter } from './problemas';

/**
 * Crea la app del microservicio con la misma configuración que la tienda: prefijo /api, versión en la
 * URI (/api/v1 por defecto), validación estricta, errores RFC 7807 y X-Correlation-Id.
 * Aplica las migraciones de su base antes de atender.
 */
export async function crearApp(modulo: unknown, servicio: string): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(modulo as never, {
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors();
  app.use(correlacion(servicio));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: fabricaDeErroresDeValidacion }));
  app.useGlobalFilters(new ProblemasFilter());
  app.enableShutdownHooks();
  const nuevas = await aplicarMigraciones(app.get(DbService).pool);
  if (nuevas.length) new Logger(servicio).log(`Migraciones aplicadas: ${nuevas.join(', ')}`);
  return app;
}

/** Escucha en 0.0.0.0 para aceptar conexiones de otras máquinas (gateway, Booking por Tailscale). */
export async function escuchar(app: INestApplication, puertoPorDefecto: number, servicio: string) {
  const puerto = Number(process.env.PORT ?? puertoPorDefecto);
  await app.listen(puerto, process.env.HOST ?? '0.0.0.0');
  new Logger(servicio).log(`${servicio} escuchando en http://0.0.0.0:${puerto}/api/v1`);
}
