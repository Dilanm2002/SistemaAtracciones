import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { readdirSync, readFileSync, statSync } from 'fs';
import { load } from 'js-yaml';
import { join } from 'path';

/**
 * API-015 — El contrato es la especificación normativa (API-First). Este test compara las
 * operaciones de contracts/atracciones-openapi.yaml con las rutas que Nest registra de verdad:
 *  1. Todo lo que promete el contrato está implementado (mismo método y ruta).
 *  2. Toda ruta implementada está en el contrato o declarada como INTERNA (panel de
 *     administración, autenticación, catálogos…) en contracts/operaciones-internas.json.
 *  3. La lista de internas no tiene entradas obsoletas.
 * Así una ruta nueva sin documentar, o una promesa del contrato sin implementar, rompe CI.
 * Lo mismo para los contratos con Booking: v2 (atracciones-openapi-v2.yaml) y v3 (atracciones-openapi-v3.yaml)
 * se comparan con los controladores de esas versiones (/api/v2, /api/v3) y se distinguen con «/v2» y «/v3».
 */
const RAIZ = join(__dirname, '..');
const norm = (p: string) => ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '').replace(/:[\w]+/g, '{}').replace(/\{[\w]+\}/g, '{}') || '/';
const METODOS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? archivos(p) : /\.ts$/.test(f) && !/\.spec\.ts$/.test(f) ? [p] : [];
  });
}

function implementadas(): Set<string> {
  const ops = new Set<string>();
  for (const f of archivos(join(RAIZ, 'src', 'modules'))) {
    const mod = require(f) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-require-imports
    for (const cls of Object.values(mod)) {
      if (typeof cls !== 'function' || !Reflect.getMetadata('__controller__', cls)) continue;
      const bases = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
      const versiones = ([] as string[]).concat(Reflect.getMetadata(VERSION_METADATA, cls) ?? []).filter((v) => v === '2' || v === '3');
      const prefijos = versiones.length ? versiones.map((v) => `/v${v}`) : [''];
      const proto = (cls as { prototype: object }).prototype;
      for (const nombre of Object.getOwnPropertyNames(proto)) {
        const handler = (proto as Record<string, unknown>)[nombre];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const metodo = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const rutas = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        for (const pre of prefijos) for (const b of bases) for (const r of rutas) ops.add(`${metodo} ${pre}${norm(`${b}/${r}`)}`);
      }
    }
  }
  return ops;
}

function delContrato(): Set<string> {
  const ops = new Set<string>();
  for (const [archivo, prefijo] of [['atracciones-openapi.yaml', ''], ['atracciones-openapi-v2.yaml', '/v2'], ['atracciones-openapi-v3.yaml', '/v3']]) {
    // json: el v3 oficial de Booking repite claves en TimeSlotItem; se toma la última (solo se leen las rutas)
    const doc = load(readFileSync(join(RAIZ, 'contracts', archivo), 'utf8'), { json: true }) as { paths: Record<string, Record<string, unknown>> };
    for (const [ruta, item] of Object.entries(doc.paths)) {
      for (const m of METODOS) if (item[m]) ops.add(`${m.toUpperCase()} ${prefijo}${norm(ruta)}`);
    }
  }
  return ops;
}

describe('Cobertura del contrato OpenAPI frente a la implementación (API-015)', () => {
  const impl = implementadas();
  const contrato = delContrato();
  const internas = new Set(
    Object.values((JSON.parse(readFileSync(join(RAIZ, 'contracts', 'operaciones-internas.json'), 'utf8')) as { grupos: Record<string, string[]> }).grupos).flat().map((o) => {
      const [m, r] = o.split(' ');
      const v = /^\/(v[23])\//.exec(r)?.[1];
      return v ? `${m} /${v}${norm(r.slice(3))}` : `${m} ${norm(r)}`;
    }),
  );

  it('encuentra las rutas de los controladores', () => {
    expect(impl.size).toBeGreaterThan(40);
    expect(contrato.size).toBeGreaterThan(10);
  });

  it('todo lo que declara el contrato está implementado', () => {
    expect([...contrato].filter((o) => !impl.has(o))).toEqual([]);
  });

  it('toda ruta implementada está en el contrato o declarada como interna', () => {
    expect([...impl].filter((o) => !contrato.has(o) && !internas.has(o)).sort()).toEqual([]);
  });

  it('la lista de operaciones internas no tiene entradas obsoletas ni repetidas del contrato', () => {
    expect([...internas].filter((o) => !impl.has(o) || contrato.has(o))).toEqual([]);
  });
});
