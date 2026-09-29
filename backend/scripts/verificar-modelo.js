/* eslint-disable no-console */
/**
 * Ejecuta database/02_verificacion.sql contra DATABASE_URL e informa el resultado.
 * Una verificación PASA cuando no devuelve filas (V-12 y V-13 son informativas).
 * Uso: npm run db:verify   (termina con código 1 si alguna falla)
 */
require('dotenv/config');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

async function main() {
  const archivo = join(__dirname, '..', '..', 'database', '02_verificacion.sql');
  if (!existsSync(archivo)) throw new Error(`No se encontró ${archivo}`);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const avisos = [];
  client.on('notice', (n) => avisos.push(n.message));
  await client.connect();
  try {
    const resultados = [].concat(await client.query(readFileSync(archivo, 'utf8')));
    const fallos = resultados
      .flatMap((r) => r.rows ?? [])
      .filter((f) => typeof f.verificacion === 'string' && /^V-(?!12|13)/.test(f.verificacion));
    const casos = avisos.filter((a) => /^CASO/.test(a));
    casos.forEach((c) => console.log(`  ${c}`));
    if (fallos.length) {
      console.error(`\n${fallos.length} verificación(es) con filas:`);
      fallos.forEach((f) => console.error('  ✘', JSON.stringify(f)));
      process.exitCode = 1;
    } else {
      console.log(`\nModelo verificado: 0 filas en V-01…V-11 y V-15; ${casos.length} casos funcionales OK.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Error al verificar el modelo:', e.message);
  process.exit(1);
});
