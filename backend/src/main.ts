import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  // Cierre ordenado: ante SIGTERM termina las peticiones y cierra el pool de Postgres (OPS-004)
  app.enableShutdownHooks();
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
