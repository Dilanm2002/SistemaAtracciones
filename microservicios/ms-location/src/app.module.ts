import { Module } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { UbicacionController, UbicacionService } from './ubicacion';

@Module({
  controllers: [UbicacionController, SaludController],
  providers: [DbService, UbicacionService, { provide: NOMBRE_SERVICIO, useValue: 'ms-location' }],
})
export class AppModule {}
