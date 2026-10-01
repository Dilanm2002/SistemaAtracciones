import { MediaController } from './media.controller';
import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AtraccionMapper } from './atraccion.mapper';
import { AtraccionesController } from './atracciones.controller';
import { AtraccionesService } from './atracciones.service';
import { AdminAtraccionesController, CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { FavoritosController } from './favoritos.controller';
import { ReportesService } from './reportes.service';
import { ResenasService } from './resenas.service';
import { ReservasService } from './reservas.service';

/**
 * Dominio de Atracciones sobre el modelo relacional de database/01_esquema.sql:
 * catálogo (atraccion, tarifa, horario, disponibilidad…), compras (orden, pago,
 * factura, reserva) y reseñas.
 */
@Module({
  imports: [CommonModule],
  controllers: [AtraccionesController, CatalogoController, AdminAtraccionesController, FavoritosController, MediaController],
  providers: [AtraccionesService, ReservasService, ResenasService, CatalogoService, ReportesService, AtraccionMapper],
  exports: [AtraccionesService, AtraccionMapper],
})
export class AtraccionesModule {}
