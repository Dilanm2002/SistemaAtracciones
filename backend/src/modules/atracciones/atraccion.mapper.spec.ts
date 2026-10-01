import { ConfigService } from '@nestjs/config';
import { AtraccionMapper } from './atraccion.mapper';
import { FilaReserva } from './modelo';

describe('AtraccionMapper: reservas', () => {
  const mapper = new AtraccionMapper(new ConfigService({ PUBLIC_URL: 'https://api.test/', FRONTEND_URL: 'https://web.test' }));
  afterEach(() => jest.useRealTimers());

  // Reservada con mucha anticipación (el periodo de arrepentimiento ya pasó)
  const base = { estado: 'CONFIRMADA', fecha: '2026-10-10', hora: '08:00', cancelacion_gratuita: true, horas_cancelacion: 24, creado_en: new Date('2026-09-01T00:00:00Z') };
  // 2026-10-10 08:00 en Ecuador = 13:00 UTC
  const ahora = (iso: string) => jest.useFakeTimers().setSystemTime(new Date(iso));
  const pol = (extra: Partial<typeof base> = {}) => mapper.politicaCancelacion({ ...base, ...extra }).policy;

  it('pagada: reembolso total hasta N horas antes (hora de Ecuador); después, sin reembolso pero cancelable', () => {
    ahora('2026-10-09T12:59:00Z'); // 24 h 1 min antes
    expect(pol()).toBe('FULL_REFUND');
    ahora('2026-10-09T13:00:00Z'); // exactamente 24 h antes
    expect(pol()).toBe('NO_REFUND');
    expect(mapper.canCancel(base)).toBe(true); // puede cancelar, sin reembolso
    ahora('2026-10-10T12:00:00Z');
    expect(pol({ horas_cancelacion: 0 })).toBe('FULL_REFUND'); // margen 0: hasta la salida
  });

  it('reserva de último momento: 1 h de arrepentimiento con reembolso total, nunca después de la salida', () => {
    const creado = new Date('2026-10-10T10:00:00Z'); // reservó 3 h antes de la salida (ya dentro del plazo de 24 h)
    ahora('2026-10-10T10:30:00Z');
    expect(mapper.politicaCancelacion({ ...base, creado_en: creado })).toMatchObject({ policy: 'FULL_REFUND', freeUntil: new Date('2026-10-10T11:00:00Z') });
    ahora('2026-10-10T11:01:00Z');
    expect(pol({ creado_en: creado })).toBe('NO_REFUND');
    // Reservó 20 min antes de salir: el arrepentimiento termina a la hora de salida
    const tarde = new Date('2026-10-10T12:40:00Z');
    ahora('2026-10-10T12:50:00Z');
    expect(mapper.politicaCancelacion({ ...base, creado_en: tarde })).toMatchObject({ policy: 'FULL_REFUND', freeUntil: new Date('2026-10-10T13:00:00Z') });
  });

  it('pendiente de pago: se cancela sin costo hasta la hora de salida', () => {
    ahora('2026-10-10T12:59:00Z');
    expect(pol({ estado: 'PENDIENTE_PAGO', cancelacion_gratuita: false })).toBe('NO_CHARGE');
    ahora('2026-10-10T13:00:00Z');
    expect(pol({ estado: 'PENDIENTE_PAGO' })).toBe('NOT_ALLOWED');
  });

  it('nunca si está cancelada, completada o la experiencia ya empezó; sin cancelación gratuita → sin reembolso', () => {
    ahora('2026-09-15T00:00:00Z'); // dos semanas después de reservar
    expect(pol({ estado: 'CANCELADA_RES' })).toBe('NOT_ALLOWED');
    expect(pol({ estado: 'COMPLETADA' })).toBe('NOT_ALLOWED');
    expect(pol({ cancelacion_gratuita: false })).toBe('NO_REFUND');
    ahora('2026-10-10T13:00:00Z');
    expect(pol()).toBe('NOT_ALLOWED');
  });

  const fila = (extra: Partial<FilaReserva> = {}): FilaReserva => ({
    res_id: '1', id: 'r-uuid', codigo: 'DEC-ABCDEF', estado: 'PENDIENTE_PAGO', tickets: 2, adultos: 1, ninos: 1, total: 30, moneda: 'USD',
    fecha: '2030-01-01', hora: '09:00', observaciones: null, motivo_cancelacion: null, cancelado_en: null, creado_en: new Date('2026-01-01T00:00:00Z'),
    atr_uuid: 'a-uuid', atr_nombre: 'Tour', ciudad: 'Quito', punto_encuentro: null, direccion: 'Plaza Grande', cancelacion_gratuita: true,
    horas_cancelacion: 24, foto: '/img/x.jpg', ope_codigo: 101, usu_id: '9', correo: 'a@b.ec', telefono: null, pax_nombre: 'Ana',
    pax_documento: null, pax_correo: null, pax_telefono: null, metodo: null, ...extra,
  });

  it('toReservation: enlaces HATEOAS según el estado y URLs absolutas', () => {
    const p = mapper.toReservation(fila());
    expect(p.status).toBe('PENDING');
    expect(p._links).toMatchObject({ cancel: { method: 'POST' }, confirm: { method: 'POST' } });
    expect(p.attraction).toMatchObject({ photo: 'https://api.test/img/x.jpg', meeting_point: 'Plaza Grande' });

    const c = mapper.toReservation(fila({ estado: 'CANCELADA_RES', cancelado_en: new Date('2026-02-01T00:00:00Z'), motivo_cancelacion: 'Clima' }));
    expect(c.status).toBe('CANCELLED');
    expect(c._links?.cancel).toBeUndefined();
    expect(c._links?.confirm).toBeUndefined();
    expect(c).toMatchObject({ can_cancel: false, cancelled_at: '2026-02-01T00:00:00.000Z', cancellation_reason: 'Clima' });

    // Un estado desconocido nunca se expone como CONFIRMED
    expect(mapper.toReservation(fila({ estado: 'OTRO' })).status).toBe('PENDING');
  });

  it('absUrl / relUrl son inversas para rutas propias y no tocan URLs externas', () => {
    expect(mapper.absUrl('/uploads/a.jpg')).toBe('https://api.test/uploads/a.jpg');
    expect(mapper.absUrl('uploads/a.jpg')).toBe('https://api.test/uploads/a.jpg');
    expect(mapper.relUrl(mapper.absUrl('/uploads/a.jpg'))).toBe('/uploads/a.jpg');
    expect(mapper.absUrl('https://cdn.x/a.jpg')).toBe('https://cdn.x/a.jpg');
    expect(mapper.relUrl('https://cdn.x/a.jpg')).toBe('https://cdn.x/a.jpg');
    expect(mapper.absUrl(null)).toBe('');
  });
});
