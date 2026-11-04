import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { DbService } from './db.service';

export const NOMBRE_SERVICIO = 'NOMBRE_SERVICIO';

/** Salud del servicio para el gateway y el semáforo: UP (< 200 ms), DEGRADED, DOWN (503 sin base). */
@Controller({ path: 'health', version: '1' })
export class SaludController {
  private readonly inicio = Date.now();

  constructor(
    private readonly db: DbService,
    @Inject(NOMBRE_SERVICIO) private readonly servicio: string,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async salud(@Res({ passthrough: true }) res: Response) {
    const t = Date.now();
    let conectada = true;
    try {
      await this.db.query('SELECT 1');
    } catch {
      conectada = false;
    }
    const latencia = Date.now() - t;
    const status = !conectada ? 'DOWN' : latencia < 200 ? 'UP' : 'DEGRADED';
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
