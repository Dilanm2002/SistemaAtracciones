import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { MetodosController, PagosInternosController, PagosService } from './pagos';

@Module({
  controllers: [MetodosController, PagosInternosController, SaludController],
  providers: [DbService, PagosService, { provide: NOMBRE_SERVICIO, useValue: 'ms-payment' }],
})
export class AppModule {}
