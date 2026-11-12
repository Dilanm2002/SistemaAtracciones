import { FilaReserva, politicaCancelacion } from '../src/modelo';

/** Regla oficial: reembolso del 100 % solo hasta 24 h antes de la salida; después, o con check-in, no se cancela. */
describe('política de cancelación (24 h)', () => {
  // Salida: 2030-01-10 a las 10:00 en Ecuador (UTC-5) = 15:00 UTC
  const SALIDA = Date.parse('2030-01-10T15:00:00Z');
  const H = 3_600_000;
  const fila = (extra: Partial<FilaReserva> = {}) =>
    ({ estado: 'CONFIRMADA', fecha: '2030-01-10', hora: '10:00', pago_estado: 'APROBADO', cancelacion_gratuita: true, horas_cancelacion: 48, creado_en: new Date(SALIDA - 100 * H), ...extra }) as FilaReserva;

  it('con 24 h o más de anticipación: reembolso del 100 % hasta el corte', () => {
    const p = politicaCancelacion(fila(), SALIDA - 25 * H);
    expect(p.policy).toBe('FULL_REFUND');
    expect(p.freeUntil?.toISOString()).toBe('2030-01-09T15:00:00.000Z');
  });

  it('con menos de 24 h: no se puede cancelar, aunque la atracción tenga otro plazo', () => {
    expect(politicaCancelacion(fila(), SALIDA - 23 * H)).toMatchObject({ policy: 'NOT_ALLOWED', motivo: expect.stringContaining('24 horas') });
    expect(politicaCancelacion(fila({ horas_cancelacion: 2 }), SALIDA - 10 * H).policy).toBe('NOT_ALLOWED');
  });

  it('ya empezó, o tiene check-in: no se puede cancelar', () => {
    expect((politicaCancelacion(fila(), SALIDA + H) as { motivo?: string }).motivo).toMatch(/ya comenzó/);
    expect((politicaCancelacion(fila({ estado: "CHECKED_IN" }), SALIDA - 48 * H) as { motivo?: string }).motivo).toMatch(/check-in/);
  });

  it('sin cobro todavía (pago pendiente): se cancela sin costo dentro del plazo', () => {
    expect(politicaCancelacion(fila({ pago_estado: 'PENDIENTE' }), SALIDA - 30 * H).policy).toBe('NO_CHARGE');
  });
});
