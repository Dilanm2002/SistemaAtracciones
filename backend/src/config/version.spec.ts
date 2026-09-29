import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { API_VERSION } from './version';

/** La versión publicada vive en 4 lugares: si se sube en uno hay que subirla en todos. */
describe('Control de versiones', () => {
  const raiz = join(__dirname, '..', '..', '..');
  const leer = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

  it('es SemVer (MAYOR.MENOR.PARCHE)', () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('coincide con backend/package.json y su lockfile', () => {
    expect(JSON.parse(leer('backend', 'package.json')).version).toBe(API_VERSION);
    expect(JSON.parse(leer('backend', 'package-lock.json')).version).toBe(API_VERSION);
  });

  it('coincide con frontend/package.json y la última versión de CHANGELOG.md', () => {
    if (!existsSync(join(raiz, 'CHANGELOG.md'))) return; // en el despliegue del backend solo existe su carpeta
    expect(JSON.parse(leer('frontend', 'package.json')).version).toBe(API_VERSION);
    const ultima = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/m.exec(leer('CHANGELOG.md'));
    expect(ultima?.[1]).toBe(API_VERSION);
  });
});
