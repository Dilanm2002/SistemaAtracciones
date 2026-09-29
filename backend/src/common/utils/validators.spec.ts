import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOperadorDto } from '../../modules/atracciones/dto/catalogo.dto';
import { LocationDto, PriceDto } from '../../modules/atracciones/dto/nested-types.dto';
import { CancelReservationRequestDto, ReservationRequestDto } from '../../modules/atracciones/dto/reservation.dto';
import { RegisterDto } from '../../modules/auth/dto/auth.dto';
import { esCedulaEc, esDocumento, esRucEc, RE_NOMBRE_PERSONA } from './validators';

const errores = <T extends object>(cls: new () => T, plain: object) => validateSync(plainToInstance(cls, plain)).map((e) => e.property);
const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('Validaciones del dominio', () => {
  it('cédula ecuatoriana con dígito verificador (módulo 10)', () => {
    expect(esCedulaEc('1710034065')).toBe(true);
    expect(esCedulaEc('1712345678')).toBe(false); // verificador incorrecto
    expect(esCedulaEc('9910034065')).toBe(false); // provincia inexistente
    expect(esDocumento('AB1234567')).toBe(true);
    expect(esDocumento('123')).toBe(false);
  });

  it('RUC ecuatoriano', () => {
    expect(esRucEc('1792345678001')).toBe(true);
    expect(esRucEc('1792345678000')).toBe(false);
    expect(esRucEc('9992345678001')).toBe(false);
    expect(esRucEc('123')).toBe(false);
  });

  it('nombres de persona solo con letras', () => {
    expect(RE_NOMBRE_PERSONA.test("María José O'Neil-Pérez")).toBe(true);
    expect(RE_NOMBRE_PERSONA.test('123123')).toBe(false);
    expect(RE_NOMBRE_PERSONA.test('Ana 2')).toBe(false);
  });

  it('precio: positivo, máximo 10 000 y 2 decimales', () => {
    expect(errores(PriceDto, { currency: 'USD', total: 45.5 })).toEqual([]);
    expect(errores(PriceDto, { currency: 'USD', total: 1231231313131313 })).toContain('total');
    expect(errores(PriceDto, { currency: 'USD', total: 10.123 })).toContain('total');
  });

  it('ubicación: dirección con texto y coordenadas dentro del Ecuador', () => {
    const ok = { address: 'Parque Nacional Cotopaxi', city: 1, country: 'ec', coordinates: { latitude: -0.68, longitude: -78.43 } };
    expect(errores(LocationDto, ok)).toEqual([]);
    expect(errores(LocationDto, { ...ok, address: '123123123123123' })).toContain('address');
    expect(errores(LocationDto, { ...ok, coordinates: { latitude: 40.4, longitude: -3.7 } })).toContain('coordinates');
    expect(errores(LocationDto, { ...ok, country: 'pe' })).toContain('country');
  });

  it('reserva: nombre, documento y fecha válidos', () => {
    const base = { date: manana, ticket_count: 1, customer_name: 'Ana Pérez' };
    expect(errores(ReservationRequestDto, base)).toEqual([]);
    expect(errores(ReservationRequestDto, { ...base, customer_name: '12345' })).toContain('customer_name');
    expect(errores(ReservationRequestDto, { ...base, customer_document: '1712345678' })).toContain('customer_document');
    expect(errores(ReservationRequestDto, { ...base, date: '2020-01-01' })).toContain('date');
    expect(errores(CancelReservationRequestDto, { reason: '12345' })).toContain('reason');
  });

  it('registro y operador', () => {
    expect(errores(RegisterDto, { nombre: 'Ana', apellido: '123', email: 'a@b.ec', password: 'Clave123' })).toContain('apellido');
    expect(errores(CreateOperadorDto, { nombre: 'Tours', provincia_id: 1, ruc: '1272345678001' })).toContain('ruc');
    expect(errores(CreateOperadorDto, { nombre: '99999', provincia_id: 1 })).toContain('nombre');
  });
});
