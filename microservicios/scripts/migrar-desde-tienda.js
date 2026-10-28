/* eslint-disable */
/**
 * Copia los datos de la tienda (base monolítica) a las bases de ms_location, ms_catalog y ms_review,
 * CONSERVANDO LOS MISMOS IDs (atr_id, atr_uuid, ciu_id, cat_id…). Así una atracción tiene el mismo UUID
 * en el catálogo (ms_catalog) y en las reservas (tienda), y Booking no nota la migración.
 *
 *   npm run migrar            (desde microservicios/; construye los servicios y copia)
 *
 * Variables (con sus valores por defecto de docker compose):
 *   TIENDA_DATABASE_URL   postgresql://postgres:postgres@localhost:5433/booking_db
 *   LOCATION_DATABASE_URL postgresql://postgres:postgres@localhost:5434/ms_location
 *   CATALOG_DATABASE_URL  postgresql://postgres:postgres@localhost:5434/ms_catalog
 *   REVIEW_DATABASE_URL   postgresql://postgres:postgres@localhost:5434/ms_review
 *   LOCATION_DB_SCHEMA, CATALOG_DB_SCHEMA, REVIEW_DB_SCHEMA  schema de cada servicio si comparten base (Supabase)
 *   DB_SSL=true           conexiones con TLS (Supabase)
 *
 * Se puede repetir: vacía las tablas de destino y vuelve a copiar (útil mientras la tienda siga siendo la
 * que edita el catálogo). Las tablas de eventos (inbox/outbox) no se tocan.
 */
const { Pool } = require('pg');
const { join } = require('path');

const URLS = {
  tienda: process.env.TIENDA_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/booking_db',
  location: process.env.LOCATION_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/ms_location',
  catalog: process.env.CATALOG_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/ms_catalog',
  review: process.env.REVIEW_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/ms_review',
};

const SCHEMAS = {
  location: process.env.LOCATION_DB_SCHEMA,
  catalog: process.env.CATALOG_DB_SCHEMA,
  review: process.env.REVIEW_DB_SCHEMA,
};
for (const v of Object.values(SCHEMAS)) if (v && !/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error(`Schema inválido: ${v}`);

/** Inserta filas (objetos con nombres de columna) conservando las columnas identidad. */
async function insertar(c, tabla, filas) {
  if (!filas.length) return 0;
  const cols = Object.keys(filas[0]);
  await c.query(
    `INSERT INTO ${tabla} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE
     SELECT ${cols.join(', ')} FROM json_populate_recordset(NULL::${tabla}, $1::json)`,
    [JSON.stringify(filas)],
  );
  return filas.length;
}

/** Deja la secuencia de la columna identidad después del mayor id copiado. */
async function ajustarIdentidad(c, tabla, col) {
  await c.query(`SELECT setval(pg_get_serial_sequence('${tabla}', '${col}'), GREATEST((SELECT COALESCE(MAX(${col}), 0) FROM ${tabla}), 1), (SELECT COUNT(*) > 0 FROM ${tabla}))`);
}

async function enTransaccion(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const pools = Object.fromEntries(Object.entries(URLS).map(([k, url]) => {
    const pool = new Pool({ connectionString: url, max: 2, ssl });
    if (SCHEMAS[k]) pool.on('connect', (c) => void c.query(`SET search_path TO ${SCHEMAS[k]}, extensions, public`));
    return [k, pool];
  }));
  const t = (sql, p) => pools.tienda.query(sql, p).then((r) => r.rows);
  try {
    // Cada servicio con sus migraciones aplicadas (las mismas que corre al arrancar)
    for (const s of ['location', 'catalog', 'review']) {
      const { aplicarMigraciones } = require(join(__dirname, '..', `ms-${s}`, 'dist', 'comun', 'migrador.js'));
      process.env.DB_SCHEMA = SCHEMAS[s] ?? '';
      await aplicarMigraciones(pools[s], join(__dirname, '..', `ms-${s}`, 'sql'));
    }

    // ── ms_location ──
    const loc = await enTransaccion(pools.location, async (c) => {
      await c.query('TRUNCATE ciudad, provincia, region RESTART IDENTITY CASCADE');
      const n = {
        region: await insertar(c, 'region', await t('SELECT reg_id, reg_nombre, reg_codigo FROM region ORDER BY reg_id')),
        provincia: await insertar(c, 'provincia', await t('SELECT prov_id, prov_nombre, prov_codigo, reg_id, prov_activa FROM provincia ORDER BY prov_id')),
        ciudad: await insertar(c, 'ciudad', await t('SELECT ciu_id, ciu_nombre, ciu_codigo, prov_id, ciu_activa, ciu_descripcion, ciu_imagen FROM ciudad ORDER BY ciu_id')),
      };
      for (const [tabla, col] of [['region', 'reg_id'], ['provincia', 'prov_id'], ['ciudad', 'ciu_id']]) await ajustarIdentidad(c, tabla, col);
      return n;
    });
    console.log('ms_location:', loc);

    // ── ms_catalog ──
    const cat = await enTransaccion(pools.catalog, async (c) => {
      await c.query(`TRUNCATE tarifa_vigente, atraccion_itinerario, atraccion_foto, atraccion_inclusion, atraccion_idioma, atraccion_categoria,
                              atraccion, operador_usuario, operador, categoria, idioma, inclusion RESTART IDENTITY CASCADE`);
      const n = {};
      n.operador = await insertar(c, 'operador', await t(`SELECT ope_id, ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id,
                                                                 ope_activo, ope_creado_en, ope_actualizado_en FROM operador ORDER BY ope_id`));
      n.operador_usuario = await insertar(c, 'operador_usuario', await t('SELECT ope_id, usu_id, opeu_cargo, opeu_activo FROM operador_usuario'));
      // Primero los padres: la FK cat_padre_id es interna
      n.categoria = await insertar(c, 'categoria', await t(`SELECT cat_id, cat_padre_id, cat_nombre, cat_slug, cat_descripcion, COALESCE(cat_icono, 'map-pin') AS cat_icono,
                                                                   cat_orden, cat_activa, cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia
                                                              FROM categoria ORDER BY cat_padre_id NULLS FIRST, cat_id`));
      n.idioma = await insertar(c, 'idioma', await t('SELECT idi_id, idi_codigo, idi_nombre FROM idioma ORDER BY idi_id'));
      n.inclusion = await insertar(c, 'inclusion', await t('SELECT inc_id, inc_tipo, inc_nombre, inc_orden FROM inclusion ORDER BY inc_id'));
      n.atraccion = await insertar(c, 'atraccion', await t(`
        SELECT a.atr_id, a.atr_uuid, a.atr_nombre, a.atr_slug, a.atr_descripcion, a.atr_descripcion_corta, a.atr_tipo, a.atr_estado,
               a.atr_latitud, a.atr_longitud, a.atr_direccion, a.atr_punto_encuentro, a.atr_duracion_horas, a.atr_moneda, a.ciu_id, a.ope_id,
               a.atr_cancelacion_gratuita, a.atr_horas_cancelacion, a.atr_destacada, a.atr_calificacion_promedio, a.atr_numero_resenas,
               a.atr_creado_en, a.atr_actualizado_en, a.atr_eliminado_en,
               a.atr_incluye_comida, a.atr_incluye_transporte, a.atr_incluye_guia, a.atr_accesible_silla, a.atr_accesible_coche,
               a.atr_animales_servicio, a.atr_guia, a.atr_instrucciones_llegada, a.atr_permite_paquete, a.atr_descuento_paquete,
               p.l AS atr_pilar_limpieza, p.s AS atr_pilar_servicio, p.v AS atr_pilar_relacion_valor, p.u AS atr_pilar_puntualidad
          FROM atraccion a
          LEFT JOIN LATERAL (SELECT round(avg(COALESCE(ren_limpieza, ren_puntuacion)), 2) l, round(avg(COALESCE(ren_servicio, ren_puntuacion)), 2) s,
                                    round(avg(COALESCE(ren_relacion_valor, ren_puntuacion)), 2) v, round(avg(COALESCE(ren_puntualidad, ren_puntuacion)), 2) u
                               FROM resena r WHERE r.atr_id = a.atr_id AND r.ren_visible) p ON TRUE
         ORDER BY a.atr_id`));
      n.atraccion_categoria = await insertar(c, 'atraccion_categoria', await t('SELECT atr_id, cat_id FROM atraccion_categoria'));
      n.atraccion_idioma = await insertar(c, 'atraccion_idioma', await t('SELECT atr_id, idi_id FROM atraccion_idioma'));
      n.atraccion_inclusion = await insertar(c, 'atraccion_inclusion', await t('SELECT atr_id, inc_id FROM atraccion_inclusion'));
      n.atraccion_foto = await insertar(c, 'atraccion_foto', await t(`SELECT f.fot_id, f.atr_id, f.fot_url, COALESCE(NULLIF(f.fot_alt, ''), a.atr_nombre) AS fot_alt, f.fot_orden
                                                                       FROM atraccion_foto f JOIN atraccion a ON a.atr_id = f.atr_id ORDER BY f.fot_id`));
      n.atraccion_itinerario = await insertar(c, 'atraccion_itinerario', await t(`SELECT iti_id, atr_id, iti_orden, iti_hora, iti_titulo, iti_descripcion, iti_duracion_min, iti_lugar
                                                                                   FROM atraccion_itinerario ORDER BY iti_id`));
      // Proyección de precios: la tarifa vigente hoy de cada tipo (ms_pricing la mantendrá con PRECIO_ACTUALIZADO)
      n.tarifa_vigente = await insertar(c, 'tarifa_vigente', await t(`
        SELECT DISTINCT ON (atr_id, tar_tipo) atr_id, tar_tipo AS tav_tipo, tar_precio AS tav_precio, tar_moneda AS tav_moneda
          FROM tarifa
         WHERE tar_vigente_desde <= (now() AT TIME ZONE 'America/Guayaquil')::date
           AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= (now() AT TIME ZONE 'America/Guayaquil')::date)
         ORDER BY atr_id, tar_tipo, tar_vigente_desde DESC`));
      for (const [tabla, col] of [['operador', 'ope_id'], ['categoria', 'cat_id'], ['idioma', 'idi_id'], ['inclusion', 'inc_id'], ['atraccion', 'atr_id'],
        ['atraccion_foto', 'fot_id'], ['atraccion_itinerario', 'iti_id']]) await ajustarIdentidad(c, tabla, col);
      return n;
    });
    console.log('ms_catalog:', cat);

    // ── ms_review ── (regla del script: con usu_id, ren_autor_nombre va NULL)
    const rev = await enTransaccion(pools.review, async (c) => {
      await c.query('TRUNCATE resena RESTART IDENTITY');
      const n = {
        resena: await insertar(c, 'resena', await t(`SELECT ren_id, atr_id, usu_id, CASE WHEN usu_id IS NULL THEN ren_autor_nombre END AS ren_autor_nombre,
                                                            ren_puntuacion, ren_comentario, ren_visible, ren_creado_en,
                                                            ren_limpieza, ren_servicio, ren_relacion_valor, ren_puntualidad
                                                       FROM resena ORDER BY ren_id`)),
      };
      await ajustarIdentidad(c, 'resena', 'ren_id');
      return n;
    });
    console.log('ms_review:', rev);
    console.log('Listo: las bases de los microservicios tienen los datos de la tienda con los mismos IDs.');
  } finally {
    await Promise.all(Object.values(pools).map((p) => p.end()));
  }
}

main().catch((e) => {
  console.error('La migración falló:', e.message);
  process.exit(1);
});
