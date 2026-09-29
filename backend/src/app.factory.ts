import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';

const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';

/**
 * Crea y configura la aplicación. Lo usan tanto `main.ts` (servidor local)
 * como `api/index.js` (función serverless de Vercel).
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
    exposedHeaders: ['Location', 'X-API-Deprecation-Date'],
  });

  // Imágenes del catálogo (/img) y subidas locales (/uploads). En Vercel las sirve su CDN.
  app.useStaticAssets(join(process.cwd(), 'public'), { maxAge: '7d' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Errores en formato RFC 7807 (application/problem+json)
  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = new DocumentBuilder()
    .setTitle('Descubre EC - API de Atracciones')
    .setDescription(
      'Microservicio de Atracciones Turísticas de Ecuador (Booking Prototipo). ' +
        'Cumple contracts/atracciones-openapi.yaml: UUIDs, Idempotency-Key en operaciones transaccionales, ' +
        'errores RFC 7807, HATEOAS y scopes OAuth2 (attractions:read/book/cancel/write).',
    )
    .setVersion('1.2.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // Los recursos de Swagger UI se cargan desde CDN para que funcione también en serverless
  SwaggerModule.setup('api/docs', app, document, {
    customCssUrl: `${SWAGGER_CDN}/swagger-ui.css`,
    customJs: [`${SWAGGER_CDN}/swagger-ui-bundle.js`, `${SWAGGER_CDN}/swagger-ui-standalone-preset.js`],
  });

  return app;
}
