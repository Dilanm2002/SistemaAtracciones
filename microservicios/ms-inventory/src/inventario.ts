import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, NotFoundException,
  OnApplicationBootstrap, OnApplicationShutdown, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { JwtGuard, Roles } from './comun/auth';
import { DbService, Sql } from './comun/db.service';
import { iniciarServidorGrpc } from './comun/grpc';
import { registrarEvento } from './comun/outbox';
import { hora12, horaActualEc, hoyEc, parseHora, slotId, sumarDias } from './comun/tiempo';
import { CatalogoClient, PricingClient } from './clientes';
import { MotivoStock, StockBooking } from './stock-booking';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

/** 409 sin cupos: Booking lo usa para compensar su saga (contrato v2/v3, code OUT_OF_STOCK). */
export const sinCupos = (detalle: string) => new ConflictException({ message: detalle, code: 'OUT_OF_STOCK' });

export class DisponibilidadQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}/) date?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}/) fecha?: string;
}

export class PorAtraccionQuery {
  @Transform(entero) @IsInt() @Min(1) atr_id: number;
  @IsOptional() @Matches(FECHA) desde?: string;
  @IsOptional() @Matches(FECHA) hasta?: string;
}

export class HorarioDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) hor_hora: string;
  @IsInt() @Min(1) @Max(1000) hor_cupo: number;
  @IsOptional() @IsBoolean() hor_activo?: boolean;
}

export class HorariosDto {
  @ValidateNested({ each: true }) @Type(() => HorarioDto) @ArrayMaxSize(24) horarios: HorarioDto[];
}

export class FechaBloqueadaDto {
  @IsInt() @Min(1) atr_id: number;
  @Matches(FECHA) fb_fecha: string;
  @IsString() @MinLength(3) @MaxLength(200) fb_motivo: string;
}

export interface Turno {
  dis_id: string;
  atr_id: string;
  fecha: string;
  hora: string;
  cupo_total: number;
  disponibles: number;
}

/** Cupos libres de un turno; 0 si está cerrado o la fecha está bloqueada. */
const SELECT_TURNO = `SELECT d.dis_id::text, d.atr_id::text, to_char(d.dis_fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hor_hora, 'HH24:MI') AS hora,
        d.dis_cupo_total AS cupo_total,
        CASE WHEN d.dis_cerrada OR EXISTS (SELECT 1 FROM fecha_bloqueada fb WHERE fb.atr_id = d.atr_id AND fb.fb_fecha = d.dis_fecha)
             THEN 0 ELSE GREATEST(d.dis_cupo_total - d.dis_cupo_reservado, 0) END AS disponibles
   FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id`;

/** Inventory & Availability Service: horarios, cupos por turno y fechas bloqueadas (sin sobreventa). */
@Injectable()
export class InventarioService {
  constructor(
    private readonly db: DbService,
    private readonly catalogo: CatalogoClient,
    private readonly pricing: PricingClient,
    private readonly stock: StockBooking,
  ) {}

  private async turno(disId: string | number, sql: Sql = this.db): Promise<Turno> {
    const t = await sql.one<Turno>(`${SELECT_TURNO} WHERE d.dis_id = $1`, [disId]);
    if (!t) throw new NotFoundException(`El turno ${disId} no existe.`);
    return t;
  }

  obtenerTurno(disId: number) {
    return this.turno(disId);
  }

  /** STOCK_ACTUALIZADO al feed de eventos (en la transacción) y PushStockUpdate a Booking (después). */
  private async avisar(tx: Sql, t: Turno, uuid: string, motivo: MotivoStock) {
    await registrarEvento(tx, 'STOCK_ACTUALIZADO', {
      attraction_id: uuid, date: t.fecha, time: t.hora, available_units: t.disponibles, total_units: t.cupo_total, reason: motivo,
    });
  }

  private publicar(t: Turno, uuid: string, motivo: MotivoStock) {
    this.stock.publicar({ atrUuid: uuid, fecha: t.fecha, hora: t.hora, disponibles: t.disponibles }, motivo);
  }

  /**
   * Descuenta `cupos` del turno (fecha + hora) bloqueando su fila: dos reservas simultáneas del mismo
   * turno se atienden una detrás de otra y nunca se vende más del cupo. La misma `referencia` dos
   * veces devuelve el turno sin descontar otra vez (reintentos de la saga).
   */
  async retener(r: { atr_id: number; fecha: string; hora: string; cupos: number; referencia: string }): Promise<Turno> {
    if (!Number.isInteger(r.atr_id) || r.atr_id < 1) throw new BadRequestException('atr_id no es válido.');
    if (!FECHA.test(r.fecha)) throw new BadRequestException('fecha debe tener el formato AAAA-MM-DD.');
    const hora = parseHora(r.hora);
    if (!hora) throw new BadRequestException('hora no es válida (HH:MM).');
    if (!Number.isInteger(r.cupos) || r.cupos < 1) throw new BadRequestException('cupos debe ser un entero mayor que 0.');
    if (!r.referencia) throw new BadRequestException('referencia es obligatoria.');
    const uuid = await this.catalogo.uuid(r.atr_id);
    const { turno, nuevo } = await this.db.tx(async (tx) => {
      const previa = await tx.one<{ dis_id: string }>('SELECT dis_id::text FROM retencion WHERE ret_referencia = $1', [r.referencia]);
      if (previa) return { turno: await this.turno(previa.dis_id, tx), nuevo: false };

      const hoy = hoyEc();
      if (r.fecha < hoy) throw new BadRequestException('No puedes reservar una fecha que ya pasó.');
      if (r.fecha > sumarDias(hoy, 365)) throw new BadRequestException('Solo se aceptan reservas con hasta un año de anticipación.');
      const bloqueo = await tx.one<{ motivo: string }>('SELECT fb_motivo AS motivo FROM fecha_bloqueada WHERE atr_id = $1 AND fb_fecha = $2', [r.atr_id, r.fecha]);
      if (bloqueo) throw sinCupos(`La atracción no opera el ${r.fecha}: ${bloqueo.motivo}`);
      const horarios = await tx.query<{ hor_id: string; hora: string; cupo: number }>(
        `SELECT hor_id::text, to_char(hor_hora, 'HH24:MI') AS hora, hor_cupo AS cupo FROM horario WHERE atr_id = $1 AND hor_activo ORDER BY hor_hora`,
        [r.atr_id],
      );
      const horario = horarios.find((h) => h.hora === hora);
      if (!horario) throw new BadRequestException(`El horario ${hora} no existe. Horarios disponibles: ${horarios.map((h) => h.hora).join(', ') || 'ninguno'}`);
      if (r.fecha === hoy && hora <= horaActualEc()) throw new BadRequestException('Esa salida ya partió hoy. Elige otro horario.');

      await tx.query(
        `INSERT INTO disponibilidad (atr_id, hor_id, dis_fecha, dis_cupo_total) VALUES ($1, $2, $3, $4) ON CONFLICT (atr_id, dis_fecha, hor_id) DO NOTHING`,
        [r.atr_id, horario.hor_id, r.fecha, horario.cupo],
      );
      const inv = await tx.one<{ dis_id: string; total: number; reservado: number; cerrada: boolean }>(
        `SELECT dis_id::text, dis_cupo_total AS total, dis_cupo_reservado AS reservado, dis_cerrada AS cerrada
           FROM disponibilidad WHERE atr_id = $1 AND dis_fecha = $2 AND hor_id = $3 FOR UPDATE`,
        [r.atr_id, r.fecha, horario.hor_id],
      );
      if (inv!.cerrada) throw sinCupos(`La salida de las ${hora} está cerrada para esa fecha.`);
      const libres = inv!.total - inv!.reservado;
      if (r.cupos > libres) {
        throw sinCupos(libres > 0
          ? `Solo quedan ${libres} cupo(s) para las ${hora}; se pidieron ${r.cupos}. Reduce la cantidad o elige otro horario.`
          : `El horario de las ${hora} está agotado. Elige otro horario o fecha.`);
      }
      await tx.query('UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado + $2 WHERE dis_id = $1', [inv!.dis_id, r.cupos]);
      await tx.query('INSERT INTO retencion (ret_referencia, dis_id, ret_cupos) VALUES ($1, $2, $3)', [r.referencia, inv!.dis_id, r.cupos]);
      const t = await this.turno(inv!.dis_id, tx);
      await this.avisar(tx, t, uuid, 'VENTA');
      return { turno: t, nuevo: true };
    });
    if (nuevo) this.publicar(turno, uuid, 'VENTA');
    return turno;
  }

  /**
   * Devuelve los cupos de una retención (cancelación o compensación). Idempotente: liberar dos veces
   * la misma referencia no devuelve dos veces. Una reserva anterior a los microservicios (copiada de
   * la tienda, sin retención) se libera con el dis_id y los cupos que indica ms_booking.
   */
  async liberar(r: { dis_id: number; cupos: number; referencia: string }): Promise<Turno> {
    if (!r.referencia) throw new BadRequestException('referencia es obligatoria.');
    const base = await this.turno(r.dis_id);
    const uuid = await this.catalogo.uuid(Number(base.atr_id));
    const { turno, liberado } = await this.db.tx(async (tx) => {
      let ret = await tx.one<{ ret_id: string; dis_id: string; cupos: number; liberado: Date | null }>(
        'SELECT ret_id::text, dis_id::text, ret_cupos AS cupos, ret_liberado_en AS liberado FROM retencion WHERE ret_referencia = $1 FOR UPDATE',
        [r.referencia],
      );
      if (!ret) {
        if (!Number.isInteger(r.cupos) || r.cupos < 1) throw new NotFoundException(`No hay cupos retenidos con la referencia ${r.referencia}.`);
        ret = await tx.one('INSERT INTO retencion (ret_referencia, dis_id, ret_cupos) VALUES ($1, $2, $3) RETURNING ret_id::text, dis_id::text, ret_cupos AS cupos, ret_liberado_en AS liberado', [
          r.referencia, r.dis_id, r.cupos,
        ]);
      }
      if (ret!.liberado) return { turno: await this.turno(ret!.dis_id, tx), liberado: false };
      await tx.query('SELECT 1 FROM disponibilidad WHERE dis_id = $1 FOR UPDATE', [ret!.dis_id]);
      await tx.query('UPDATE disponibilidad SET dis_cupo_reservado = GREATEST(dis_cupo_reservado - $2, 0) WHERE dis_id = $1', [ret!.dis_id, ret!.cupos]);
      await tx.query('UPDATE retencion SET ret_liberado_en = now() WHERE ret_id = $1', [ret!.ret_id]);
      const t = await this.turno(ret!.dis_id, tx);
      await this.avisar(tx, t, uuid, 'CANCELACION');
      return { turno: t, liberado: true };
    });
    if (liberado) this.publicar(turno, uuid, 'CANCELACION');
    return turno;
  }

  /** GET /atracciones/{id}/disponibilidad del contrato v2/v3 con Booking (mismos campos que la tienda). */
  async disponibilidad(ref: string, fecha: string) {
    const a = await this.catalogo.resolver(ref);
    if (!a.publicada) throw new NotFoundException(`La atracción ${ref} no existe.`);
    const dia = fecha.slice(0, 10);
    const hoy = hoyEc();
    if (dia < hoy) throw new BadRequestException('La fecha ya pasó: consulta desde hoy en adelante.');
    const [turnos, tar] = await Promise.all([
      this.db.query<{ hora: string; total: number; disponibles: number }>(
        `SELECT to_char(h.hor_hora, 'HH24:MI') AS hora, COALESCE(d.dis_cupo_total, h.hor_cupo) AS total,
                CASE WHEN fb.fb_id IS NOT NULL OR COALESCE(d.dis_cerrada, FALSE) THEN 0
                     ELSE GREATEST(COALESCE(d.dis_cupo_total, h.hor_cupo) - COALESCE(d.dis_cupo_reservado, 0), 0) END AS disponibles
           FROM horario h
           LEFT JOIN disponibilidad d ON d.atr_id = h.atr_id AND d.hor_id = h.hor_id AND d.dis_fecha = $2
           LEFT JOIN fecha_bloqueada fb ON fb.atr_id = h.atr_id AND fb.fb_fecha = $2
          WHERE h.atr_id = $1 AND h.hor_activo ORDER BY h.hor_hora`,
        [a.atr_id, dia],
      ),
      this.pricing.tarifas(a.atr_id),
    ]);
    const adulto = Number(tar?.adulto || 0);
    const nino = Number(tar?.nino || tar?.adulto || 0);
    const ahora = horaActualEc();
    const slots = turnos.map((t) => {
      // Una salida de hoy que ya partió no se puede reservar
      const libres = dia === hoy && t.hora <= ahora ? 0 : t.disponibles;
      const estado = libres === 0 ? 'AGOTADO' : libres <= 5 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE';
      return {
        slot_id: slotId(dia, t.hora),
        time: hora12(t.hora),
        hora: hora12(t.hora),
        time_24h: `${t.hora}:00`,
        hora_24h: `${t.hora}:00`,
        total_slots: t.total,
        available_slots: libres,
        status: estado,
        price_adult: adulto,
        price_child: nino,
        cupos_totales: t.total,
        cupos_disponibles: libres,
        estado,
        precio_adulto_slot: adulto,
        precio_nino_slot: nino,
      };
    });
    const total = slots.reduce((s, x) => s + x.cupos_disponibles, 0);
    return { atraccion_id: a.atr_uuid, date: dia, fecha: dia, total_available_slots: total, total_cupos_disponibles: total, time_slots: slots, turnos: slots };
  }

  // ── API propia (panel del equipo) ───────────────────────────────────────
  horarios(atrId: number) {
    return this.db.query(
      `SELECT hor_id::int, atr_id::int, to_char(hor_hora, 'HH24:MI') AS hor_hora, hor_cupo, hor_activo FROM horario WHERE atr_id = $1 ORDER BY hor_hora`,
      [atrId],
    );
  }

  /**
   * Reemplaza los horarios de una atracción: crea o actualiza los indicados y desactiva los demás.
   * Un cupo nuevo se aplica también a los turnos futuros ya abiertos (nunca por debajo de lo vendido)
   * y se avisa a Booking (AFORO).
   */
  async cambiarHorarios(atrId: number, dto: HorariosDto) {
    const uuid = await this.catalogo.uuid(atrId);
    const cambiados = await this.db.tx(async (tx) => {
      const horas = dto.horarios.map((h) => h.hor_hora);
      if (new Set(horas).size !== horas.length) throw new BadRequestException('Hay horarios repetidos.');
      await tx.query('UPDATE horario SET hor_activo = FALSE WHERE atr_id = $1 AND NOT (to_char(hor_hora, \'HH24:MI\') = ANY($2::text[]))', [atrId, horas]);
      for (const h of dto.horarios) {
        await tx.query(
          `INSERT INTO horario (atr_id, hor_hora, hor_cupo, hor_activo) VALUES ($1, $2::time, $3, $4)
           ON CONFLICT (atr_id, hor_hora) DO UPDATE SET hor_cupo = EXCLUDED.hor_cupo, hor_activo = EXCLUDED.hor_activo`,
          [atrId, h.hor_hora, h.hor_cupo, h.hor_activo ?? true],
        );
      }
      const filas = await tx.query<{ dis_id: string }>(
        `UPDATE disponibilidad d SET dis_cupo_total = GREATEST(h.hor_cupo, d.dis_cupo_reservado)
           FROM horario h WHERE h.hor_id = d.hor_id AND d.atr_id = $1 AND d.dis_fecha >= (now() AT TIME ZONE 'America/Guayaquil')::date
            AND d.dis_cupo_total <> GREATEST(h.hor_cupo, d.dis_cupo_reservado)
         RETURNING d.dis_id::text`,
        [atrId],
      );
      const turnos: Turno[] = [];
      for (const f of filas) {
        const t = await this.turno(f.dis_id, tx);
        await this.avisar(tx, t, uuid, 'AFORO');
        turnos.push(t);
      }
      return turnos;
    });
    for (const t of cambiados) this.publicar(t, uuid, 'AFORO');
    return this.horarios(atrId);
  }

  disponibilidadPropia(q: PorAtraccionQuery) {
    return this.db.query(
      `SELECT d.dis_id::int, d.atr_id::int, d.hor_id::int, to_char(d.dis_fecha, 'YYYY-MM-DD') AS dis_fecha, to_char(h.hor_hora, 'HH24:MI') AS hor_hora,
              d.dis_cupo_total, d.dis_cupo_reservado, d.dis_cerrada
         FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id
        WHERE d.atr_id = $1 AND d.dis_fecha >= COALESCE($2::date, (now() AT TIME ZONE 'America/Guayaquil')::date)
          AND ($3::date IS NULL OR d.dis_fecha <= $3::date)
        ORDER BY d.dis_fecha, h.hor_hora LIMIT 500`,
      [q.atr_id, q.desde ?? null, q.hasta ?? null],
    );
  }

  fechasBloqueadas(atrId: number) {
    return this.db.query(
      `SELECT fb_id::int, atr_id::int, to_char(fb_fecha, 'YYYY-MM-DD') AS fb_fecha, fb_motivo, fb_creado_en FROM fecha_bloqueada WHERE atr_id = $1 ORDER BY fb_fecha`,
      [atrId],
    );
  }

  /** Bloquear o desbloquear una fecha cambia los cupos de todos sus turnos: se avisa a Booking (AFORO). */
  private async avisarFecha(atrId: number, fecha: string) {
    const uuid = await this.catalogo.uuid(atrId);
    const turnos = await this.db.query<{ hora: string; total: number; disponibles: number }>(
      `SELECT to_char(h.hor_hora, 'HH24:MI') AS hora, COALESCE(d.dis_cupo_total, h.hor_cupo) AS total,
              CASE WHEN fb.fb_id IS NOT NULL OR COALESCE(d.dis_cerrada, FALSE) THEN 0
                   ELSE GREATEST(COALESCE(d.dis_cupo_total, h.hor_cupo) - COALESCE(d.dis_cupo_reservado, 0), 0) END AS disponibles
         FROM horario h LEFT JOIN disponibilidad d ON d.atr_id = h.atr_id AND d.hor_id = h.hor_id AND d.dis_fecha = $2
         LEFT JOIN fecha_bloqueada fb ON fb.atr_id = h.atr_id AND fb.fb_fecha = $2
        WHERE h.atr_id = $1 AND h.hor_activo ORDER BY h.hor_hora`,
      [atrId, fecha],
    );
    await this.db.tx(async (tx) => {
      for (const t of turnos) {
        await registrarEvento(tx, 'STOCK_ACTUALIZADO', { attraction_id: uuid, date: fecha, time: t.hora, available_units: t.disponibles, total_units: t.total, reason: 'AFORO' });
      }
    });
    for (const t of turnos) this.stock.publicar({ atrUuid: uuid, fecha, hora: t.hora, disponibles: t.disponibles }, 'AFORO');
  }

  async bloquear(dto: FechaBloqueadaDto) {
    const f = await this.db.one(
      `INSERT INTO fecha_bloqueada (atr_id, fb_fecha, fb_motivo) VALUES ($1, $2, $3)
       ON CONFLICT (atr_id, fb_fecha) DO UPDATE SET fb_motivo = EXCLUDED.fb_motivo
       RETURNING fb_id::int, atr_id::int, to_char(fb_fecha, 'YYYY-MM-DD') AS fb_fecha, fb_motivo, fb_creado_en`,
      [dto.atr_id, dto.fb_fecha, dto.fb_motivo],
    );
    await this.avisarFecha(dto.atr_id, dto.fb_fecha);
    return f;
  }

  async desbloquear(fbId: number) {
    const f = await this.db.one<{ atr_id: number; fecha: string }>(
      `DELETE FROM fecha_bloqueada WHERE fb_id = $1 RETURNING atr_id::int, to_char(fb_fecha, 'YYYY-MM-DD') AS fecha`,
      [fbId],
    );
    if (!f) throw new NotFoundException(`La fecha bloqueada ${fbId} no existe.`);
    await this.avisarFecha(f.atr_id, f.fecha);
  }
}

/** Turno en el formato del proto (int64 como texto). */
const aProto = (t: Turno) => ({ dis_id: t.dis_id, atr_id: t.atr_id, fecha: t.fecha, hora: t.hora, cupo_total: t.cupo_total, disponibles: t.disponibles });

/** Servidor gRPC descubre.inventario.v1.InventarioService (GRPC_PORT, 50045 por defecto). */
@Injectable()
export class InventarioGrpc implements OnApplicationBootstrap, OnApplicationShutdown {
  private cerrar: (() => Promise<void>) | null = null;
  constructor(private readonly s: InventarioService) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' && !process.env.GRPC_PORT) return;
    this.cerrar = await iniciarServidorGrpc('inventario.proto', 'descubre.inventario.v1.InventarioService', {
      RetenerCupos: async (r: { atr_id: string; fecha: string; hora: string; cupos: number; referencia: string }) =>
        aProto(await this.s.retener({ atr_id: Number(r.atr_id), fecha: r.fecha, hora: r.hora, cupos: r.cupos, referencia: r.referencia })),
      LiberarCupos: async (r: { dis_id: string; cupos: number; referencia: string }) =>
        aProto(await this.s.liberar({ dis_id: Number(r.dis_id), cupos: r.cupos, referencia: r.referencia })),
      ObtenerTurno: async (r: { dis_id: string }) => aProto(await this.s.obtenerTurno(Number(r.dis_id))),
    }, 50045, 'ms-inventory');
  }

  async onApplicationShutdown() {
    await this.cerrar?.();
  }
}

/** Ruta del contrato v2/v3 que Booking llama por el gateway (pública, como en el contrato). */
@Controller({ path: 'atracciones', version: ['2', '3'] })
export class DisponibilidadBookingController {
  constructor(private readonly s: InventarioService) {}

  @Get(':id/disponibilidad')
  disponibilidad(@Param('id') id: string, @Query() q: DisponibilidadQuery) {
    const fecha = q.date ?? q.fecha;
    if (!fecha) throw new BadRequestException('Indica la fecha en `date` (AAAA-MM-DD).');
    return this.s.disponibilidad(id, fecha);
  }
}

@Controller({ version: '1' })
export class InventarioController {
  constructor(
    private readonly s: InventarioService,
    private readonly stock: StockBooking,
  ) {}

  @Get('horarios')
  horarios(@Query() q: PorAtraccionQuery) {
    return this.s.horarios(q.atr_id);
  }

  @Put('horarios/:atr_id')
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  cambiarHorarios(@Param('atr_id', ParseIntPipe) atrId: number, @Body() dto: HorariosDto) {
    return this.s.cambiarHorarios(atrId, dto);
  }

  @Get('disponibilidad')
  disponibilidad(@Query() q: PorAtraccionQuery) {
    return this.s.disponibilidadPropia(q);
  }

  @Get('turnos/:dis_id')
  turno(@Param('dis_id', ParseIntPipe) disId: number) {
    return this.s.obtenerTurno(disId);
  }

  @Get('fechas-bloqueadas')
  fechas(@Query() q: PorAtraccionQuery) {
    return this.s.fechasBloqueadas(q.atr_id);
  }

  @Post('fechas-bloqueadas')
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  bloquear(@Body() dto: FechaBloqueadaDto) {
    return this.s.bloquear(dto);
  }

  @Delete('fechas-bloqueadas/:fb_id')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'OPERADOR')
  async desbloquear(@Param('fb_id', ParseIntPipe) id: number) {
    await this.s.desbloquear(id);
  }

  /** Envíos de stock a Booking (para el panel de observabilidad). */
  @Get('stock/sync')
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  sync() {
    return this.stock.resumen();
  }

  @Post('stock/reintentar')
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  async reintentar() {
    return { enviados: await this.stock.reintentarPendientes() };
  }
}
