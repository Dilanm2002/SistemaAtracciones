import { Module } from '@nestjs/common';
import { CatalogoClient, PricingClient } from './clientes';
import { DbService } from './comun/db.service';
import { CONFIG_OUTBOX, DespachadorEventos } from './comun/outbox';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { DisponibilidadBookingController, InventarioController, InventarioGrpc, InventarioService } from './inventario';
import { StockBooking } from './stock-booking';

@Module({
  controllers: [DisponibilidadBookingController, InventarioController, SaludController],
  providers: [
    DbService,
    CatalogoClient,
    PricingClient,
    StockBooking,
    InventarioService,
    InventarioGrpc,
    DespachadorEventos,
    // STOCK_ACTUALIZADO al feed de eventos de Booking (lo sirve ms_booking)
    { provide: CONFIG_OUTBOX, useValue: { source: '/api/v1/ms-inventory', destinosVar: 'EVENTOS_DESTINOS', destinosPorDefecto: 'http://localhost:4008/api/v1/internal/eventos' } },
    { provide: NOMBRE_SERVICIO, useValue: 'ms-inventory' },
  ],
})
export class AppModule {}
