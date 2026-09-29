import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DuracionRazonable } from './create-atraccion.dto';
import { DetailsRequestDto } from './details-request.dto';
import { PhotoDto, PriceDto } from './nested-types.dto';
import { ReservationRequestDto, ReservationsQueryDto } from './reservation.dto';

const errores = <T extends object>(cls: new () => T, plain: object) =>
  validateSync(plainToInstance(cls, plain)).map((e) => e.property);

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('Validaciones de DTO (auditoría)', () => {
  it('DuracionRazonable: 0 < duración ≤ 720 h (API-012)', () => {
    const v = new DuracionRazonable();
    expect(v.validate('PT8H')).toBe(true);
    expect(v.validate('PT1H30M')).toBe(true);
    expect(v.validate('PT0H')).toBe(false);
    expect(v.validate('PT99999H')).toBe(false);
    expect(v.validate('PT1H75M')).toBe(false);
  });

  it('PhotoDto solo acepta http(s) o rutas propias (SEG-018)', () => {
    expect(errores(PhotoDto, { url: 'https://x.supabase.co/a.jpg' })).toEqual([]);
    expect(errores(PhotoDto, { url: '/img/cotopaxi.jpg' })).toEqual([]);
    expect(errores(PhotoDto, { url: 'javascript:alert(1)' })).toContain('url');
    expect(errores(PhotoDto, { url: 'data:image/png;base64,AAA' })).toContain('url');
  });

  it('PriceDto exige ISO 4217 en mayúsculas (CAL-012)', () => {
    expect(errores(PriceDto, { currency: 'USD', total: 10 })).toEqual([]);
    expect(errores(PriceDto, { currency: 'usd', total: 10 })).toContain('currency');
  });

  it('attraction_id debe ser UUID y q tiene tope (API-001, API-009)', () => {
    expect(errores(ReservationsQueryDto, { attraction_id: 'abc' })).toContain('attraction_id');
    expect(errores(ReservationsQueryDto, { q: 'x'.repeat(121) })).toContain('q');
    expect(errores(ReservationsQueryDto, { attraction_id: UUID, q: 'Cotopaxi' })).toEqual([]);
  });

  it('children tiene tope (API-011)', () => {
    const base = { date: '2030-01-01', ticket_count: 2, customer_name: 'Ana Pérez' };
    expect(errores(ReservationRequestDto, base)).toEqual([]);
    expect(errores(ReservationRequestDto, { ...base, children: 31 })).toContain('children');
  });

  it('details exige UUIDs, máximo 50 y solo idioma es (CAL-014, API-005)', () => {
    expect(errores(DetailsRequestDto, { attractions: ['nope'] })).toContain('attractions');
    expect(errores(DetailsRequestDto, { attractions: Array(51).fill(UUID) })).toContain('attractions');
    expect(errores(DetailsRequestDto, { attractions: [UUID], languages: ['en'] })).toContain('languages');
    expect(errores(DetailsRequestDto, { attractions: [UUID], languages: ['es'] })).toEqual([]);
  });
});
