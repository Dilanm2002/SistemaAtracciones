import { hora12, parseHora } from './hora12';

describe('horas del contrato v2 («10:30 a.m.»)', () => {
  it('24 h → 12 h con a.m./p.m.', () => {
    expect(hora12('09:05')).toBe('09:05 a.m.');
    expect(hora12('14:00')).toBe('02:00 p.m.');
    expect(hora12('00:30')).toBe('12:30 a.m.');
    expect(hora12('12:15')).toBe('12:15 p.m.');
  });

  it('interpreta lo que envía Booking y rechaza lo inválido', () => {
    for (const [txt, h] of [['10:30 a.m.', '10:30'], ['10:30 AM', '10:30'], ['2:00 p.m.', '14:00'], ['12:00 a.m.', '00:00'], ['12:30 p.m.', '12:30'], ['14:00', '14:00'], ['14:00:00', '14:00'], ['10:30am', '10:30']]) {
      expect(parseHora(txt)).toBe(h);
    }
    for (const txt of ['25:00', '13:00 p.m.', '10:61', 'diez', '', undefined]) expect(parseHora(txt)).toBeNull();
  });
});
