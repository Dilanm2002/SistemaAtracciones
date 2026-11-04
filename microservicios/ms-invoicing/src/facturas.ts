import { BadRequestException, Controller, Get, HttpException, Injectable, Logger, NotFoundException, OnModuleInit, Query, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as soap from 'soap';
import { JwtGuard, Roles } from './comun/auth';
import { conCorrelacion } from './comun/correlacion';
import { DbService, Sql } from './comun/db.service';

const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const RE_MONTO = /^\d{1,10}\.\d{2}$/;
const cent = (m: string | undefined) => Math.round(Number(m ?? '0') * 100);
const dinero = (c: number) => (c / 100).toFixed(2);
const TIPOS_ID = ['CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL'];

export class FacturaQuery {
  @Transform(entero) @IsInt() @Min(1) ord_id: number;
}

interface LineaEntrada { det_id: string; codigo: string; descripcion: string; cantidad: number | string; precio_unitario: string; descuento?: string; iva_porcentaje?: string }
interface Comprador { tipo_identificacion: string; identificacion: string; razon_social: string; correo: string; telefono?: string }
export interface EmitirFactura { ord_id: string | number; comprador: Comprador; lineas: { linea: LineaEntrada | LineaEntrada[] } }

/** Un elemento repetido de SOAP llega como objeto si es uno solo y como arreglo si son varios. */
const lista = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/**
 * Clave de acceso SRI (49 dígitos): fecha ddmmaaaa · tipo 01 (factura) · RUC del emisor · ambiente 1 (pruebas) ·
 * serie 001001 · secuencial · código numérico · emisión 1 · dígito verificador módulo 11. Simulada: no se envía al SRI.
 */
export function claveAcceso(fecha: Date, secuencial: number, ruc = process.env.EMISOR_RUC ?? '1792345678001'): string {
  const d = fecha.toLocaleDateString('en-GB', { timeZone: 'America/Guayaquil' }).split('/').join('');
  const base = `${d}01${ruc}1001001${String(secuencial).padStart(9, '0')}${String(secuencial % 1e8).padStart(8, '0')}1`;
  let suma = 0;
  let factor = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    suma += Number(base[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (suma % 11);
  return `${base}${dv === 11 ? 0 : dv === 10 ? 1 : dv}`;
}

/** Electronic Invoicing Service: factura (encabezado) + factura_detalle, siempre con al menos una línea. */
@Injectable()
export class FacturasService {
  constructor(private readonly db: DbService) {}

  async obtener(ordId: number | string, sql: Sql = this.db) {
    const f = await sql.one<Record<string, unknown>>(
      `SELECT f.fac_id::text, f.fac_numero, f.ord_id::text, e.est_codigo AS estado, f.fac_emitida_en AS emitida_en,
              f.fac_clave_acceso AS clave_acceso, f.fac_autorizacion_sri AS autorizacion_sri,
              f.fac_subtotal::text AS subtotal, f.fac_descuento::text AS descuento, f.fac_iva::text AS iva, f.fac_total::text AS total,
              json_build_object('tipo_identificacion', f.fac_tipo_identificacion, 'identificacion', f.fac_identificacion,
                                'razon_social', f.fac_razon_social, 'correo', f.fac_correo, 'telefono', f.fac_telefono) AS comprador
         FROM factura f JOIN estado e ON e.est_id = f.est_id WHERE f.ord_id = $1`,
      [ordId],
    );
    if (!f) throw new NotFoundException(`La orden ${ordId} no tiene factura.`);
    const lineas = await sql.query(
      `SELECT fde_id::text, det_id::text, fde_codigo AS codigo, fde_descripcion AS descripcion, fde_cantidad AS cantidad,
              fde_precio_unitario::text AS precio_unitario, fde_descuento::text AS descuento, fde_subtotal::text AS subtotal,
              fde_iva_porcentaje::text AS iva_porcentaje, fde_iva::text AS iva, fde_total::text AS total
         FROM factura_detalle WHERE fac_id = $1 ORDER BY fde_id`,
      [f.fac_id],
    );
    const c = f.comprador as Comprador;
    if (c.telefono == null) delete c.telefono;
    return { ...f, lineas };
  }

  /**
   * Emite la factura de una orden pagada: número 001-001-<ord_id>, estado PAGADA, una línea por cada línea de
   * la orden. Idempotente: si la orden ya tiene factura, se devuelve la misma (uq_factura_orden).
   */
  async emitir(r: EmitirFactura) {
    const ordId = Number(r.ord_id);
    if (!Number.isInteger(ordId) || ordId < 1) throw new BadRequestException('ord_id no es válido.');
    const c = r.comprador;
    if (!c || !TIPOS_ID.includes(c.tipo_identificacion)) throw new BadRequestException(`tipo_identificacion debe ser ${TIPOS_ID.join(', ')}.`);
    const lineas = lista(r.lineas?.linea);
    if (!lineas.length) throw new BadRequestException('La factura necesita al menos una línea de detalle.');
    const calc = lineas.map((l) => {
      const cantidad = Number(l.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1 || !RE_MONTO.test(l.precio_unitario) || (l.descuento && !RE_MONTO.test(l.descuento))) {
        throw new BadRequestException(`La línea «${l.descripcion}» tiene cantidad o montos inválidos.`);
      }
      const bruto = cantidad * cent(l.precio_unitario);
      const desc = cent(l.descuento);
      if (desc > bruto) throw new BadRequestException(`El descuento de «${l.descripcion}» supera su valor.`);
      const pct = Number(l.iva_porcentaje ?? '0');
      if (!(pct >= 0 && pct <= 100)) throw new BadRequestException('iva_porcentaje debe estar entre 0 y 100.');
      const subtotal = bruto - desc;
      const iva = Math.round((subtotal * pct) / 100);
      return { l, cantidad, bruto, desc, subtotal, pct, iva, total: subtotal + iva };
    });
    const suma = (k: 'bruto' | 'desc' | 'iva' | 'total') => calc.reduce((s, x) => s + x[k], 0);
    await this.db.tx(async (tx) => {
      const ahora = new Date();
      const fac = await tx.one<{ fac_id: string }>(
        `INSERT INTO factura (ord_id, fac_numero, est_id, fac_emitida_en, fac_subtotal, fac_descuento, fac_iva, fac_total,
                              fac_tipo_identificacion, fac_identificacion, fac_razon_social, fac_correo, fac_telefono)
         VALUES ($1, '001-001-' || lpad($1::bigint::text, 9, '0'), (SELECT est_id FROM estado WHERE est_codigo = 'PAGADA'), $2,
                 $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (ord_id) DO NOTHING RETURNING fac_id::text`,
        [ordId, ahora, dinero(suma('bruto')), dinero(suma('desc')), dinero(suma('iva')), dinero(suma('total')),
          c.tipo_identificacion, c.identificacion.slice(0, 20), c.razon_social.slice(0, 150), c.correo, c.telefono || null],
      );
      if (!fac) return; // ya estaba emitida
      const clave = claveAcceso(ahora, ordId);
      await tx.query('UPDATE factura SET fac_clave_acceso = $2, fac_autorizacion_sri = $2 WHERE fac_id = $1', [fac.fac_id, clave]);
      for (const x of calc) {
        await tx.query(
          `INSERT INTO factura_detalle (fac_id, det_id, fde_codigo, fde_descripcion, fde_cantidad, fde_precio_unitario, fde_descuento,
                                        fde_subtotal, fde_iva_porcentaje, fde_iva, fde_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [fac.fac_id, x.l.det_id, x.l.codigo.slice(0, 25), x.l.descripcion.slice(0, 300), x.cantidad, x.l.precio_unitario,
            dinero(x.desc), dinero(x.subtotal), x.pct.toFixed(2), dinero(x.iva), dinero(x.total)],
        );
      }
    });
    return this.obtener(ordId);
  }

  /** Anula (reembolso total): solo cambia el estado; el detalle se conserva. Idempotente. */
  async anular(ordId: number, motivo: string) {
    if (!motivo?.trim()) throw new BadRequestException('motivo es obligatorio.');
    await this.db.tx(async (tx) => {
      const f = await tx.one<{ fac_id: string }>('SELECT fac_id::text FROM factura WHERE ord_id = $1 FOR UPDATE', [ordId]);
      if (!f) throw new NotFoundException(`La orden ${ordId} no tiene factura.`);
      await tx.query(`UPDATE factura SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'ANULADA') WHERE fac_id = $1`, [f.fac_id]);
    });
    return this.obtener(ordId);
  }
}

/** Arreglo de líneas → forma del WSDL (<lineas><linea>…</linea></lineas>). */
const aSoap = (f: Awaited<ReturnType<FacturasService['obtener']>>) => ({ factura: { ...f, lineas: { linea: f.lineas } } });

/** Error de negocio → SOAP Fault con el status y el code del contrato en <detail> (el cliente lo reconvierte). */
function fault(e: unknown): never {
  const st = e instanceof HttpException ? e.getStatus() : 500;
  const cuerpo = e instanceof HttpException ? (e.getResponse() as { message?: string; code?: string }) : {};
  throw {
    Fault: {
      faultcode: st < 500 ? 'soap:Client' : 'soap:Server',
      faultstring: st < 500 ? String(cuerpo.message ?? (e as Error).message) : 'Error interno.',
      detail: { status: st, code: cuerpo.code ?? (st === 404 ? 'NOT_FOUND' : st === 400 ? 'VALIDATION_FAILED' : 'INTERNAL') },
      statusCode: st < 500 ? 400 : 500,
    },
  };
}

/** WSDL del contrato (contract/facturacion.wsdl), servido en /soap/facturacion?wsdl. */
export const WSDL = (() => {
  const archivo = [join(__dirname, '..', 'contract', 'facturacion.wsdl'), join(process.cwd(), 'contract', 'facturacion.wsdl')].find(existsSync);
  if (!archivo) throw new Error('Falta contract/facturacion.wsdl');
  return readFileSync(archivo, 'utf8');
})();

/**
 * Servidor SOAP en /soap/facturacion (mismo puerto HTTP del servicio). Se registra en onModuleInit: antes del
 * manejador de 404 de Nest. Las llamadas (POST) exigen X-Servicio-Token; el WSDL (GET ?wsdl) es público.
 */
@Injectable()
export class FacturacionSoap implements OnModuleInit {
  private readonly logger = new Logger('ms-invoicing');

  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly s: FacturasService,
  ) {}

  onModuleInit() {
    const app = this.adapter.httpAdapter.getInstance();
    app.use('/soap/facturacion', (req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET') return next();
      const esperado = process.env.SERVICIOS_TOKEN ?? '';
      const enviado = String(req.header('x-servicio-token') ?? '');
      const ok = esperado.length >= 16 && enviado.length === esperado.length && timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado));
      if (ok) return conCorrelacion(req.header('x-correlation-id') || undefined, async () => next());
      res.status(401).type('text/xml').send(
        `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault>` +
        `<faultcode>soap:Client</faultcode><faultstring>Llamada interna sin X-Servicio-Token válido.</faultstring>` +
        `<detail><status>401</status><code>UNAUTHORIZED</code></detail></soap:Fault></soap:Body></soap:Envelope>`,
      );
    });
    const conFault = <A>(fn: (a: A) => Promise<unknown>) => (a: A) => fn(a).catch(fault);
    // node-soap lee el WSDL de forma asíncrona y recién entonces agrega su ruta: se le da una app express
    // propia, montada ya, para que su ruta quede antes del manejador de 404 de Nest.
    const soapApp = express();
    app.use(soapApp);
    soap.listen(soapApp, '/soap/facturacion', {
      FacturacionService: {
        FacturacionPort: {
          EmitirFactura: conFault(async (a: EmitirFactura) => aSoap(await this.s.emitir(a))),
          ObtenerFactura: conFault(async (a: { ord_id: string }) => aSoap(await this.s.obtener(Number(a.ord_id)))),
          AnularFactura: conFault(async (a: { ord_id: string; motivo: string }) => aSoap(await this.s.anular(Number(a.ord_id), a.motivo))),
        },
      },
    }, WSDL);
    this.logger.log('ms-invoicing SOAP en /soap/facturacion (WSDL: /soap/facturacion?wsdl)');
  }
}

/** Consulta para el panel (ADMIN); los servicios usan SOAP. */
@Controller({ path: 'facturas', version: '1' })
@UseGuards(JwtGuard)
@Roles('ADMIN')
export class FacturasController {
  constructor(private readonly s: FacturasService) {}

  @Get()
  porOrden(@Query() q: FacturaQuery) {
    return this.s.obtener(q.ord_id);
  }
}
