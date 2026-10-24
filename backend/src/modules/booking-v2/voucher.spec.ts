import { randomBytes } from 'crypto';
import { emitirVoucher, leerVoucher } from './voucher';

describe('voucher QR firmado (contrato v2)', () => {
  // Secretos aleatorios en cada ejecución (nunca un literal en el código)
  const secreto = randomBytes(32).toString('hex');
  const otro = randomBytes(32).toString('hex');

  it('se lee con el mismo secreto y no lleva datos personales', () => {
    const t = emitirVoucher('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'DEC-7F3K9Q', secreto);
    expect(leerVoucher(t, secreto)).toMatchObject({ r: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', c: 'DEC-7F3K9Q', t: 'voucher' });
    expect(Buffer.from(t.split('.')[1], 'base64url').toString()).not.toMatch(/@|cedula|documento/i);
  });

  it('un token alterado o de otro servidor no se acepta', () => {
    const t = emitirVoucher('id-1', 'DEC-AAAAAA', secreto);
    const [h, , f] = t.split('.');
    const falso = `${h}.${Buffer.from(JSON.stringify({ r: 'id-2', c: 'DEC-BBBBBB', t: 'voucher', iat: 1 })).toString('base64url')}.${f}`;
    expect(leerVoucher(falso, secreto)).toBeNull();
    expect(leerVoucher(t, otro)).toBeNull();
    expect(leerVoucher('no-es-un-token', secreto)).toBeNull();
  });
});
