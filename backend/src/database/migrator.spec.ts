import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { leerMigraciones, SQL_DIR } from './migrator';

describe('Migraciones SQL-first', () => {
  it('se aplican en orden numérico y cada una tiene checksum', () => {
    const m = leerMigraciones();
    expect(m.map((x) => x.nombre)).toEqual(['001_modelo_relacional.sql', '002_seguridad.sql']);
    m.forEach((x) => expect(x.checksum).toMatch(/^[0-9a-f]{64}$/));
  });

  it('001 es una copia exacta de database/01_esquema.sql (no pueden separarse)', () => {
    const original = join(__dirname, '..', '..', '..', 'database', '01_esquema.sql');
    if (!existsSync(original)) return; // en el despliegue solo existe la copia del backend
    const norm = (s: string) => s.replace(/\r\n/g, '\n');
    expect(norm(readFileSync(join(SQL_DIR, '001_modelo_relacional.sql'), 'utf8'))).toBe(norm(readFileSync(original, 'utf8')));
  });

  it('el modelo corrige el trigger de actualizado_en (columnas con prefijo)', () => {
    const sql = readFileSync(join(SQL_DIR, '001_modelo_relacional.sql'), 'utf8');
    expect(sql).not.toMatch(/NEW\.actualizado_en\s*:=/);
    expect(sql).toMatch(/fn_actualizar_timestamp\(%L\)/);
  });
});
