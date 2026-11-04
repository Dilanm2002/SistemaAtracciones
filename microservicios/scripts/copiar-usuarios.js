/**
 * Copia las cuentas de la tienda a ms_identity para que un turista de Booking con el mismo correo o documento
 * se reconozca y no se duplique. Se puede repetir: quien ya exista se deja como está. No copia contraseñas:
 * el inicio de sesión sigue en la tienda. Abre solo 2 conexiones, así que cabe en el pooler con todo encendido.
 *
 * Variables: TIENDA_DATABASE_URL, IDENTITY_DATABASE_URL, IDENTITY_DB_SCHEMA (opcional), DB_SSL.
 */
const { Client } = require('pg');

const CUENTA_TECNICA = 'integracion.booking@descubre-ec.com';

async function main() {
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const tienda = new Client({ connectionString: process.env.TIENDA_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/booking_db', ssl });
  const identidad = new Client({ connectionString: process.env.IDENTITY_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/ms_identity', ssl });
  await tienda.connect();
  await identidad.connect();
  try {
    const schema = process.env.IDENTITY_DB_SCHEMA;
    if (schema) {
      if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('IDENTITY_DB_SCHEMA inválido');
      await identidad.query(`SET search_path TO ${schema}, extensions, public`);
    }
    const { rows } = await tienda.query(
      `SELECT lower(usu_correo) AS correo, usu_nombre, usu_apellido, usu_documento, usu_telefono, usu_creado_en
         FROM usuario WHERE lower(usu_correo) <> $1 ORDER BY usu_id`,
      [CUENTA_TECNICA],
    );
    let copiados = 0;
    for (const u of rows) {
      const doc = /^[A-Z0-9]{5,20}$/.test(u.usu_documento ?? '') ? u.usu_documento : null;
      const tel = /^\+?[0-9]{7,15}$/.test(u.usu_telefono ?? '') ? u.usu_telefono : null;
      const r = await identidad.query(
        `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_documento, usu_telefono, usu_origen, usu_creado_en)
         VALUES ($1, '!', $2, $3, $4, $5, 'WEB', $6) ON CONFLICT DO NOTHING`,
        [u.correo, u.usu_nombre, u.usu_apellido, doc, tel, u.usu_creado_en],
      );
      copiados += r.rowCount;
    }
    console.log(`ms_identity: ${copiados} cuentas nuevas de ${rows.length}`);
  } finally {
    await tienda.end();
    await identidad.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
