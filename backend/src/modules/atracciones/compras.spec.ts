import { QueryFailedError } from 'typeorm';
import { CatalogosService } from '../../common/db/catalogos.service';
import { Sql } from '../../common/db/db.service';
import { codigoAleatorio, DatosCompra, registrarCompra } from './compras';
import { PaymentMethod } from './dto/reservation.dto';

/** Sql falso: registra cada sentencia y responde según la tabla del INSERT. */
function sqlFalso(fallar: (sql: string, intento: number) => unknown = () => undefined) {
  const log: { sql: string; params: unknown[] }[] = [];
  let ordenes = 0;
  const tx: Sql = {
    async query<T>(sql: string, params: unknown[] = []) {
      log.push({ sql: sql.trim(), params });
      if (/INSERT INTO orden \(/.test(sql)) {
        const error = fallar(sql, ++ordenes);
        if (error) throw error;
      }
      return [] as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      await this.query(sql, params);
      if (/INSERT INTO orden \(/.test(sql)) return { ord_id: '10' } as T;
      if (/INSERT INTO orden_detalle/.test(sql)) return { det_id: '20' } as T;
      if (/INSERT INTO reserva /.test(sql)) return { res_id: '30', res_uuid: 'uuid-30' } as T;
      if (/INSERT INTO pago /.test(sql)) return { pag_id: '40' } as T;
      return null;
    },
  };
  return { tx, log };
}

const cat = { estado: async (c: string) => c, metodoPago: async (c: string) => c } as unknown as CatalogosService;
const duplicado = () => new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

const compra = (extra: Partial<DatosCompra> = {}): DatosCompra => ({
  usuId: '1', atrId: '2', atrNombre: 'Tour', disId: '3', fecha: '2026-10-10', hora: '08:00',
  adultos: 2, ninos: 1, precioAdulto: 19.99, precioNino: 10.01, moneda: 'USD',
  metodo: PaymentMethod.TARJETA, paxNombre: 'María Guamán', ...extra,
});

describe('registrarCompra (orden → detalle → reserva → pago → factura)', () => {
  it('total redondeado a centavos y reserva CONFIRMADA + factura con tarjeta', async () => {
    const { tx, log } = sqlFalso();
    const r = await registrarCompra(tx, cat, compra());
    expect(r).toEqual({ resId: '30', uuid: 'uuid-30' });
    const orden = log.find((l) => l.sql.startsWith('INSERT INTO orden ('))!;
    expect(orden.params[5]).toBe(49.99); // 2 × 19.99 + 1 × 10.01, sin error de coma flotante
    expect(orden.params[2]).toBe('PAGADA');
    const reserva = log.find((l) => l.sql.startsWith('INSERT INTO reserva '))!;
    expect(reserva.params[3]).toBe('CONFIRMADA');
    expect(reserva.params[8]).toBe(3); // tickets
    expect(log.some((l) => l.sql.startsWith('INSERT INTO factura'))).toBe(true);
    expect(log.at(-1)!.sql).toBe('RELEASE SAVEPOINT compra');
  });

  it('transferencia: PENDIENTE_PAGO, sin factura ni referencia de pago', async () => {
    const { tx, log } = sqlFalso();
    await registrarCompra(tx, cat, compra({ metodo: PaymentMethod.TRANSFERENCIA }));
    expect(log.find((l) => l.sql.startsWith('INSERT INTO reserva '))!.params[3]).toBe('PENDIENTE_PAGO');
    expect(log.some((l) => l.sql.startsWith('INSERT INTO factura'))).toBe(false);
    const pago = log.find((l) => l.sql.startsWith('INSERT INTO pago '))!;
    expect(pago.params[3]).toBe('PENDIENTE');
    expect(pago.params[8]).toBeNull();
  });

  it('los números ORD-/DEC-/PAG- comparten sufijo', async () => {
    const { tx, log } = sqlFalso();
    await registrarCompra(tx, cat, compra({ rnd: () => 0 }));
    expect(log.find((l) => l.sql.startsWith('INSERT INTO orden ('))!.params[0]).toBe('ORD-AAAAAA');
    expect(log.find((l) => l.sql.startsWith('INSERT INTO reserva '))!.params[0]).toBe('DEC-AAAAAA');
    expect(log.find((l) => l.sql.startsWith('INSERT INTO pago '))!.params[0]).toBe('PAG-AAAAAA');
  });

  it('si el número choca (23505) reintenta con otro sufijo dentro del SAVEPOINT', async () => {
    const { tx, log } = sqlFalso((_s, intento) => (intento < 3 ? duplicado() : undefined));
    await registrarCompra(tx, cat, compra());
    expect(log.filter((l) => l.sql === 'ROLLBACK TO SAVEPOINT compra')).toHaveLength(2);
    expect(log.filter((l) => l.sql.startsWith('INSERT INTO orden ('))).toHaveLength(3);
  });

  it('se rinde tras 5 choques y no reintenta otros errores', async () => {
    await expect(registrarCompra(sqlFalso(() => duplicado()).tx, cat, compra())).rejects.toBeInstanceOf(QueryFailedError);
    const otro = sqlFalso(() => new Error('conexión perdida'));
    await expect(registrarCompra(otro.tx, cat, compra())).rejects.toThrow('conexión perdida');
    expect(otro.log.filter((l) => l.sql.startsWith('INSERT INTO orden ('))).toHaveLength(1);
  });

  it('la tarjeta guarda solo marca, últimos 4 y titular en mayúsculas', async () => {
    const { tx, log } = sqlFalso();
    await registrarCompra(tx, cat, compra({ tarjeta: { brand: 'VISA' as never, last4: '4242', holder: 'María Guamán', exp_month: 12, exp_year: 2030 } }));
    const t = log.find((l) => l.sql.startsWith('INSERT INTO pago_tarjeta'))!;
    expect(t.params).toEqual(['40', 'VISA', '4242', 'MARÍA GUAMÁN', 12, 2030]);
  });

  it('codigoAleatorio usa todo el alfabeto sin salirse de rango', () => {
    expect(codigoAleatorio(() => 0)).toBe('AAAAAA');
    expect(codigoAleatorio(() => 0.99999)).toBe('999999');
  });
});
