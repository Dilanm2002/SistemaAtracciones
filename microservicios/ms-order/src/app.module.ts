import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { OrdenesController, OrdenesService, OrdenGrpc } from './ordenes';

@Module({
  controllers: [OrdenesController, SaludController],
  providers: [DbService, OrdenesService, OrdenGrpc, { provide: NOMBRE_SERVICIO, useValue: 'ms-order' }],
})
export class AppModule {}
