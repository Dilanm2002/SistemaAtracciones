import { Body, Controller, Get, Header, HttpCode, BeforeApplicationShutdown, Module, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SCOPES } from '../../common/auth/scopes';
import { volcarMetricas } from '../../common/observabilidad/metricas-http';
import { AtraccionesModule } from '../atracciones/atracciones.module';
import { StockSyncService } from '../atracciones/stock-sync.service';
import { ResumenQueryDto, TelemetriaDto } from './dto/telemetria.dto';
import { ObservabilidadService } from './observabilidad.service';

/**
 * Observabilidad (docs/OBSERVABILIDAD.md): sondas de salud para el monitor y el futuro
 * orquestador, entrada de telemetría de la web y el resumen del panel de administración.
 */
@ApiTags('Observabilidad')
@Controller('ops')
export class ObservabilidadController {
  constructor(
    private readonly svc: ObservabilidadService,
    private readonly stock: StockSyncService,
  ) {}

  @Get('health/live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Liveness: el proceso responde (no consulta la base)' })
  vivo() {
    return this.svc.vivo();
  }

  @Get('health/ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Readiness: la base responde y no hay migraciones pendientes (503 si no)' })
  @ApiResponse({ status: 503, description: 'No está lista para recibir tráfico' })
  async listo(@Res({ passthrough: true }) res: Response) {
    const { ok, cuerpo } = await this.svc.listo();
    if (!ok) res.status(503);
    return cuerpo;
  }

  @Post('telemetria')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // 30 lotes por minuto e IP
  @ApiOperation({ summary: 'Errores y Web Vitals que envía la web (sin datos personales; se depuran al guardar)' })
  async telemetria(@Body() dto: TelemetriaDto) {
    await this.svc.telemetria(dto.senales);
  }

  @Get('resumen')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Panel de Observabilidad: tráfico, latencias (p50/p95/p99), errores, SLO, incidentes y Web Vitals' })
  resumen(@Query() q: ResumenQueryDto) {
    return this.svc.resumen(q.rango);
  }

  @Post('stock-sync/reintentar')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Reintenta ahora los envíos gRPC de stock a Booking que quedaron pendientes o con error' })
  async reintentarStock() {
    return { sent: await this.stock.reintentarPendientes(100) };
  }
}

@Module({
  imports: [AtraccionesModule],
  controllers: [ObservabilidadController],
  providers: [ObservabilidadService],
})
export class ObservabilidadModule implements BeforeApplicationShutdown {
  /** Al apagar la instancia (antes de cerrar la base) se guardan las métricas que aún estaban en memoria. */
  beforeApplicationShutdown() {
    return volcarMetricas();
  }
}
