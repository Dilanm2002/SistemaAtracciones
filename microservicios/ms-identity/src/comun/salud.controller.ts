import { Controller, Get, Header, Inject, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { DbService } from './db.service';

export const NOMBRE_SERVICIO = 'NOMBRE_SERVICIO';

/** Salud del servicio para el gateway y el semáforo: UP (< 1500 ms), DEGRADED, DOWN (503 sin base). */
@Controller({ path: 'health', version: '1' })
export class SaludController {
  private readonly inicio = Date.now();
  private readonly logger = new Logger('Salud');

  constructor(
    private readonly db: DbService,
    @Inject(NOMBRE_SERVICIO) private readonly servicio: string,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async salud(@Res({ passthrough: true }) res: Response) {
    const t = Date.now();
    // Este servicio suelta su conexión al estar inactivo. Al reabrirla puede fallar una vez (p. ej. si el pooler
    // está lleno mientras Azure cambia de versión otro servicio): se reintenta antes de declararse caído.
    let conectada = false;
    for (let intento = 1; intento <= 2 && !conectada; intento++) {
      try {
        await this.db.query('SELECT 1');
        conectada = true;
      } catch (e) {
        this.logger.warn(`Sin conexión a la base (intento ${intento}): ${(e as Error).message}`);
        if (intento === 1) await new Promise((ok) => setTimeout(ok, 400));
      }
    }
    const latencia = Date.now() - t;
    const status = !conectada ? 'DOWN' : latencia < 1500 ? 'UP' : 'DEGRADED'; // suelta su conexión al estar inactivo: reabrirla tarda ~0,5 s
    if (status === 'DOWN') res.status(503);
    return {
      status,
      service: this.servicio,
      version: process.env.npm_package_version ?? '1.0.0',
      database_connected: conectada,
      latency_ms: latencia,
      uptime_seconds: Math.round((Date.now() - this.inicio) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
