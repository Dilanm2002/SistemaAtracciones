import 'reflect-metadata';
import 'dotenv/config';
import { AppModule } from './app.module';
import { crearApp, escuchar } from './comun/arranque';

async function bootstrap() {
  const app = await crearApp(AppModule, 'ms-coupon');
  await escuchar(app, 4006, 'ms-coupon');
}
bootstrap();
