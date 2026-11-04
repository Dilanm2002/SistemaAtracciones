import {
  BadRequestException, ConflictException, Controller, Get, Injectable, NotFoundException, OnApplicationBootstrap,
  OnApplicationShutdown, Param, ParseIntPipe, Query, UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import { JwtGuard, Roles } from './comun/auth';
import { DbService, Sql } from './comun/db.service';
import { iniciarServidorGrpc } from './comun/grpc';

const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_MONTO = /^\d{1,10}\.\d{2}$/;
const centavos = (m: string) => Math.round(Number(m) * 100);
const dinero = (c: number) => (c / 100).toFixed(2);

/** Transiciones válidas (estados del script). Repetir el estado actual no es un error. */
const SIGUIENTES: Record<string, string[]> = { CREADA: ['PAGADA', 'CANCELADA'], PAGADA: ['REEMBOLSADA'], CANCELADA: [], REEMBOLSADA: [] };

export class OrdenesQuery {
  @Transform(entero) @IsInt() @Min(1) usu_id: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 50;
}

interface LineaEntrada { atr_id: string; descripcion: string; cantidad: number; precio_unitario: string; subtotal: string }
export interface CrearOrden {
  usu_id: string;
  mpa_id: number;
  moneda: string;
  lineas: LineaEntrada[];
  observaciones: string;
  sufijo: string;
  idempotency_key: string;
}

/** Order Management Service: orden + orden_detalle con los precios congelados al comprar. */
@Injectable()
export class OrdenesService {
  constructor(private readonly db: DbService) {}

  async obtener(ordId: number | string, sql: Sql = this.db) {
    const o = await sql.one<{ ord_id: string; ord_numero: string; estado: string; subtotal: string; descuento: string; iva: string; total: string; moneda: string; usu_id: string; mpa_id: number | null }>(
      `SELECT o.ord_id::text, o.ord_numero, e.est_codigo AS estado, o.ord_subtotal::text AS subtotal, o.ord_descuento::text AS descuento,
              o.ord_iva::text AS iva, o.ord_total::text AS total, o.ord_moneda AS moneda, o.usu_id::text, o.mpa_id
         FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.ord_id = $1`,
      [ordId],
    );
    if (!o) throw new NotFoundException(`La orden ${ordId} no existe.`);
    const lineas = await sql.query(
      `SELECT det_id::text, atr_id::text, det_descripcion AS descripcion, det_cantidad AS cantidad,
              det_precio_unitario::text AS precio_unitario, det_subtotal::text AS subtotal
         FROM orden_detalle WHERE ord_id = $1 ORDER BY det_id`,
      [ordId],
    );
    const { usu_id: _u, mpa_id: _m, ...resto } = o;
    return { ...resto, lineas };
  }

  /**
   * Crea la orden y su detalle. La Idempotency-Key se reserva en la MISMA transacción: dos llamadas
   * simultáneas con la misma clave esperan una a la otra y devuelven la misma orden (sin duplicados).
   */
  async crear(r: CrearOrden) {
    if (!RE_UUID.test(r.idempotency_key ?? '')) throw new BadRequestException('idempotency_key debe ser un UUID.');
    if (!/^[A-Z0-9]{6}$/.test(r.sufijo ?? '')) throw new BadRequestException('sufijo debe tener 6 letras o números en mayúsculas.');
    if (!/^[A-Z]{3}$/.test(r.moneda ?? '')) throw new BadRequestException('moneda no es válida (ISO 4217).');
    if (!r.lineas?.length) throw new BadRequestException('La orden necesita al menos una línea.');
    let subtotal = 0;
    for (const l of r.lineas) {
      if (!RE_MONTO.test(l.precio_unitario) || !RE_MONTO.test(l.subtotal) || !(l.cantidad > 0)) throw new BadRequestException('Línea con cantidad o montos inválidos.');
      if (centavos(l.subtotal) !== l.cantidad * centavos(l.precio_unitario)) throw new BadRequestException(`La línea «${l.descripcion}» no cuadra: subtotal ≠ cantidad × precio.`);
      subtotal += centavos(l.subtotal);
    }
    const hash = createHash('sha256').update(JSON.stringify({ ...r, idempotency_key: undefined })).digest('hex');
    const ordId = await this.db.tx(async (tx) => {
      const reservada = await tx.one(
        `INSERT INTO idempotencia (idem_clave, idem_sujeto, idem_operacion, idem_request_hash, idem_expira_en)
         VALUES ($1, $2, 'crear-orden', $3, now() + interval '24 hours') ON CONFLICT DO NOTHING RETURNING idem_clave`,
        [r.idempotency_key, r.usu_id, hash],
      );
      if (!reservada) {
        const previa = await tx.one<{ hash: string; resp: { ord_id?: string } | null }>(
          'SELECT idem_request_hash AS hash, idem_response AS resp FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto = $2',
          [r.idempotency_key, r.usu_id],
        );
        if (previa?.hash !== hash) throw new ConflictException({ message: 'La Idempotency-Key ya se usó con otra orden.', code: 'IDEMPOTENCY_CONFLICT' });
        if (!previa.resp?.ord_id) throw new ConflictException({ message: 'La orden se está creando; intenta de nuevo.', code: 'IDEMPOTENCY_IN_PROGRESS' });
        return previa.resp.ord_id;
      }
      await tx.query('SAVEPOINT numero');
      let orden: { ord_id: string } | null;
      try {
        orden = await tx.one<{ ord_id: string }>(
          `INSERT INTO orden (ord_numero, usu_id, est_id, mpa_id, ord_subtotal, ord_descuento, ord_iva, ord_total, ord_moneda, ord_observaciones)
           VALUES ($1, $2, (SELECT est_id FROM estado WHERE est_codigo = 'CREADA'), $3, $4, 0, 0, $4, $5, $6) RETURNING ord_id::text`,
          [`ORD-${r.sufijo}`, r.usu_id, r.mpa_id || null, dinero(subtotal), r.moneda, r.observaciones?.slice(0, 500) || null],
        );
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
        // Ese número ya existe: el orquestador reintenta con otro sufijo (todo lo demás se deshace)
        throw new ConflictException({ message: `El número ORD-${r.sufijo} ya existe.`, code: 'NUMERO_DUPLICADO' });
      }
      const lineas = [];
      for (const l of r.lineas) {
        const d = await tx.one<{ det_id: string }>(
          `INSERT INTO orden_detalle (ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal) VALUES ($1, $2, $3, $4, $5, $6) RETURNING det_id::text`,
          [orden!.ord_id, l.atr_id, l.descripcion.slice(0, 255), l.cantidad, l.precio_unitario, l.subtotal],
        );
        lineas.push({ det_id: d!.det_id, atr_id: String(l.atr_id), descripcion: l.descripcion.slice(0, 255), cantidad: l.cantidad, precio_unitario: l.precio_unitario, subtotal: l.subtotal });
      }
      await tx.query(`UPDATE idempotencia SET idem_estado = 'DONE', idem_response = $3 WHERE idem_clave = $1 AND idem_sujeto = $2`, [
        r.idempotency_key, r.usu_id, JSON.stringify({ ord_id: orden!.ord_id }),
      ]);
      // La orden recién creada, sin volver a consultarla (cada consulta a la base cuesta un viaje)
      return { ord_id: orden!.ord_id, ord_numero: `ORD-${r.sufijo}`, estado: 'CREADA', subtotal: dinero(subtotal), descuento: '0.00', iva: '0.00', total: dinero(subtotal), moneda: r.moneda, lineas };
    });
    return typeof ordId === 'string' ? this.obtener(ordId) : ordId;
  }

  /** CREADA → PAGADA | CANCELADA; PAGADA → REEMBOLSADA. Repetir el estado actual devuelve la orden igual. */
  async cambiarEstado(ordId: number, estado: string) {
    if (!(estado in SIGUIENTES)) throw new BadRequestException(`Estado desconocido: ${estado}.`);
    await this.db.tx(async (tx) => {
      const o = await tx.one<{ estado: string }>('SELECT e.est_codigo AS estado FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.ord_id = $1 FOR UPDATE OF o', [ordId]);
      if (!o) throw new NotFoundException(`La orden ${ordId} no existe.`);
      if (o.estado === estado) return;
      if (!SIGUIENTES[o.estado].includes(estado)) {
        throw new ConflictException({ message: `La orden está ${o.estado}: no puede pasar a ${estado}.`, code: 'INVALID_STATE' });
      }
      await tx.query(`UPDATE orden SET est_id = (SELECT est_id FROM estado WHERE est_codigo = $2) WHERE ord_id = $1`, [ordId, estado]);
    });
    return this.obtener(ordId);
  }

  listar(q: OrdenesQuery) {
    return this.db.query(
      `SELECT o.ord_id::int, o.ord_numero, e.est_codigo AS estado, o.ord_fecha, o.ord_total::float8 AS ord_total, o.ord_moneda
         FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.usu_id = $1 ORDER BY o.ord_fecha DESC LIMIT $2`,
      [q.usu_id, q.limit ?? 50],
    );
  }
}

/** Servidor gRPC descubre.orden.v1.OrdenService (GRPC_PORT, 50047 por defecto). */
@Injectable()
export class OrdenGrpc implements OnApplicationBootstrap, OnApplicationShutdown {
  private cerrar: (() => Promise<void>) | null = null;
  constructor(private readonly s: OrdenesService) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' && !process.env.GRPC_PORT) return;
    this.cerrar = await iniciarServidorGrpc('orden.proto', 'descubre.orden.v1.OrdenService', {
      CrearOrden: (r: CrearOrden) => this.s.crear(r),
      CambiarEstado: (r: { ord_id: string; estado: string }) => this.s.cambiarEstado(Number(r.ord_id), r.estado),
      ObtenerOrden: (r: { ord_id: string }) => this.s.obtener(Number(r.ord_id)),
    }, 50047, 'ms-order');
  }

  async onApplicationShutdown() {
    await this.cerrar?.();
  }
}

/** Consulta para el panel (ADMIN). Los servicios crean y cambian órdenes solo por gRPC. */
@Controller({ path: 'ordenes', version: '1' })
@UseGuards(JwtGuard)
@Roles('ADMIN')
export class OrdenesController {
  constructor(private readonly s: OrdenesService) {}

  @Get()
  listar(@Query() q: OrdenesQuery) {
    return this.s.listar(q);
  }

  @Get(':ord_id')
  una(@Param('ord_id', ParseIntPipe) id: number) {
    return this.s.obtener(id);
  }
}
