import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { AcuerdoInternoController, CuponesController, CuponesService, PromocionesBookingController } from './cupones';

@Module({
  controllers: [PromocionesBookingController, CuponesController, AcuerdoInternoController, SaludController],
  providers: [DbService, CuponesService, { provide: NOMBRE_SERVICIO, useValue: 'ms-coupon' }],
})
export class AppModule {}
