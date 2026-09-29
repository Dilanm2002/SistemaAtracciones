import { detectarImagen } from './storage.service';

describe('detectarImagen (SEG-007)', () => {
  it('reconoce JPEG, PNG y WebP por sus bytes', () => {
    expect(detectarImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe('.jpg');
    expect(detectarImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))?.ext).toBe('.png');
    expect(detectarImagen(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))?.ext).toBe('.webp');
  });

  it('rechaza HTML y SVG aunque se declaren como imagen', () => {
    expect(detectarImagen(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectarImagen(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
  });
});
