import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  correo,
  mascaraCorreo,
  documento,
  esCedulaEc,
  esRucEc,
  fecha,
  hora,
  limpiar,
  mascaraNumero,
  nombrePersona,
  numero,
  password,
  ruc,
  telefono,
  texto,
} from '../src/utils/validation.js';

/**
 * Validación de formularios: deben coincidir con la API (backend/src/common/utils/validators.ts
 * y los DTO). Los casos son los mismos de backend/src/common/utils/validators.spec.ts.
 */
describe('cédula y RUC ecuatorianos (igual que la API)', () => {
  it('cédula: dígito verificador módulo 10, provincia 01-24 o 30, tercer dígito 0-5', () => {
    for (const ok of ['1710034065', '0926687856', '1712345675']) assert.equal(esCedulaEc(ok), true, ok);
    for (const mal of ['1710034060', '2510034065', '1760034065', '171003406', '17100340655', 'abcdefghij', '']) assert.equal(esCedulaEc(mal), false, mal);
  });

  it('documento(): mensajes específicos y opcional por defecto', () => {
    assert.equal(documento(''), null);
    assert.match(documento('', { requerido: true }), /obligatoria/);
    assert.match(documento('17100340a5'), /solo puede tener números/);
    assert.match(documento('171003406'), /exactamente 10/);
    assert.match(documento('9910034065'), /provincia/);
    assert.match(documento('1710034060'), /verificador/);
    assert.equal(documento('1710034065'), null);
  });

  it('RUC: 13 dígitos, provincia válida, tercer dígito 0-6 o 9, establecimiento 001+', () => {
    for (const ok of ['1792345678001', '2090123456001', '0190345678001']) assert.equal(esRucEc(ok), true, ok);
    for (const mal of ['1792345678000', '9992345678001', '1782345678001', '179234567800', '']) assert.equal(esRucEc(mal), false, mal);
    assert.equal(ruc(''), null);
    assert.match(ruc('123'), /RUC no válido/);
  });
});

describe('teléfono ecuatoriano', () => {
  it('celular 09 + 8 dígitos, fijo 0[2-7] + 7 dígitos; tolera espacios y guiones', () => {
    for (const ok of ['0991234567', '022345678', '072845123', '099 123 4567', '02-234-5678']) assert.equal(telefono(ok), null, ok);
  });
  it('rechaza con el motivo concreto', () => {
    assert.match(telefono('+593991234567'), /solo puede tener números/);
    assert.match(telefono('991234567'), /empieza con 0/);
    assert.match(telefono('099123456'), /celular tiene 10/);
    assert.match(telefono('0223456789'), /fijo tiene 9/);
    assert.match(telefono('0812345678'), /no válido/);
    assert.equal(telefono(''), null);
    assert.match(telefono('', { requerido: true }), /obligatorio/);
  });
});

describe('texto libre legible (ContieneLetras / SinNumerosLargos)', () => {
  it('acepta texto normal con algunos números', () => {
    for (const ok of ['Ruta 66 hacia el volcán', 'Av. Amazonas N24-03 y Colón', 'Guía bilingüe']) assert.equal(texto(ok), null, ok);
  });
  it('rechaza relleno, solo números y repeticiones', () => {
    assert.match(texto('12312312'), /contener texto/);
    assert.match(texto('----'), /contener texto/);
    assert.match(texto('abc 1234567'), /principalmente texto/);
    assert.match(texto('aaaaaaaa bueno'), /repetido/);
    assert.match(texto('Carretera 12345', { maxDigitos: 4 }), /más de 4 números/);
  });
  it('longitudes y obligatoriedad', () => {
    assert.match(texto(''), /obligatorio/);
    assert.equal(texto('', { requerido: false }), null);
    assert.match(texto('ab', { min: 3 }), /al menos 3/);
    assert.match(texto('abcdef', { max: 5 }), /hasta 5/);
    assert.equal(texto('   hola   ', { max: 4 }), null); // se recorta antes de medir
  });
});

describe('datos personales y de cuenta', () => {
  it('nombre de persona: letras, espacios, apóstrofes, puntos y guiones', () => {
    for (const ok of ["María José", "O'Brien", 'Ana-Lucía', 'Ñusta']) assert.equal(nombrePersona(ok), null, ok);
    for (const mal of ['Maria2', 'A', '<script>', '..', 'x'.repeat(121)]) assert.notEqual(nombrePersona(mal), null, mal);
  });
  it('correo: dice qué falta mientras se escribe', () => {
    assert.match(correo('1231231231231231'), /falta la @/);
    assert.match(correo('ana@'), /dominio/);
    assert.match(correo('ana@gmail'), /dominio/);
    assert.match(correo('@gmail.com'), /usuario antes de la @/);
    assert.match(correo('a@b@c.com'), /una @/);
  });

  it('mascaraCorreo: minúsculas, sin espacios ni caracteres inválidos y una sola @', () => {
    assert.equal(mascaraCorreo('  Ana.Paz@@Gmail.COM '), 'ana.paz@gmail.com');
    assert.equal(mascaraCorreo('a@b@c.com'), 'a@bc.com');
    assert.equal(mascaraCorreo('ana(1)!#@x.ec'), 'ana1@x.ec');
  });

  it('correo', () => {
    assert.equal(correo('ana@correo.ec'), null);
    for (const mal of ['ana@', 'ana@correo', 'ana correo@x.ec', `${'a'.repeat(160)}@x.ec`]) assert.notEqual(correo(mal), null, mal);
  });
  it('contraseña: 8-72 caracteres con letras y números', () => {
    assert.equal(password('Clave123'), null);
    assert.match(password('Ab1'), /Mínimo 8/);
    assert.match(password('SoloLetras'), /letras y números/);
    assert.match(password('12345678'), /letras y números/);
    assert.match(password(`A1${'x'.repeat(71)}`), /Máximo 72/);
  });
});

describe('números, fechas y horas', () => {
  it('numero(): rango, enteros y decimales', () => {
    assert.equal(numero('10.5', { min: 0, max: 100 }), null);
    assert.match(numero('10.555'), /hasta 2 decimales/);
    assert.match(numero('1.5', { decimales: 0 }), /entero/);
    assert.match(numero('-1', { min: 0 }), /como mínimo 0/);
    assert.match(numero('20000', { max: 10000 }), /no puede superar/);
    assert.match(numero('abc'), /debe ser un número/);
    assert.match(numero(''), /obligatorio/);
    assert.equal(numero('', { requerido: false }), null);
  });
  it('mascaraNumero(): solo dígitos, coma → punto, límites de enteros y decimales', () => {
    assert.equal(mascaraNumero('12,5'), '12.5');
    assert.equal(mascaraNumero('1231231313131313'), '12312');
    assert.equal(mascaraNumero('3.14159'), '3.14');
    assert.equal(mascaraNumero('abc'), '');
    assert.equal(mascaraNumero('-5'), '5');
    assert.equal(mascaraNumero('-5', { negativo: true }), '-5');
    assert.equal(mascaraNumero('7.9', { decimales: 0 }), '7'); // sin decimales se descarta la parte decimal
  });
  it('fecha(): formato y límites', () => {
    assert.equal(fecha('2026-10-10', { min: '2026-01-01', max: '2026-12-31' }), null);
    assert.match(fecha('2025-12-31', { min: '2026-01-01' }), /anterior al 01\/01\/2026/);
    assert.match(fecha('2027-01-01', { max: '2026-12-31' }), /posterior/);
    assert.match(fecha('10/10/2026'), /no es válida/);
    assert.match(fecha('2026-13-01'), /no es válida/);
  });
  it('hora(): HH:MM 24 h', () => {
    assert.equal(hora('08:30'), null);
    assert.equal(hora('23:59'), null);
    for (const mal of ['24:00', '8:30', '08:60', '', undefined]) assert.notEqual(hora(mal), null, String(mal));
  });
  it('limpiar() deja solo los errores', () => {
    assert.deepEqual(limpiar({ a: null, b: 'x', c: undefined, d: '' }), { b: 'x' });
  });
});
