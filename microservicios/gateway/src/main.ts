import 'reflect-metadata';
import 'dotenv/config';
import { crearGateway } from './app';

async function bootstrap() {
  const app = await crearGateway();
  const puerto = Number(process.env.PORT ?? 8080);
  // 0.0.0.0: Booking entra por Tailscale desde otra máquina
  await app.listen(puerto, process.env.HOST ?? '0.0.0.0');
  console.log(`API Gateway en http://0.0.0.0:${puerto} — URL base para Booking: /api/v3 (o /api/v2)`);
}
bootstrap();
