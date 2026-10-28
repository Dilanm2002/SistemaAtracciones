import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  // Cierre ordenado: ante SIGTERM termina las peticiones y cierra el pool de Postgres (OPS-004)
  app.enableShutdownHooks();
  // 0.0.0.0: acepta conexiones de otras máquinas (prueba con Booking por Tailscale), no solo de localhost
  await app.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0');
}
bootstrap();
