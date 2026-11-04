import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import { AddressInfo } from 'net';
import * as soap from 'soap';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { claveAcceso } from '../src/facturas';
import { baseVacia, describeDb } from './helpers';

const TOKEN = 'token-servicios-pruebas-123';
const SECRETO = 'secreto-de-pruebas-de-ms-invoicing-0123456789';

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

/** Dígito verificador módulo 11 del SRI (pesos 2..7 de derecha a izquierda). */
function dvValido(clave: string) {
  let suma = 0;
  let f = 2;
  for (let i = clave.length - 2; i >= 0; i--) {
    suma += Number(clave[i]) * f;
    f = f === 7 ? 2 : f + 1;
  }
  const dv = 11 - (suma % 11);
  return Number(clave.at(-1)) === (dv === 11 ? 0 : dv === 10 ? 1 : dv);
}

const comprador = { tipo_identificacion: 'CEDULA', identificacion: '1710034065', razon_social: 'Luis Andrade', correo: 'luis@correo.com', telefono: '0981122334' };
const lineas = [
  { det_id: 11, codigo: 'ATR-3-AD', descripcion: 'Cotopaxi · 2026-11-06 06:30 · Adulto', cantidad: 2, precio_unitario: '65.00' },
  { det_id: 12, codigo: 'ATR-3-NI', descripcion: 'Cotopaxi · 2026-11-06 06:30 · Niño', cantidad: 1, precio_unitario: '45.00' },
  { det_id: 13, codigo: 'ATR-3-IN', descripcion: 'Cotopaxi · 2026-11-06 06:30 · Infante', cantidad: 1, precio_unitario: '0.00' },
];

/** El primer elemento de la respuesta de node-soap, con sus líneas siempre como arreglo. */
const factura = (r: [{ factura: Record<string, unknown> & { lineas: { linea: unknown } } }]) => {
  const f = r[0].factura;
  return { ...f, lineas: Array.isArray(f.lineas.linea) ? f.lineas.linea : [f.lineas.linea] } as Record<string, unknown> & { lineas: Record<string, unknown>[] };
};
const faultDe = (e: { root?: { Envelope?: { Body?: { Fault?: { faultstring: string; detail: { status: string; code: string } } } } } }) => e.root!.Envelope!.Body!.Fault!;

describeDb('ms_invoicing (SOAP)', () => {
  let app: NestExpressApplication;
  let url: string;
  let cliente: soap.Client & Record<string, (a: unknown) => Promise<[never]>>;

  beforeAll(async () => {
    Object.assign(process.env, { SERVICIOS_TOKEN: TOKEN, JWT_SECRET: SECRETO });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-invoicing');
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cliente = (await soap.createClientAsync(`${url}/soap/facturacion?wsdl`, { endpoint: `${url}/soap/facturacion` })) as never;
    cliente.addHttpHeader('X-Servicio-Token', TOKEN);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('el WSDL se publica sin token y declara las 3 operaciones', async () => {
    const r = await request(url).get('/soap/facturacion?wsdl');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<operation name="EmitirFactura">');
    expect(Object.keys(cliente.describe().FacturacionService.FacturacionPort)).toEqual(['EmitirFactura', 'ObtenerFactura', 'AnularFactura']);
  });

  it('EmitirFactura: 001-001-<ord_id>, PAGADA, una línea por línea de la orden, totales y clave SRI válida', async () => {
    const f = factura(await cliente.EmitirFacturaAsync({ ord_id: 123, comprador, lineas: { linea: lineas } }));
    expect(f).toMatchObject({ fac_numero: '001-001-000000123', ord_id: 123, estado: 'PAGADA', subtotal: '175.00', descuento: '0.00', iva: '0.00', total: '175.00' });
    expect(f.lineas.map((l) => [l.codigo, l.cantidad, l.subtotal, l.total])).toEqual([['ATR-3-AD', 2, '130.00', '130.00'], ['ATR-3-NI', 1, '45.00', '45.00'], ['ATR-3-IN', 1, '0.00', '0.00']]);
    expect(f.comprador).toMatchObject(comprador);
    expect(String(f.clave_acceso)).toMatch(/^\d{49}$/);
    expect(dvValido(String(f.clave_acceso))).toBe(true);
    expect(f.autorizacion_sri).toBe(f.clave_acceso);
    expect(dvValido(claveAcceso(new Date('2026-11-06T12:00:00Z'), 987654))).toBe(true);
  });

  it('idempotente por orden; ObtenerFactura; AnularFactura conserva el detalle', async () => {
    const otra = factura(await cliente.EmitirFacturaAsync({ ord_id: 123, comprador, lineas: { linea: [lineas[0]] } }));
    expect(otra.lineas).toHaveLength(3); // la ya emitida, no una nueva
    const una = factura(await cliente.ObtenerFacturaAsync({ ord_id: 123 }));
    expect(una.fac_id).toBe(otra.fac_id);
    const anulada = factura(await cliente.AnularFacturaAsync({ ord_id: 123, motivo: 'Reembolso total' }));
    expect(anulada).toMatchObject({ estado: 'ANULADA', total: '175.00' });
    expect(anulada.lineas).toHaveLength(3);
    // Una sola línea llega como objeto en SOAP: se normaliza a arreglo
    const sola = factura(await cliente.EmitirFacturaAsync({ ord_id: 124, comprador: { ...comprador, tipo_identificacion: 'CONSUMIDOR_FINAL', identificacion: '9999999999999' }, lineas: { linea: [{ ...lineas[0], det_id: 21, iva_porcentaje: '15' }] } }));
    expect(sola.lineas).toHaveLength(1);
    expect(sola).toMatchObject({ subtotal: '130.00', iva: '19.50', total: '149.50' });
  });

  it('errores como SOAP Fault con status y code del contrato; sin token → 401', async () => {
    const mal = await cliente.EmitirFacturaAsync({ ord_id: 200, comprador: { ...comprador, tipo_identificacion: 'DNI' }, lineas: { linea: lineas } }).catch((e: unknown) => e as never);
    expect(faultDe(mal)).toMatchObject({ faultcode: 'soap:Client', detail: { status: '400', code: 'VALIDATION_FAILED' } });
    const no = await cliente.ObtenerFacturaAsync({ ord_id: 999 }).catch((e: unknown) => e as never);
    expect(faultDe(no)).toMatchObject({ detail: { status: '404', code: 'NOT_FOUND' } });

    const sinToken = await request(url).post('/soap/facturacion').set('content-type', 'text/xml').send('<x/>');
    expect(sinToken.status).toBe(401);
    expect(sinToken.text).toContain('<code>UNAUTHORIZED</code>');
  });

  it('REST de consulta solo para ADMIN', async () => {
    expect((await request(url).get('/api/v1/facturas?ord_id=123')).status).toBe(401);
    const r = await request(url).get('/api/v1/facturas?ord_id=123').set('Authorization', `Bearer ${jwt('ADMIN')}`);
    expect(r.status).toBe(200);
    expect(r.body.lineas).toHaveLength(3);
    expect((await request(url).get('/api/v1/health')).body.status).toBeDefined();
  });
});
