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
import { JsonLogger, registroPeticiones } from './common/logging/json-logger';
import { confianzaProxy } from './config/proxy';
import { API_VERSION } from './config/version';

export { API_VERSION };

/**
 * Crea y configura la aplicación. Lo usan tanto `main.ts` (servidor local)
 * como `api/index.js` (función serverless de Vercel).
 */
export async function createApp(): Promise<NestExpressApplication> {
  // abortOnError=false: si falla el arranque se lanza la excepción en vez de hacer process.exit(1)
  // En producción los logs son JSON de una línea con request_id (OPS-005)
  const prod = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: false,
    bodyParser: true,
    ...(prod ? { logger: new JsonLogger() } : {}),
  });

  // IP real para el límite de peticiones y los logs (SEG-021). Solo se confía en X-Forwarded-For
  // detrás de un proxy que la reescribe (Vercel, o el que indique TRUST_PROXY); expuesta
  // directamente, la API usa la IP de la conexión y esa cabecera no sirve para evadir el límite.
  const proxy = confianzaProxy(process.env.TRUST_PROXY, !!process.env.VERCEL);
  if (proxy !== false) app.set('trust proxy', proxy);
  app.disable('x-powered-by');

  // X-Request-Id por petición: se devuelve en la cabecera y en los errores (OPS-005).
  // Va antes del body-parser para que también los errores de cuerpo (413, JSON inválido) lleven request_id
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const entrante = req.header('x-request-id');
    req.id = entrante && /^[\w-]{8,64}$/.test(entrante) ? entrante : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  if (prod || process.env.LOG_REQUESTS === 'true') app.use(registroPeticiones);

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
          scriptSrc: ["'self'"],
          // Redoc usa un web worker creado desde un blob
          workerSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
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
    allowedHeaders: ['Content-Type', 'Authorization', 'DPoP', 'Idempotency-Key', 'X-Request-Id'],
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

  // Documentación (SEG-019): en producción solo si se habilita explícitamente con ENABLE_DOCS=true
  // (lo está, porque el proyecto es API-First y la rúbrica pide Swagger/Redoc públicos).
  if (process.env.ENABLE_DOCS === 'true' || process.env.NODE_ENV !== 'production') {
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
    // Los recursos de Swagger UI (/api/docs/*.js|css) los sirve Nest en local; en Vercel, una
    // reescritura los toma de /vendor/swagger-ui (copiado de node_modules en postinstall). Sin CDN.
    SwaggerModule.setup('api/docs', app, document);

    // Redoc del CONTRATO oficial (API-First): contracts/atracciones-openapi.yaml.
    // Swagger (/api/docs) muestra la implementación; Redoc, el contrato que se acordó.
    app.getHttpAdapter().get('/api/redoc', (_req: Request, res: Response) => {
      res.type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrato OpenAPI · Atracciones · Descubre EC</title><link rel="icon" href="data:,"></head>
<body><redoc spec-url="/api/v1/contracts/atracciones-openapi.yaml" hide-download-button="false"></redoc>
<script src="/vendor/redoc-2.1.5/redoc.standalone.js"></script></body></html>`);
    });
  }

  return app;
}
