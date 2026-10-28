import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtGuard, Roles, ServicioGuard, Usuario } from './comun/auth';
import { CatalogoService } from './catalogo.service';
import { AtraccionCampos, AtraccionesQuery, CategoriasQuery, CrearAtraccion, EventoEntrante, ListAtraccionesQuery, SearchAtraccionesRequest } from './dto';

/**
 * Rutas del contrato con Booking que son del catálogo (atracciones-openapi-v3.yaml), en /api/v2 y /api/v3.
 * El API Gateway las envía aquí; el resto del contrato (disponibilidad, reservas…) sigue en la tienda.
 * Son públicas (`security: []` en el contrato).
 */
@Controller({ path: 'atracciones', version: ['2', '3'] })
export class BookingCatalogoController {
  constructor(private readonly s: CatalogoService) {}

  @Get('categorias/arbol')
  arbol() {
    return this.s.arbol();
  }

  @Get('categorias')
  categorias(@Query() q: CategoriasQuery) {
    return this.s.planas(q.padre_id);
  }

  @Post('search')
  @HttpCode(200)
  search(@Body() b: SearchAtraccionesRequest) {
    return this.s.searchBooking(b);
  }

  @Get()
  listar(@Query() q: ListAtraccionesQuery) {
    return this.s.listarBooking(q);
  }

  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.s.detalleBooking(id);
  }
}

/** API propia de ms_catalog (contract/openapi.yaml): esquemas con los nombres de columna de la base. */
@Controller({ version: '1' })
export class CatalogoController {
  constructor(private readonly s: CatalogoService) {}

  @Get('categorias')
  categorias() {
    return this.s.categorias();
  }

  @Get('categorias/arbol')
  arbol() {
    return this.s.arbol();
  }

  @Get('categorias/:cat_id')
  categoria(@Param('cat_id', ParseIntPipe) id: number) {
    return this.s.categoria(id);
  }

  @Get('idiomas')
  idiomas() {
    return this.s.idiomas();
  }

  @Get('inclusiones')
  inclusiones() {
    return this.s.inclusiones();
  }

  @Get('operadores')
  operadores() {
    return this.s.operadores();
  }

  @Get('operadores/:ope_id')
  operador(@Param('ope_id', ParseIntPipe) id: number) {
    return this.s.operador(id);
  }

  @Get('atracciones')
  atracciones(@Query() q: AtraccionesQuery) {
    return this.s.listar(q);
  }

  @Get('atracciones/:ref')
  atraccion(@Param('ref') ref: string) {
    return this.s.porRef(ref, false);
  }

  @Post('atracciones')
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  crear(@Body() d: CrearAtraccion, @Req() req: Request & { usuario: Usuario }) {
    return this.s.crear(d, req.usuario);
  }

  @Patch('atracciones/:atr_id')
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  actualizar(@Param('atr_id', ParseIntPipe) id: number, @Body() d: AtraccionCampos, @Req() req: Request & { usuario: Usuario }) {
    return this.s.actualizar(id, d, req.usuario);
  }

  @Delete('atracciones/:atr_id')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  async eliminar(@Param('atr_id', ParseIntPipe) id: number, @Req() req: Request & { usuario: Usuario }) {
    await this.s.eliminar(id, req.usuario);
  }

  /** Eventos de otros servicios (RESENA_PUBLICADA, PRECIO_ACTUALIZADO). Idempotente. */
  @Post('internal/eventos')
  @HttpCode(200)
  @UseGuards(ServicioGuard)
  evento(@Body() e: EventoEntrante) {
    return this.s.evento(e);
  }
}
