import { PROBLEMAS, tipoError } from './problem-types';

describe('Tipos de problema resolubles (V2-SEG-02)', () => {
  const antes = process.env.PUBLIC_URL;
  afterEach(() => { process.env.PUBLIC_URL = antes; });

  it('las URIs apuntan al propio dominio de la API, nunca a un dominio ajeno', () => {
    process.env.PUBLIC_URL = 'https://sistemaatracciones-backend.vercel.app/';
    expect(tipoError('validation')).toBe('https://sistemaatracciones-backend.vercel.app/api/v1/errores/validation');
    expect(tipoError(404)).toBe('https://sistemaatracciones-backend.vercel.app/api/v1/errores/404');
    expect(tipoError('x')).not.toMatch(/booking-hub/);
  });

  it('cada tipo del catálogo tiene título, descripción y estado HTTP', () => {
    for (const [tipo, p] of Object.entries(PROBLEMAS)) {
      expect(p.titulo.length).toBeGreaterThan(3);
      expect(p.descripcion.length).toBeGreaterThan(10);
      expect(p.status).toBeGreaterThanOrEqual(400);
      expect(tipo).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
