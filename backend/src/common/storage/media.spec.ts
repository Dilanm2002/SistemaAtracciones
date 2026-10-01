import { firmaValida, firmarMedia, objetoValido } from './media';

describe('Fotos del bucket privado (SEG-008)', () => {
  const secreto = 'x'.repeat(40);

  it('el enlace firmado vale solo para ese objeto y hasta que vence (2 h)', () => {
    const ahora = Date.now();
    const t = firmarMedia('a1b2.jpg', secreto, ahora);
    expect(firmaValida('a1b2.jpg', t, secreto, ahora)).toBe(true);
    expect(firmaValida('otra.jpg', t, secreto, ahora)).toBe(false);
    expect(firmaValida('a1b2.jpg', t, 'y'.repeat(40), ahora)).toBe(false);
    expect(firmaValida('a1b2.jpg', t, secreto, ahora + 2 * 3600_000 + 1000)).toBe(false);
    expect(firmaValida('a1b2.jpg', undefined, secreto, ahora)).toBe(false);
    expect(firmaValida('a1b2.jpg', 'basura', secreto, ahora)).toBe(false);
  });

  it('solo nombres de imagen seguros (sin rutas arbitrarias)', () => {
    expect(objetoValido('3f0c2c1e-8a4b-4c1d-9e2f-5b6a7c8d9e0f.jpg')).toBe(true);
    expect(objetoValido('catalogo/mitad-mundo.jpg')).toBe(true);
    expect(objetoValido('../secreto.jpg')).toBe(false);
    expect(objetoValido('otra/carpeta.jpg')).toBe(false);
    expect(objetoValido('archivo.html')).toBe(false);
  });
});
