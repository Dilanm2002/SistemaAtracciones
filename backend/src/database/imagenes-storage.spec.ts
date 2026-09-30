import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { moverImagenesAStorage } from './imagenes-storage';

describe('Fotos del catálogo en Supabase Storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'img-'));
  writeFileSync(join(dir, 'cotopaxi.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const opciones = { url: 'https://proy.supabase.co/', key: 'clave-de-prueba', bucket: 'fotos', dir };

  afterEach(() => jest.restoreAllMocks());

  it('sube cada /img/… al bucket y guarda la URL pública en la tabla', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const sql: { sql: string; params?: unknown[] }[] = [];
    const query = jest.fn(async (s: string, params?: unknown[]) => {
      sql.push({ sql: s, params });
      return s.startsWith('SELECT') ? [{ url: '/img/cotopaxi.jpg' }, { url: '/img/no-existe.jpg' }] : [];
    });

    expect(await moverImagenesAStorage(query, opciones)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [destino, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(destino).toBe('https://proy.supabase.co/storage/v1/object/fotos/catalogo/cotopaxi.jpg');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    const publica = 'https://proy.supabase.co/storage/v1/object/public/fotos/catalogo/cotopaxi.jpg';
    expect(sql.filter((x) => x.sql.startsWith('UPDATE')).map((x) => x.params)).toEqual([
      [publica, '/img/cotopaxi.jpg'],
      [publica, '/img/cotopaxi.jpg'],
    ]);
  });

  it('sin credenciales de Supabase no toca nada (desarrollo local)', async () => {
    const query = jest.fn();
    expect(await moverImagenesAStorage(query, { url: '', key: '', dir })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
