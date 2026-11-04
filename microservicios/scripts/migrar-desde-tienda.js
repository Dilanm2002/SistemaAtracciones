/* eslint-disable */
/**
 * Copia los datos de la tienda (base monolítica) a las bases de los 11 microservicios, CONSERVANDO LOS
 * MISMOS IDs (atr_id, atr_uuid, res_uuid, ord_id, pag_id…). Así una atracción, una reserva o un pago son los
 * mismos antes y después de la migración, y Booking no la nota.
 *
 *   npm run migrar            (desde microservicios/; construye los servicios y copia)
 *
 * Variables (con sus valores por defecto de docker compose), para cada servicio S de SERVICIOS:
 *   TIENDA_DATABASE_URL   postgresql://postgres:postgres@localhost:5433/booking_db
 *   <S>_DATABASE_URL      postgresql://postgres:postgres@localhost:5434/ms_<s>   (p. ej. BOOKING_DATABASE_URL)
 *   <S>_DB_SCHEMA         schema del servicio si comparten base (Supabase)
 *   DB_SSL=true           conexiones con TLS (Supabase)
 *   MIGRAR_FORZAR=true    vuelve a copiar también los servicios transaccionales (¡borra sus datos!)
 *
 * Catálogo, ubicación y reseñas se vuelven a copiar cada vez (la tienda sigue editando el catálogo). Los
 * transaccionales (precios, inventario, cupones, órdenes, reservas, pagos, reembolsos, facturas) se copian
 * UNA vez, cuando su base está vacía: desde ahí sus datos son suyos y un redespliegue no los pisa.
 */
const { Pool } = require('pg');
const { join } = require('path');

const SERVICIOS = ['location', 'catalog', 'review', 'pricing', 'inventory', 'coupon', 'order', 'booking', 'payment', 'refund', 'invoicing'];
const URLS = {
  tienda: process.env.TIENDA_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/booking_db',
  ...Object.fromEntries(SERVICIOS.map((s) => [s, process.env[`${s.toUpperCase()}_DATABASE_URL`] ?? `postgresql://postgres:postgres@localhost:5434/ms_${s}`])),
};
const SCHEMAS = Object.fromEntries(SERVICIOS.map((s) => [s, process.env[`${s.toUpperCase()}_DB_SCHEMA`]]));
for (const v of Object.values(SCHEMAS)) if (v && !/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error(`Schema inválido: ${v}`);
const FORZAR = process.env.MIGRAR_FORZAR === 'true';

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
    const pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 1000, ssl });
    if (SCHEMAS[k]) pool.on('connect', (c) => void c.query(`SET search_path TO ${SCHEMAS[k]}, extensions, public`));
    return [k, pool];
  }));
  const t = (sql, p) => pools.tienda.query(sql, p).then((r) => r.rows);
  try {
    // Cada servicio con sus migraciones aplicadas (las mismas que corre al arrancar)
    for (const s of SERVICIOS) {
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

    // ── Servicios transaccionales: se copian UNA vez (si su tabla principal está vacía) ──
    const vacio = async (s, tabla) => FORZAR || (await pools[s].query(`SELECT NOT EXISTS (SELECT 1 FROM ${tabla}) AS v`)).rows[0].v;
    /** est_codigo de la tienda → est_id del servicio (cada uno tiene su tabla `estado`). */
    const estados = async (c, equivalencias = {}) => {
      const m = Object.fromEntries((await c.query('SELECT est_codigo, est_id FROM estado')).rows.map((r) => [r.est_codigo, r.est_id]));
      return (codigo) => m[equivalencias[codigo] ?? codigo];
    };
    const omitido = (s) => console.log(`ms_${s}: ya tiene datos propios; no se copia (MIGRAR_FORZAR=true para forzar)`);

    // ── ms_pricing ──
    if (await vacio('pricing', 'tarifa')) {
      const n = await enTransaccion(pools.pricing, async (c) => {
        await c.query('TRUNCATE tarifa RESTART IDENTITY');
        const r = { tarifa: await insertar(c, 'tarifa', await t(`SELECT tar_id, atr_id, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde, tar_vigente_hasta FROM tarifa ORDER BY tar_id`)) };
        await ajustarIdentidad(c, 'tarifa', 'tar_id');
        return r;
      });
      console.log('ms_pricing:', n);
    } else omitido('pricing');

    // ── ms_inventory ── (atraccion_ref: el UUID de cada atracción, para el stock que se envía a Booking)
    if (await vacio('inventory', 'horario')) {
      const n = await enTransaccion(pools.inventory, async (c) => {
        await c.query('TRUNCATE retencion, disponibilidad, fecha_bloqueada, horario, atraccion_ref RESTART IDENTITY CASCADE');
        const r = {
          atraccion_ref: await insertar(c, 'atraccion_ref', await t('SELECT atr_id, atr_uuid FROM atraccion ORDER BY atr_id')),
          horario: await insertar(c, 'horario', await t('SELECT hor_id, atr_id, hor_hora, hor_cupo, hor_activo FROM horario ORDER BY hor_id')),
          disponibilidad: await insertar(c, 'disponibilidad', await t(`SELECT dis_id, atr_id, hor_id, dis_fecha, dis_cupo_total, dis_cupo_reservado, dis_cerrada FROM disponibilidad ORDER BY dis_id`)),
          fecha_bloqueada: await insertar(c, 'fecha_bloqueada', await t('SELECT fb_id, atr_id, fb_fecha, fb_motivo, fb_creado_en FROM fecha_bloqueada ORDER BY fb_id')),
        };
        for (const [tabla, col] of [['horario', 'hor_id'], ['disponibilidad', 'dis_id'], ['fecha_bloqueada', 'fb_id']]) await ajustarIdentidad(c, tabla, col);
        return r;
      });
      console.log('ms_inventory:', n);
    } else omitido('inventory');

    // ── ms_coupon ── (cupones y acuerdo B2B de promociones con Booking)
    if (await vacio('coupon', 'cupon')) {
      const n = await enTransaccion(pools.coupon, async (c) => {
        await c.query('TRUNCATE cupon, acuerdo_promocion, acuerdo_promocion_destino RESTART IDENTITY CASCADE');
        const r = {
          cupon: await insertar(c, 'cupon', await t('SELECT cup_id, cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio, cup_fecha_fin, cup_usos_max, cup_activo FROM cupon ORDER BY cup_id')),
          acuerdo_promocion: await insertar(c, 'acuerdo_promocion', await t(`SELECT apr_id, apr_permite, apr_descuento_maximo, apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones,
                                                                                    apr_contacto_nombre, apr_contacto_correo, apr_contacto_telefono, apr_actualizado_en FROM acuerdo_promocion`)),
          acuerdo_promocion_destino: await insertar(c, 'acuerdo_promocion_destino', await t('SELECT apd_id, apr_id, apd_destino FROM acuerdo_promocion_destino ORDER BY apd_id')),
        };
        await ajustarIdentidad(c, 'cupon', 'cup_id');
        await ajustarIdentidad(c, 'acuerdo_promocion_destino', 'apd_id');
        return r;
      });
      console.log('ms_coupon:', n);
    } else omitido('coupon');

    // Reservas de la tienda con lo que necesitan los demás servicios (titular, tipos de boleto, pago, atracción)
    const reservas = await t(`
      SELECT r.*, e.est_codigo, dt.ord_id, a.atr_id, a.atr_uuid, a.atr_nombre, a.atr_moneda, a.atr_guia, a.atr_cancelacion_gratuita, a.atr_horas_cancelacion,
             COALESCE(a.atr_punto_encuentro, a.atr_direccion, ci.ciu_nombre) AS punto,
             o.ord_numero, pg.pag_id, ep.est_codigo AS pago_estado, mp.mpa_codigo, rm.rem_numero, rm.rem_monto,
             EXISTS (SELECT 1 FROM factura f WHERE f.ord_id = o.ord_id) AS facturada
        FROM reserva r
        JOIN estado e ON e.est_id = r.est_id
        JOIN orden_detalle dt ON dt.det_id = r.det_id
        JOIN orden o ON o.ord_id = dt.ord_id
        JOIN atraccion a ON a.atr_id = dt.atr_id
        LEFT JOIN ciudad ci ON ci.ciu_id = a.ciu_id
        LEFT JOIN metodo_pago mp ON mp.mpa_id = o.mpa_id
        LEFT JOIN LATERAL (SELECT * FROM pago p WHERE p.ord_id = o.ord_id ORDER BY p.pag_id DESC LIMIT 1) pg ON TRUE
        LEFT JOIN estado ep ON ep.est_id = pg.est_id
        LEFT JOIN reembolso rm ON rm.pag_id = pg.pag_id
       ORDER BY r.res_id`);
    const TIPOS = [['res_adultos', 'res_precio_unitario', 'AD', 'Adulto'], ['res_ninos', 'res_precio_nino', 'NI', 'Niño'], ['res_seniors', 'res_precio_senior', 'MA', 'Adulto mayor'],
      ['res_estudiantes', 'res_precio_estudiante', 'ES', 'Estudiante'], ['res_infantes', null, 'IN', 'Infante']];
    const cent = (v) => Math.round(Number(v ?? 0) * 100);
    /**
     * Precio en centavos de cada tipo de boleto de una reserva. Las reservas antiguas (antes de la migración 009
     * de la tienda) no guardaban el precio del niño, del adulto mayor ni del estudiante: si falta UNO solo, se
     * deduce del total (p. ej. (110 − 2 × 33) / 2 = 22). Si no se puede, null (la orden queda en una línea).
     */
    const preciosDe = (x) => {
      const p = TIPOS.map(([cant, precio]) => ({ cantidad: Number(x[cant] ?? 0), precio: precio === null ? 0 : x[precio] == null ? null : cent(x[precio]) }));
      const faltan = p.filter((y) => y.cantidad > 0 && y.precio === null);
      if (faltan.length === 1) {
        const resto = cent(x.res_subtotal) - p.reduce((s, y) => s + (y.precio ?? 0) * y.cantidad, 0);
        if (resto >= 0 && resto % faltan[0].cantidad === 0) faltan[0].precio = resto / faltan[0].cantidad;
      }
      return p.map((y) => y.precio);
    };
    /** det_id de cada tipo de boleto por orden (las facturas se reparten por estas líneas). */
    const lineasPorOrden = new Map();

    // ── ms_order ── Una línea por tipo de boleto (regla del script: subtotal = cantidad × precio). La de
    //   adultos conserva el det_id de la tienda (a ella apunta reserva.det_id); las demás reciben uno nuevo.
    if (await vacio('order', 'orden')) {
      const n = await enTransaccion(pools.order, async (c) => {
        await c.query('TRUNCATE orden_cupon, orden_detalle, orden, idempotencia RESTART IDENTITY CASCADE');
        const est = await estados(c);
        const ordenes = (await t('SELECT o.*, e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id ORDER BY o.ord_id'))
          .map(({ est_codigo, est_id, ...o }) => ({ ...o, est_id: est(est_codigo) }));
        const r = { orden: await insertar(c, 'orden', ordenes), orden_detalle: 0 };
        await ajustarIdentidad(c, 'orden', 'ord_id');
        const desc = (x, nombre) => `${x.atr_nombre} · ${String(x.res_fecha.toISOString?.() ?? x.res_fecha).slice(0, 10)} ${String(x.res_hora).slice(0, 5)} · ${nombre}`.slice(0, 255);
        const extras = [];
        for (const x of reservas) {
          const precios = preciosDe(x);
          const tipos = TIPOS.map(([cant, , codigo, nombre], i) => ({ cantidad: Number(x[cant] ?? 0), precio: precios[i], codigo, nombre })).filter((y) => y.cantidad > 0);
          const cuadra = tipos.every((y) => y.precio !== null) && tipos.reduce((s, y) => s + y.cantidad * y.precio, 0) === cent(x.res_subtotal);
          const lineas = cuadra ? tipos : [{ cantidad: 1, precio: cent(x.res_subtotal), codigo: 'AD', nombre: 'Paquete' }];
          const [principal, ...resto] = lineas;
          await c.query(
            `INSERT INTO orden_detalle (det_id, ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal) OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [x.det_id, x.ord_id, x.atr_id, desc(x, principal.nombre), principal.cantidad, principal.precio / 100, (principal.cantidad * principal.precio) / 100],
          );
          lineasPorOrden.set(String(x.ord_id), { [principal.codigo]: x.det_id });
          extras.push(...resto.map((y) => ({ x, y })));
          r.orden_detalle++;
        }
        await ajustarIdentidad(c, 'orden_detalle', 'det_id');
        for (const { x, y } of extras) {
          const d = await c.query(
            `INSERT INTO orden_detalle (ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal) VALUES ($1, $2, $3, $4, $5, $6) RETURNING det_id`,
            [x.ord_id, x.atr_id, desc(x, y.nombre), y.cantidad, y.precio / 100, (y.cantidad * y.precio) / 100],
          );
          lineasPorOrden.get(String(x.ord_id))[y.codigo] = d.rows[0].det_id;
          r.orden_detalle++;
        }
        return r;
      });
      console.log('ms_order:', n);
    } else omitido('order');

    // ── ms_payment ──
    if (await vacio('payment', 'pago')) {
      const n = await enTransaccion(pools.payment, async (c) => {
        await c.query('TRUNCATE pago_tarjeta, pago_transferencia, pago RESTART IDENTITY CASCADE');
        const est = await estados(c);
        const mpa = Object.fromEntries((await c.query('SELECT mpa_codigo, mpa_id FROM metodo_pago')).rows.map((m) => [m.mpa_codigo, m.mpa_id]));
        const pagos = (await t(`SELECT p.pag_id, p.pag_numero, p.ord_id, m.mpa_codigo, e.est_codigo, p.pag_monto, p.pag_referencia, p.pag_autorizacion, p.pag_fecha,
                                       p.pag_aprobado_en, p.pag_rechazado_en, p.pag_motivo_rechazo, p.pag_creado_en
                                  FROM pago p JOIN metodo_pago m ON m.mpa_id = p.mpa_id JOIN estado e ON e.est_id = p.est_id ORDER BY p.pag_id`))
          .map(({ mpa_codigo, est_codigo, ...p }) => ({ ...p, mpa_id: mpa[mpa_codigo], est_id: est(est_codigo) }));
        const r = {
          pago: await insertar(c, 'pago', pagos),
          pago_tarjeta: await insertar(c, 'pago_tarjeta', await t('SELECT pat_id, pag_id, pat_marca, pat_ultimos4, pat_titular, pat_mes, pat_anio, pat_pais FROM pago_tarjeta ORDER BY pat_id')),
          pago_transferencia: await insertar(c, 'pago_transferencia', await t(`SELECT ptr_id, pag_id, ptr_banco, ptr_numero_comprobante, ptr_fecha_transferencia, ptr_archivo_adjunto
                                                                                 FROM pago_transferencia ORDER BY ptr_id`)),
        };
        for (const [tabla, col] of [['pago', 'pag_id'], ['pago_tarjeta', 'pat_id'], ['pago_transferencia', 'ptr_id']]) await ajustarIdentidad(c, tabla, col);
        return r;
      });
      console.log('ms_payment:', n);
    } else omitido('payment');

    // ── ms_refund ──
    if (await vacio('refund', 'reembolso')) {
      const n = await enTransaccion(pools.refund, async (c) => {
        await c.query('TRUNCATE reembolso RESTART IDENTITY');
        const r = { reembolso: await insertar(c, 'reembolso', await t(`SELECT rem_id, pag_id, rem_numero, rem_monto, rem_motivo, rem_referencia, rem_solicitado_en, rem_procesado_en, rem_creado_en
                                                                         FROM reembolso ORDER BY rem_id`)) };
        await ajustarIdentidad(c, 'reembolso', 'rem_id');
        return r;
      });
      console.log('ms_refund:', n);
    } else omitido('refund');

    // ── ms_invoicing ── El comprador (que la tienda no guardaba en la factura) sale del titular de la reserva;
    //   cada línea apunta a la línea de la orden de su tipo de boleto (factura_detalle.det_id es único).
    if (await vacio('invoicing', 'factura') && lineasPorOrden.size) {
      const n = await enTransaccion(pools.invoicing, async (c) => {
        await c.query('TRUNCATE factura_detalle, factura RESTART IDENTITY CASCADE');
        const est = await estados(c, { PAGADA_FAC: 'PAGADA', ANULADA_FAC: 'ANULADA' });
        const facturas = await t(`
          SELECT f.*, e.est_codigo, p.pax_documento, p.pax_tipo_documento, COALESCE(p.pax_correo, u.usu_correo) AS correo, p.pax_telefono
            FROM factura f JOIN estado e ON e.est_id = f.est_id JOIN orden o ON o.ord_id = f.ord_id JOIN usuario u ON u.usu_id = o.usu_id
            LEFT JOIN LATERAL (SELECT px.* FROM orden_detalle d JOIN reserva r ON r.det_id = d.det_id JOIN reserva_pasajero px ON px.res_id = r.res_id AND px.pax_es_titular
                                WHERE d.ord_id = f.ord_id LIMIT 1) p ON TRUE
           ORDER BY f.fac_id`);
        const filas = facturas.map((f) => ({
          fac_id: f.fac_id, ord_id: f.ord_id, fac_numero: f.fac_numero, fac_clave_acceso: f.fac_clave_acceso, fac_autorizacion_sri: f.fac_autorizacion_sri,
          est_id: est(f.est_codigo), fac_emitida_en: f.fac_emitida_en, fac_subtotal: f.fac_subtotal, fac_descuento: 0, fac_iva: f.fac_iva, fac_total: f.fac_total,
          fac_tipo_identificacion: f.fac_ruc ? 'RUC' : f.pax_documento ? f.pax_tipo_documento : 'CONSUMIDOR_FINAL',
          fac_identificacion: f.fac_ruc ?? f.pax_documento ?? '9999999999999', fac_razon_social: f.fac_razon_social,
          fac_correo: f.correo ?? 'consumidor@descubre-ec.com', fac_telefono: /^\+?[0-9]{7,15}$/.test(f.pax_telefono ?? '') ? f.pax_telefono : null,
        }));
        const r = { factura: await insertar(c, 'factura', filas), factura_detalle: 0 };
        await ajustarIdentidad(c, 'factura', 'fac_id');
        const detalle = await t(`SELECT d.*, f.ord_id FROM factura_detalle d JOIN factura f ON f.fac_id = d.fac_id ORDER BY d.fde_id`);
        const usados = new Set();
        for (const d of detalle) {
          const tipo = /-([A-Z]{2})$/.exec(d.fde_codigo)?.[1] ?? 'AD';
          const det = lineasPorOrden.get(String(d.ord_id))?.[tipo] ?? lineasPorOrden.get(String(d.ord_id))?.AD;
          if (!det || usados.has(String(det))) continue; // una línea de orden se factura una sola vez
          usados.add(String(det));
          await c.query(
            `INSERT INTO factura_detalle (fde_id, fac_id, det_id, fde_codigo, fde_descripcion, fde_cantidad, fde_precio_unitario, fde_descuento, fde_subtotal,
                                          fde_iva_porcentaje, fde_iva, fde_total) OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [d.fde_id, d.fac_id, det, d.fde_codigo, d.fde_descripcion, d.fde_cantidad, d.fde_precio_unitario, d.fde_descuento, d.fde_base_imponible, d.fde_tarifa_iva, d.fde_valor_iva, d.fde_total],
          );
          r.factura_detalle++;
        }
        await ajustarIdentidad(c, 'factura_detalle', 'fde_id');
        return r;
      });
      console.log('ms_invoicing:', n);
    } else omitido('invoicing');

    // ── ms_booking ── Reservas con la copia de la atracción y del pago, pasajeros, feed de eventos (mismos
    //   sequence_number que ya vio Booking) y el usuario técnico dueño de sus órdenes.
    if (await vacio('booking', 'reserva')) {
      const n = await enTransaccion(pools.booking, async (c) => {
        await c.query('TRUNCATE reserva_pasajero, reserva, evento, idempotencia, parametro RESTART IDENTITY CASCADE');
        const est = await estados(c, { CANCELADA_RES: 'CANCELADA' });
        const filas = reservas.map((x) => ({ precios: preciosDe(x), x })).map(({ precios, x }) => ({
          res_id: x.res_id, res_uuid: x.res_uuid, res_codigo: x.res_codigo, det_id: x.det_id, dis_id: x.dis_id, est_id: est(x.est_codigo),
          res_adultos: x.res_adultos, res_ninos: x.res_ninos, res_seniors: x.res_seniors ?? 0, res_estudiantes: x.res_estudiantes ?? 0, res_infantes: x.res_infantes ?? 0,
          res_numero_tickets: x.res_numero_tickets, res_precio_unitario: x.res_precio_unitario, res_precio_nino: x.res_precio_nino ?? (precios[1] == null ? null : precios[1] / 100),
          res_precio_senior: x.res_precio_senior ?? (Number(x.res_seniors) && precios[2] != null ? precios[2] / 100 : null),
          res_precio_estudiante: x.res_precio_estudiante ?? (Number(x.res_estudiantes) && precios[3] != null ? precios[3] / 100 : null), res_subtotal: x.res_subtotal, res_observaciones: x.res_observaciones, res_motivo_cancelacion: x.res_motivo_cancelacion,
          res_creado_en: x.res_creado_en, res_actualizado_en: x.res_actualizado_en, res_cancelado_en: x.res_cancelado_en, res_confirmado_en: x.res_confirmado_en,
          res_fecha: x.res_fecha, res_hora: x.res_hora, res_origen: x.res_origen ?? 'WEB', res_saga_id: x.res_saga_id,
          res_checkin_en: x.res_checkin_en, res_checkin_guia: x.res_checkin_guia, res_checkin_dispositivo: x.res_checkin_dispositivo,
          ord_id: x.ord_id, ord_numero: x.ord_numero, pag_id: x.pag_id, atr_id: x.atr_id, atr_uuid: x.atr_uuid, atr_nombre: x.atr_nombre,
          res_punto_encuentro: x.punto, res_guia: x.atr_guia, res_cancelacion_gratuita: x.atr_cancelacion_gratuita, res_horas_cancelacion: x.atr_horas_cancelacion,
          res_moneda: x.atr_moneda ?? 'USD', res_metodo_pago: x.mpa_codigo, res_pago_estado: x.pago_estado ?? 'PENDIENTE',
          res_reembolso_numero: x.rem_numero, res_reembolso_monto: x.rem_monto, res_factura_pendiente: x.pago_estado === 'APROBADO' && !x.facturada && x.est_codigo !== 'CANCELADA_RES',
        }));
        const r = {
          reserva: await insertar(c, 'reserva', filas),
          reserva_pasajero: await insertar(c, 'reserva_pasajero', await t(`
            SELECT pax_id, res_id, pax_nombre,
                   CASE WHEN pax_documento ~ '^[0-9]{10}$' OR pax_documento ~ '^[0-9]{13}$' OR pax_documento ~ '^[A-Z0-9]{6,9}$' THEN pax_documento END AS pax_documento,
                   pax_fecha_nacimiento, pax_es_titular, COALESCE(pax_tipo_documento, 'CEDULA') AS pax_tipo_documento, pax_correo, pax_telefono,
                   COALESCE(pax_tipo_boleto, 'ADULT') AS pax_tipo_boleto
              FROM reserva_pasajero ORDER BY pax_id`)),
          evento: await insertar(c, 'evento', await t(`SELECT evt_id, evt_uuid, evt_tipo, evt_agregado, evt_agregado_id, evt_datos, evt_correlacion, evt_creado_en FROM evento ORDER BY evt_id`)),
        };
        for (const [tabla, col] of [['reserva', 'res_id'], ['reserva_pasajero', 'pax_id'], ['evento', 'evt_id']]) await ajustarIdentidad(c, tabla, col);
        const tecnico = (await t(`SELECT usu_id::text AS id FROM usuario WHERE usu_correo = 'integracion.booking@descubre-ec.com'`))[0];
        if (tecnico) await c.query(`INSERT INTO parametro (par_clave, par_valor) VALUES ('usuario_booking', $1)`, [tecnico.id]);
        return r;
      });
      console.log('ms_booking:', n);
    } else omitido('booking');
    console.log('Listo: los 11 microservicios tienen los datos de la tienda con los mismos IDs.');
  } finally {
    await Promise.all(Object.values(pools).map((p) => p.end()));
  }
}

main().catch((e) => {
  console.error('La migración falló:', e.message);
  process.exit(1);
});
