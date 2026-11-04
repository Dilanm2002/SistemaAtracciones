import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { ReembolsosController, ReembolsosService } from './reembolsos';

@Module({
  controllers: [ReembolsosController, SaludController],
  providers: [DbService, ReembolsosService, { provide: NOMBRE_SERVICIO, useValue: 'ms-refund' }],
})
export class AppModule {}
