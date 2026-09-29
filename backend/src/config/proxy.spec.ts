import { confianzaProxy } from './proxy';

describe('confianzaProxy (trust proxy de Express)', () => {
  it('sin TRUST_PROXY: 1 salto solo en Vercel; expuesta directamente, ninguno', () => {
    expect(confianzaProxy(undefined, true)).toBe(1);
    expect(confianzaProxy(undefined, false)).toBe(false);
    expect(confianzaProxy('  ', false)).toBe(false);
  });

  it('TRUST_PROXY manda sobre la detección de Vercel', () => {
    expect(confianzaProxy('false', true)).toBe(false);
    expect(confianzaProxy('0', true)).toBe(false);
    expect(confianzaProxy('2', false)).toBe(2);
    expect(confianzaProxy('loopback, 10.0.0.0/8', false)).toBe('loopback, 10.0.0.0/8');
  });
});
