import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { CONFIG_OUTBOX, DespachadorEventos } from './comun/outbox';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { PricingGrpc, TarifasController, TarifasService } from './tarifas';

@Module({
  controllers: [TarifasController, SaludController],
  providers: [
    DbService,
    TarifasService,
    PricingGrpc,
    DespachadorEventos,
    { provide: CONFIG_OUTBOX, useValue: { source: '/api/v1/ms-pricing', destinosVar: 'EVENTOS_DESTINOS', destinosPorDefecto: 'http://localhost:4002/api/v1/internal/eventos' } },
    { provide: NOMBRE_SERVICIO, useValue: 'ms-pricing' },
  ],
})
export class AppModule {}
