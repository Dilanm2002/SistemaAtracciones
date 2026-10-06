import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { DbService } from '../../common/db/db.service';
import { firmaValida, firmarMedia } from '../../common/storage/media';
import { AtraccionMapper } from './atraccion.mapper';
import { ReservasService } from './reservas.service';
import { icsReserva } from './utils/ics';

const RE_ARCHIVO = /^([0-9a-f-]{36})\.ics$/i;
const clave = (uuid: string) => `calendario:${uuid}`;

/**
 * «Añadir a mi calendario» (MOV-014). En iPhone, Safari ignora la descarga de un archivo generado en
 * el navegador; necesita una URL real que responda `text/calendar`. El dueño de la reserva pide un
 * enlace firmado (válido 2 h) y el navegador lo abre: iOS muestra «Añadir al calendario» y Android
 * o el escritorio descargan el .ics. Sin la firma (o vencida) responde 404, sin revelar la reserva.
 */
@ApiTags('Reservas')
@Controller()
export class CalendarioController {
  constructor(
    private readonly reservas: ReservasService,
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly mapper: AtraccionMapper,
  ) {}

  private secreto() {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  @Get('atracciones/reservations/:reservationId/calendar-link')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enlace firmado (2 h) al evento de calendario .ics de una reserva propia' })
  @ApiParam({ name: 'reservationId', format: 'uuid' })
  async enlace(@Param('reservationId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.reservas.getById(id, user); // 404 si no es suya (o del personal autorizado)
    return { url: this.mapper.absUrl(`/api/v1/calendario/${id}.ics?t=${firmarMedia(clave(id), this.secreto())}`) };
  }

  @Get('calendario/:archivo')
  @ApiExcludeEndpoint()
  async ics(@Param('archivo') archivo: string, @Query('t') t: string | undefined, @Res() res: Response) {
    const uuid = RE_ARCHIVO.exec(archivo)?.[1]?.toLowerCase();
    if (!uuid || !firmaValida(clave(uuid), t, this.secreto())) throw new NotFoundException('El enlace del calendario no es válido o venció.');
    const r = await this.db.one<{ codigo: string; nombre: string; fecha: string; hora: string; duracion: number; lugar: string; personas: number }>(
      `SELECT r.res_codigo AS codigo, a.atr_nombre AS nombre, to_char(r.res_fecha, 'YYYY-MM-DD') AS fecha,
              to_char(r.res_hora, 'HH24:MI') AS hora, a.atr_duracion_horas::float8 AS duracion,
              COALESCE(a.atr_punto_encuentro, a.atr_direccion, c.ciu_nombre) AS lugar, r.res_numero_tickets AS personas
         FROM reserva r
         JOIN orden_detalle dt ON dt.det_id = r.det_id
         JOIN atraccion a      ON a.atr_id = dt.atr_id
         JOIN ciudad c         ON c.ciu_id = a.ciu_id
        WHERE r.res_uuid = $1`,
      [uuid],
    );
    if (!r) throw new NotFoundException('El enlace del calendario no es válido o venció.');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="reserva-${r.codigo}.ics"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(icsReserva({ id: uuid, codigo: r.codigo, nombre: r.nombre, fecha: r.fecha, hora: r.hora, duracionHoras: r.duracion, lugar: r.lugar, personas: r.personas }));
  }
}
