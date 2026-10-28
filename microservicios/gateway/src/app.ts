import { Controller, Get, Module, Param, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Response } from 'express';
import { preparar, reenviar } from './proxy';
import { duenoDe, esSalud, rutear, sinTienda } from './rutas';
import { saludAgregada } from './salud';

/** Salud agregada en las dos rutas que usa el semáforo de Booking: /atracciones/health y la URL base /health. */
@Controller()
class SaludController {
  @Get(['api/v:version/atracciones/health', 'api/v:version/health'])
  async salud(@Param('version') version: string, @Res() res: Response) {
    const v = version === '3' ? '3' : '2';
    const s = await saludAgregada(v);
    res.status(s.status).setHeader('Cache-Control', 'no-store').json(s.body);
  }

  /** Para revisar en la demo a dónde va cada ruta: /gateway/rutas?metodo=GET&url=/api/v3/atracciones */
  @Get('gateway/rutas')
  rutas(@Res() res: Response) {
    const ejemplos = [
      ['GET', '/api/v3/atracciones'], ['POST', '/api/v3/atracciones/search'], ['GET', '/api/v3/atracciones/categorias/arbol'],
      ['GET', '/api/v3/atracciones/{id}'], ['GET', '/api/v3/atracciones/{id}/disponibilidad'], ['POST', '/api/v3/atracciones/reservas'],
      ['POST', '/api/v3/reservas'], ['GET', '/api/v3/atracciones/eventos'], ['GET', '/ms/location/v1/ciudades'],
    ];
    res.json(ejemplos.map(([m, u]) => {
      const destino = rutear(m, u.replace('{id}', 'quito-city-tour')).destino;
      return { metodo: m, ruta: u, destino: destino === 'tienda' && sinTienda() ? `pendiente: ${duenoDe(u)}` : destino };
    }));
  }
}

@Module({ controllers: [SaludController] })
class GatewayModule {}

/**
 * API Gateway de Descubre EC. Sin body-parser: el cuerpo pasa intacto al servicio de destino.
 * Las rutas de salud las responde el propio gateway; todo lo demás se reenvía (proxy.ts).
 */
export async function crearGateway(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule, {
    bodyParser: false,
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  app.enableCors({ exposedHeaders: ['X-Correlation-Id', 'Location'] });
  app.use(preparar);
  app.use((req: Parameters<typeof reenviar>[0], res: Parameters<typeof reenviar>[1], next: () => void) =>
    esSalud(req.originalUrl) ? next() : reenviar(req, res, next),
  );
  await app.init();
  return app;
}
