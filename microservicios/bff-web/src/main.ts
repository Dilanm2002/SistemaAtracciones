import 'reflect-metadata';
import 'dotenv/config';
import { Logger, Module, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { correlacion } from './comun/correlacion';
import { ProblemasFilter } from './comun/problemas';
import { AtraccionesWebController, CatalogoWeb, ConSesion, SaludWebController, TuristasWebController } from './web';

@Module({
  controllers: [AtraccionesWebController, TuristasWebController, SaludWebController],
  providers: [CatalogoWeb, ConSesion],
})
export class AppModule {}

/** BFF de la web y el panel: habla el formato de la tienda y lo traduce a los microservicios. No tiene base propia. */
export async function crearApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(correlacion('bff-web'));
  app.useGlobalFilters(new ProblemasFilter());
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  void crearApp().then(async (app) => {
    const puerto = Number(process.env.PORT ?? 4013);
    await app.listen(puerto, process.env.HOST ?? '0.0.0.0');
    new Logger('bff-web').log(`bff-web escuchando en http://0.0.0.0:${puerto}/api/v1`);
  });
}
