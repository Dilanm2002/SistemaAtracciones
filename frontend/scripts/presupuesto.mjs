/**
 * Presupuesto de peso para móviles (MOV-010): falla el CI si la primera visita vuelve a engordar.
 * Mide el build real (dist/) comprimido con gzip, que es como lo sirve Vercel.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const kb = (b) => b / 1024;
const gz = (archivo) => gzipSync(readFileSync(join(DIST, archivo))).length;
const refs = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\//, ''));

const js = refs(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g);
const css = refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g);
const assets = readdirSync(join(DIST, 'assets'));
const fuentes = assets.filter((f) => f.endsWith('.woff2'));
const hero = assets.find((f) => /^hero-1280-.*\.avif$/.test(f));

const medidas = [
  ['JavaScript inicial (gzip)', kb(js.reduce((s, f) => s + gz(f), 0)), 200],
  ['CSS inicial (gzip)', kb(css.reduce((s, f) => s + gz(f), 0)), 40],
  ['Hero que baja un teléfono (AVIF 1280 px)', kb(statSync(join(DIST, 'assets', hero)).size), 60],
  ['Fuentes (todas)', kb(fuentes.reduce((s, f) => s + statSync(join(DIST, 'assets', f)).size, 0)), 120],
  ['Archivos de fuente', fuentes.length, 4],
  ['Hojas de estilo externas (Google Fonts…)', (html.match(/<link[^>]+rel="stylesheet"[^>]+href="https?:/g) ?? []).length, 0],
];

let falla = false;
for (const [que, valor, max] of medidas) {
  const ok = valor <= max;
  falla ||= !ok;
  console.log(`${ok ? '✔' : '✖'} ${que}: ${Number.isInteger(valor) ? valor : valor.toFixed(1)} (máx. ${max})`);
}
if (falla) {
  console.error('\nSe superó el presupuesto de peso móvil (AUDITORIA.MOVIL · MOV-010).');
  process.exit(1);
}
