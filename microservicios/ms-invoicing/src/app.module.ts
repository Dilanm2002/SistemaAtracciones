import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { FacturacionSoap, FacturasController, FacturasService } from './facturas';

@Module({
  controllers: [FacturasController, SaludController],
  providers: [DbService, FacturasService, FacturacionSoap, { provide: NOMBRE_SERVICIO, useValue: 'ms-invoicing' }],
})
export class AppModule {}
