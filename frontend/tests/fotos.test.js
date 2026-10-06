import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fotoProps, SIZES, srcSetFoto } from '../src/utils/fotos.js';

describe('fotos en el ancho justo (MOV-002)', () => {
  const API = 'https://sistemaatracciones-backend.vercel.app';

  it('foto de ejemplo: variantes WebP estáticas de 480 y 960 px', () => {
    assert.equal(srcSetFoto(`${API}/img/quilotoa.jpg`), `${API}/img/w480/quilotoa.webp 480w, ${API}/img/w960/quilotoa.webp 960w`);
  });

  it('foto subida: la API la reduce con ?w=, conservando el token de vista previa', () => {
    assert.equal(srcSetFoto(`${API}/api/v1/media/abc.jpg`), `${API}/api/v1/media/abc.jpg?w=480 480w, ${API}/api/v1/media/abc.jpg?w=960 960w`);
    assert.match(srcSetFoto('/api/v1/media/abc.jpg?t=1.x'), /abc\.jpg\?t=1\.x&w=480 480w/);
  });

  it('la galería incluye además la original para pantallas grandes', () => {
    assert.match(srcSetFoto(`${API}/img/quilotoa.jpg`, { completa: true }), /quilotoa\.jpg 1280w$/);
    assert.match(srcSetFoto('/api/v1/media/abc.jpg', { completa: true }), /abc\.jpg 1600w$/);
  });

  it('otras URL (blob:, externas, vacías) se usan tal cual, sin srcset', () => {
    assert.equal(srcSetFoto('blob:https://x/123'), undefined);
    assert.equal(srcSetFoto('https://otra.com/foto.png?x=1'), undefined);
    assert.equal(srcSetFoto(undefined), undefined);
    assert.deepEqual(fotoProps('blob:https://x/123', SIZES.tarjeta), { src: 'blob:https://x/123' });
  });

  it('fotoProps entrega src, srcSet y sizes para un <img>', () => {
    const p = fotoProps(`${API}/img/a.jpg`, SIZES.tarjeta);
    assert.equal(p.src, `${API}/img/a.jpg`);
    assert.equal(p.sizes, SIZES.tarjeta);
    assert.ok(p.srcSet.includes('w960/a.webp 960w'));
  });
});
