import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';

const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';
export const API_VERSION = '2.0.0';

/**
 * Crea y configura la aplicación. Lo usan tanto `main.ts` (servidor local)
 * como `api/index.js` (función serverless de Vercel).
 */
export async function createApp(): Promise<NestExpressApplication> {
  // abortOnError=false: si falla el arranque se lanza la excepción en vez de hacer process.exit(1)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false, bodyParser: true });

  // Detrás del proxy de Vercel: req.ip real para el límite de peticiones y los logs (SEG-021)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // X-Request-Id por petición: se devuelve en la cabecera y en los errores (OPS-005).
  // Va antes del body-parser para que también los errores de cuerpo (413, JSON inválido) lleven request_id
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const entrante = req.header('x-request-id');
    req.id = entrante && /^[\w-]{8,64}$/.test(entrante) ? entrante : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // Cuerpos pequeños: ningún payload legítimo de la API supera 100 kB (SEG-022)
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });

  // Cabeceras de seguridad (SEG-006). CSP estricta: la API solo sirve JSON, imágenes y Swagger.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://*.supabase.co', 'https://validator.swagger.io', 'https://cdn.redoc.ly'],
          scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          // Redoc usa un web worker creado desde un blob
          workerSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // el frontend (otro dominio) muestra las imágenes
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.setGlobalPrefix('api/v1');

  const origins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^\s/]+$/.test(o));
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['Location', 'X-API-Deprecation-Date', 'X-Total-Count', 'X-Request-Id', 'Retry-After'],
    maxAge: 86400,
  });

  // Imágenes del catálogo (/img) y subidas locales (/uploads). En Vercel las sirve su CDN.
  app.useStaticAssets(join(process.cwd(), 'public'), {
    maxAge: '7d',
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Errores en formato RFC 7807 (application/problem+json)
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Swagger: activo por defecto (proyecto API-First); se apaga con ENABLE_DOCS=false (SEG-019)
  if (process.env.ENABLE_DOCS !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Descubre EC - API de Atracciones')
      .setDescription(
        'Microservicio de Atracciones Turísticas de Ecuador (Booking Prototipo). ' +
          'Cumple contracts/atracciones-openapi.yaml: UUIDs, Idempotency-Key en operaciones transaccionales, ' +
          'errores RFC 7807, HATEOAS y scopes OAuth2 (attractions:read/book/cancel/write/manage, admin:full).',
      )
      .setVersion(API_VERSION)
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    // Los recursos de Swagger UI se cargan desde CDN (versión fijada) para que funcione también en serverless
    SwaggerModule.setup('api/docs', app, document, {
      customCssUrl: `${SWAGGER_CDN}/swagger-ui.css`,
      customJs: [`${SWAGGER_CDN}/swagger-ui-bundle.js`, `${SWAGGER_CDN}/swagger-ui-standalone-preset.js`],
    });

    // Redoc del CONTRATO oficial (API-First): contracts/atracciones-openapi.yaml.
    // Swagger (/api/docs) muestra la implementación; Redoc, el contrato que se acordó.
    app.getHttpAdapter().get('/api/redoc', (_req: Request, res: Response) => {
      res.type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrato OpenAPI · Atracciones · Descubre EC</title><link rel="icon" href="data:,"></head>
<body><redoc spec-url="/api/v1/contracts/atracciones-openapi.yaml" hide-download-button="false"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`);
    });
  }

  return app;
}
