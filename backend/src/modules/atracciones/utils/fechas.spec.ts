import { diasDelMes, fechaHoraEc, horaActualEc, horasAIso, hoyEc, isoAHoras, sumarDias } from './fechas';

describe('Utilidades de fechas (hora de Ecuador)', () => {
  afterEach(() => jest.useRealTimers());

  it('hoyEc usa la zona de Ecuador (UTC-5), no la del servidor', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T03:30:00Z')); // 22:30 del 28-feb en Ecuador
    expect(hoyEc()).toBe('2026-02-28');
    expect(horaActualEc()).toBe('22:30');
  });

  it('fechaHoraEc interpreta la hora como Ecuador', () => {
    expect(fechaHoraEc('2026-10-10', '08:00').toISOString()).toBe('2026-10-10T13:00:00.000Z');
    expect(fechaHoraEc('2026-10-10').toISOString()).toBe('2026-10-10T05:00:00.000Z');
  });

  it('sumarDias cruza meses, años y años bisiestos', () => {
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2026-05-10', 365)).toBe('2027-05-10');
  });

  it('diasDelMes devuelve todos los días del mes (incluye febrero bisiesto)', () => {
    expect(diasDelMes('2026-02')).toHaveLength(28);
    expect(diasDelMes('2028-02')).toHaveLength(29);
    expect(diasDelMes('2026-12')).toHaveLength(31);
    expect(diasDelMes('2026-04')[0]).toBe('2026-04-01');
    expect(diasDelMes('2026-04').at(-1)).toBe('2026-04-30');
  });

  it.each([
    [2, 'PT2H'],
    [1.5, 'PT1H30M'],
    [0.25, 'PT15M'],
    [0, 'PT0H'],
    [72, 'PT72H'],
    [1.999, 'PT2H'], // redondeo a minutos: nunca "PT1H60M"
    [0.9999, 'PT1H'],
  ])('horasAIso(%p) = %s', (horas, iso) => {
    expect(horasAIso(horas)).toBe(iso);
  });

  it('isoAHoras es la inversa de horasAIso y tolera entradas inválidas', () => {
    for (const iso of ['PT2H', 'PT1H30M', 'PT45M', 'PT720H']) expect(horasAIso(isoAHoras(iso))).toBe(iso);
    expect(isoAHoras('P1D')).toBe(0);
    expect(isoAHoras('basura')).toBe(0);
  });
});
