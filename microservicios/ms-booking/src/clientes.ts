import { HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as soap from 'soap';
import { correlacionActual } from './comun/correlacion';
import { llamarGrpc } from './comun/grpc';
import { llamar, urlServicio } from './comun/http';

/**
 * Clientes de los servicios que orquesta ms_booking, cada uno por el protocolo que fija el script del equipo:
 * REST (catalog, location, payment, refund) · gRPC (pricing, inventory, order) · SOAP (invoicing).
 */

export interface Atraccion {
  atr_id: number;
  atr_uuid: string;
  atr_nombre: string;
  atr_estado: string;
  atr_eliminado_en: string | null;
  atr_moneda: string;
  atr_direccion: string | null;
  atr_punto_encuentro: string | null;
  atr_guia: string | null;
  atr_cancelacion_gratuita: boolean;
  atr_horas_cancelacion: number;
  atr_duracion_horas: number;
  ciu_id: number;
}

@Injectable()
export class CatalogoClient {
  /** 60 s en memoria: una compra no vuelve a pedir la ficha completa (cada consulta a la base cuesta un viaje). */
  private readonly cache = new Map<string, { a: Atraccion; hasta: number }>();

  async atraccion(ref: string): Promise<Atraccion> {
    const c = this.cache.get(ref);
    if (c && c.hasta > Date.now()) return c.a;
    try {
      const a = await llamar<Atraccion>('catalog', 'GET', `/api/v1/atracciones/${encodeURIComponent(ref)}`);
      this.cache.set(ref, { a, hasta: Date.now() + 60_000 });
      return a;
    } catch (e) {
      if ((e as { status?: number }).status === 404) throw new NotFoundException(`La atracción ${ref} no existe.`);
      throw e;
    }
  }

  /** Nombre de la ciudad (ms_location) para el punto de encuentro cuando la atracción no tiene dirección. */
  async ciudad(ciuId: number): Promise<string | null> {
    try {
      return (await llamar<{ ciu_nombre: string }>('location', 'GET', `/api/v1/ciudades/${ciuId}`)).ciu_nombre;
    } catch {
      return null;
    }
  }
}

export interface Tarifas { moneda: string; adulto: string; nino: string; mayor: string; estudiante: string }

@Injectable()
export class PricingClient {
  async tarifas(atrId: number): Promise<Tarifas> {
    const r = await llamarGrpc<{ tarifas: Tarifas[] }>('pricing.proto', 'descubre.pricing.v1.PricingService', 'PRICING_GRPC_URL', 'localhost:50044', 'ObtenerTarifas', { atr_ids: [atrId] });
    return r.tarifas[0];
  }
}

export interface Turno { dis_id: string; atr_id: string; fecha: string; hora: string; cupo_total: number; disponibles: number }

@Injectable()
export class InventarioClient {
  private llamar<T>(metodo: string, req: unknown) {
    return llamarGrpc<T>('inventario.proto', 'descubre.inventario.v1.InventarioService', 'INVENTORY_GRPC_URL', 'localhost:50045', metodo, req);
  }

  retener(r: { atr_id: number; fecha: string; hora: string; cupos: number; referencia: string }) {
    return this.llamar<Turno>('RetenerCupos', r);
  }

  liberar(r: { dis_id: string | number; cupos: number; referencia: string }) {
    return this.llamar<Turno>('LiberarCupos', r);
  }
}

export interface LineaOrden { det_id: string; atr_id: string; descripcion: string; cantidad: number; precio_unitario: string; subtotal: string }
export interface Orden { ord_id: string; ord_numero: string; estado: string; total: string; moneda: string; lineas: LineaOrden[] }

@Injectable()
export class OrdenClient {
  private llamar<T>(metodo: string, req: unknown) {
    return llamarGrpc<T>('orden.proto', 'descubre.orden.v1.OrdenService', 'ORDER_GRPC_URL', 'localhost:50047', metodo, req);
  }

  crear(r: { usu_id: string; mpa_id: number; moneda: string; sufijo: string; idempotency_key: string; observaciones: string; lineas: Omit<LineaOrden, 'det_id'>[] }) {
    return this.llamar<Orden>('CrearOrden', r);
  }

  cambiarEstado(ordId: string | number, estado: 'PAGADA' | 'CANCELADA' | 'REEMBOLSADA') {
    return this.llamar<Orden>('CambiarEstado', { ord_id: ordId, estado });
  }
}

export interface Pago { pag_id: number; pag_numero: string; estado: string; pag_monto: string; mpa_codigo: string }

@Injectable()
export class PagoClient {
  crear(r: { ord_id: number; mpa_codigo: string; monto: string; sufijo: string }) {
    return llamar<Pago>('payment', 'POST', '/api/v1/internal/pagos', { cuerpo: r });
  }

  uno(pagId: number) {
    return llamar<Pago>('payment', 'GET', `/api/v1/internal/pagos/${pagId}`);
  }

  rechazar(pagId: number, motivo: string) {
    return llamar<Pago>('payment', 'POST', `/api/v1/internal/pagos/${pagId}/rechazar`, { cuerpo: { motivo } });
  }
}

@Injectable()
export class ReembolsoClient {
  crear(pagId: number, motivo: string) {
    return llamar<{ rem_numero: string; rem_monto: string }>('refund', 'POST', '/api/v1/internal/reembolsos', { cuerpo: { pag_id: pagId, motivo } });
  }
}

export interface LineaFactura { det_id: string; codigo: string; descripcion: string; cantidad: number; precio_unitario: string }
type ClienteSoap = soap.Client & Record<string, (a: unknown, o?: object, h?: Record<string, string>) => Promise<[{ factura: Record<string, unknown> }]>>;

/**
 * ms_invoicing por SOAP (WSDL en /soap/facturacion?wsdl). Un SOAP Fault trae en <detail> el status y el code
 * del contrato y se convierte otra vez en el mismo error HTTP; sin respuesta → 503 DEPENDENCY_UNAVAILABLE.
 */
@Injectable()
export class FacturacionClient {
  private cliente: Promise<ClienteSoap> | null = null;

  private obtener(): Promise<ClienteSoap> {
    const url = `${urlServicio('invoicing')}/soap/facturacion`;
    this.cliente ??= (soap.createClientAsync(`${url}?wsdl`, { endpoint: url, wsdl_options: { timeout: 3000 } }) as Promise<ClienteSoap>)
      .catch((e) => { this.cliente = null; throw e; });
    return this.cliente;
  }

  private async llamar(operacion: string, args: unknown) {
    let c: ClienteSoap;
    try {
      c = await this.obtener();
    } catch (e) {
      throw new ServiceUnavailableException({ message: `ms_invoicing no responde (WSDL: ${(e as Error).message}).`, code: 'DEPENDENCY_UNAVAILABLE' });
    }
    const cabeceras: Record<string, string> = { 'X-Servicio-Token': process.env.SERVICIOS_TOKEN ?? '' };
    const cid = correlacionActual();
    if (cid) cabeceras['X-Correlation-Id'] = cid;
    try {
      const [r] = await c[`${operacion}Async`](args, { timeout: 3000 }, cabeceras);
      return r.factura;
    } catch (e) {
      const f = (e as { root?: { Envelope?: { Body?: { Fault?: { faultstring?: string; detail?: { status?: string; code?: string } } } } } }).root?.Envelope?.Body?.Fault;
      const st = Number(f?.detail?.status);
      if (f && st >= 400 && st < 500) throw new HttpException({ message: f.faultstring, code: f.detail?.code, upstream: 'invoicing' }, st);
      throw new ServiceUnavailableException({ message: `ms_invoicing no respondió (${(e as Error).message}).`, code: 'DEPENDENCY_UNAVAILABLE' });
    }
  }

  emitir(ordId: string | number, comprador: { tipo_identificacion: string; identificacion: string; razon_social: string; correo: string; telefono?: string }, lineas: LineaFactura[]) {
    return this.llamar('EmitirFactura', { ord_id: ordId, comprador, lineas: { linea: lineas } });
  }

  anular(ordId: string | number, motivo: string) {
    return this.llamar('AnularFactura', { ord_id: ordId, motivo });
  }
}
