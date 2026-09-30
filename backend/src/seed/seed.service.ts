import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { CatalogosService } from '../common/db/catalogos.service';
import { moverImagenesAStorage } from '../database/imagenes-storage';
import { DbService, Sql } from '../common/db/db.service';
import { AtraccionesService } from '../modules/atracciones/atracciones.service';
import { cancelarCompra, confirmarCompra, registrarCompra } from '../modules/atracciones/compras';
import { CardBrand, PaymentMethod } from '../modules/atracciones/dto/reservation.dto';
import { horasAIso, hoyEc, sumarDias } from '../modules/atracciones/utils/fechas';
import { ATRACCIONES, CATEGORIAS, COMENTARIOS, DESTINOS, IDIOMAS_EXTRA, MENSAJES, OPERADORES, SLUG, USUARIOS } from './seed-data';

/** Falla con un mensaje claro si un dato de semilla esperado no existe. */
function must<T>(v: T | undefined | null, que: string): T {
  if (v === undefined || v === null) throw new Error(`Datos de semilla incompletos: falta ${que}`);
  return v;
}

/** PRNG determinista (mulberry32) para que los datos de demo sean siempre iguales. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AtrSeed {
  atr_id: string;
  nombre: string;
  moneda: string;
  adulto: number;
  nino: number;
  horarios: { hor_id: string; hora: string; cupo: number }[];
}

/**
 * Carga datos de demostración sobre el modelo relacional la primera vez que arranca
 * la API (solo si la tabla atraccion está vacía). Desactivar con SEED_ON_START=false.
 * Los catálogos base (región, provincia, rol, estado, método de pago…) ya los carga
 * database/01_esquema.sql.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seed');

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly catalogos: CatalogosService,
    private readonly atracciones: AtraccionesService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get('SEED_ON_START', 'true') === 'false') return;
    await this.sembrar();
  }

  /** Devuelve true si cargó datos (false si la base ya tenía atracciones). */
  async sembrar(): Promise<boolean> {
    const hay = await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM atraccion');
    if (hay && hay.n > 0) return false;
    this.logger.log('Base vacía: cargando datos de demostración…');
    await this.catalogos.precargar();
    await this.db.tx((tx) => this.run(tx));
    this.logger.log('Datos de demostración listos.');
    // Como en Sal y Canela: las fotos van al bucket de Supabase Storage y la tabla guarda su URL
    await moverImagenesAStorage((sql, params) => this.db.query(sql, params), { log: (m) => this.logger.log(m) });
    return true;
  }

  private async run(tx: Sql) {
    const rnd = prng(2026);
    const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    const hoy = hoyEc();

    // ── Catálogos ───────────────────────────────────────────────────────
    for (const c of CATEGORIAS) {
      await tx.query(
        `INSERT INTO categoria (cat_slug, cat_nombre, cat_icono, cat_descripcion, cat_orden, cat_padre_id)
         VALUES ($1, $2, $3, $4, $5, (SELECT cat_id FROM categoria WHERE cat_slug = $6))
         ON CONFLICT (cat_slug) DO UPDATE SET cat_nombre = EXCLUDED.cat_nombre, cat_icono = EXCLUDED.cat_icono,
           cat_descripcion = EXCLUDED.cat_descripcion, cat_orden = EXCLUDED.cat_orden, cat_padre_id = EXCLUDED.cat_padre_id`,
        [c.slug, c.nombre, c.icono, c.descripcion, c.orden, c.padre ?? null],
      );
    }
    for (const i of IDIOMAS_EXTRA) {
      await tx.query('INSERT INTO idioma (idi_codigo, idi_nombre) VALUES ($1, $2) ON CONFLICT (idi_codigo) DO NOTHING', [i.codigo, i.nombre]);
    }
    const ciudadDe = new Map<number, number>();
    for (const d of DESTINOS) {
      const r = await tx.one<{ ciu_id: number }>(
        `INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id, ciu_descripcion, ciu_imagen)
         VALUES ($1, $2, (SELECT prov_id FROM provincia WHERE prov_nombre = $3), $4, $5)
         ON CONFLICT (ciu_codigo) DO UPDATE SET ciu_descripcion = EXCLUDED.ciu_descripcion, ciu_imagen = EXCLUDED.ciu_imagen
         RETURNING ciu_id`,
        [d.nombre, d.codigoInec, d.provincia, d.descripcion, d.imagen],
      );
      ciudadDe.set(d.codigo, must(r, `ciudad ${d.nombre}`).ciu_id);
    }
    for (const o of OPERADORES) {
      await tx.query(
        `INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT prov_id FROM provincia WHERE prov_nombre = $7))`,
        [o.codigo, o.nombre, o.ruc, o.email, o.telefono, o.direccion, o.provincia],
      );
    }

    // ── Usuarios (roles en usuario_rol; empresa del operador en operador_usuario) ──
    const usuarios: { id: string; nombre: string; email: string; rol: string; documento?: string }[] = [];
    for (const u of USUARIOS) {
      const r = await tx.one<{ id: string }>(
        `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_telefono, usu_documento, usu_verificado)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING usu_id::text AS id`,
        [u.email, await bcrypt.hash(u.password, 10), u.nombre, u.apellido, u.telefono, u.documento ?? null],
      );
      const id = must(r, `usuario ${u.email}`).id;
      await tx.query('INSERT INTO usuario_rol (usu_id, rol_id) VALUES ($1, $2)', [id, await this.catalogos.rol(u.rol)]);
      if (u.operadorCodigo) {
        await tx.query(
          `INSERT INTO operador_usuario (ope_id, usu_id, opeu_cargo) SELECT ope_id, $2, 'OPERACIONES' FROM operador WHERE ope_codigo = $1`,
          [u.operadorCodigo, id],
        );
      }
      usuarios.push({ id, nombre: `${u.nombre} ${u.apellido}`, email: u.email, rol: u.rol, documento: u.documento });
    }
    const clientes = usuarios.filter((u) => u.rol === 'CLIENTE');
    const maria = must(clientes.find((u) => u.email === 'cliente@descubre-ec.com'), 'cliente demo');

    // ── Atracciones (misma lógica que la API: tarifas, horarios, inclusiones…) ──
    const atracciones: AtrSeed[] = [];
    for (const a of ATRACCIONES) {
      const categorias = [...new Set([...a.categorias.map((c) => SLUG[c] ?? c), ...([9, 10].includes(a.destino) ? ['montana'] : [])])];
      const id = await this.atracciones.guardar(tx, null, {
        name: a.nombre,
        short_description: a.corta,
        long_description: a.descripcion,
        duration: horasAIso(a.horas),
        price: { currency: 'USD', total: a.precio },
        child_price: a.precioNino,
        operator: { id: a.operador, name: '' },
        product_type: a.tipo,
        categories: categorias,
        includes: a.incluye,
        not_includes: a.noIncluye,
        recommendations: a.recomendaciones,
        supported_languages: a.idiomas,
        locations: [
          {
            address: a.direccion,
            city: must(ciudadDe.get(a.destino), `destino ${a.destino}`),
            country: 'ec',
            coordinates: { latitude: a.lat, longitude: a.lng },
          },
        ],
        photos: a.fotos.map((url) => ({ url })),
        free_cancellation: a.cancelacion ?? true,
        cancellation_hours: a.horasCancelacion ?? 24,
        times: a.horarios,
        capacity_per_slot: a.cupo,
        meeting_point: a.punto,
        featured: a.destacado ?? false,
        is_active: true,
      });
      const horarios = await tx.query<{ hor_id: string; hora: string; cupo: number }>(
        `SELECT hor_id::text, to_char(hor_hora, 'HH24:MI') AS hora, hor_cupo AS cupo FROM horario WHERE atr_id = $1 ORDER BY hor_hora`,
        [id],
      );
      atracciones.push({ atr_id: id, nombre: a.nombre, moneda: 'USD', adulto: a.precio, nino: a.precioNino, horarios });
    }
    // Catálogo con historia: publicado y con tarifas vigentes desde hace meses
    await tx.query(`UPDATE atraccion SET atr_creado_en = now() - interval '200 days'`);
    await tx.query(`UPDATE tarifa SET tar_vigente_desde = CURRENT_DATE - 200`);

    // ── Compras y reservas: 45 días atrás hasta 30 días adelante ─────────
    const reservar = async (a: AtrSeed, u: (typeof usuarios)[number], fecha: string, tipo: 'CONFIRMADA' | 'PENDIENTE' | 'CANCELADA', diasAntes: number) => {
      const h = pick(a.horarios);
      const adultos = 1 + Math.floor(rnd() * 3);
      const ninos = rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0;
      await tx.query(
        `INSERT INTO disponibilidad (atr_id, hor_id, dis_fecha, dis_cupo_total) VALUES ($1, $2, $3, $4)
         ON CONFLICT (atr_id, dis_fecha, hor_id) DO NOTHING`,
        [a.atr_id, h.hor_id, fecha, h.cupo],
      );
      const inv = must(
        await tx.one<{ dis_id: string; libres: number }>(
          `SELECT dis_id::text, dis_cupo_total - dis_cupo_reservado AS libres FROM disponibilidad WHERE atr_id = $1 AND dis_fecha = $2 AND hor_id = $3`,
          [a.atr_id, fecha, h.hor_id],
        ),
        'disponibilidad',
      );
      if (inv.libres < adultos + ninos) return;
      await tx.query('UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado + $2 WHERE dis_id = $1', [inv.dis_id, adultos + ninos]);

      const creado = new Date(`${sumarDias(fecha, -diasAntes)}T${String(8 + Math.floor(rnd() * 12)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00-05:00`);
      const creadoEn = creado > new Date() ? new Date() : creado;
      const pasada = fecha < hoy;
      const metodo =
        tipo === 'PENDIENTE' ? pick([PaymentMethod.TRANSFERENCIA, PaymentMethod.EN_SITIO]) : pick([PaymentMethod.TARJETA, PaymentMethod.TARJETA, PaymentMethod.TRANSFERENCIA]);
      const compra = await registrarCompra(tx, this.catalogos, {
        usuId: u.id,
        atrId: a.atr_id,
        atrNombre: a.nombre,
        disId: inv.dis_id,
        fecha,
        hora: h.hora,
        adultos,
        ninos,
        precioAdulto: a.adulto,
        precioNino: a.nino,
        moneda: a.moneda,
        metodo,
        paxNombre: u.nombre,
        paxDocumento: u.documento ?? null,
        tarjeta:
          metodo === PaymentMethod.TARJETA
            ? { brand: pick([CardBrand.VISA, CardBrand.MASTERCARD]), last4: String(1000 + Math.floor(rnd() * 9000)), holder: u.nombre, exp_month: 1 + Math.floor(rnd() * 12), exp_year: 2029 }
            : undefined,
        creadoEn,
        completada: pasada && tipo === 'CONFIRMADA',
        rnd,
      });
      const despues = new Date(Math.min(creadoEn.getTime() + 86400_000, Date.now()));
      if (tipo === 'CONFIRMADA' && metodo !== PaymentMethod.TARJETA) await confirmarCompra(tx, this.catalogos, compra.resId, despues, pasada);
      if (tipo === 'CANCELADA') await cancelarCompra(tx, this.catalogos, compra.resId, pick(['Cambio de planes', 'Problemas con el vuelo', 'Enfermedad']), despues);
    };

    for (let d = -45; d <= 30; d++) {
      const fecha = sumarDias(hoy, d);
      const n = d < 0 ? Math.floor(rnd() * 3) : Math.floor(rnd() * 3) + (d < 7 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const r = rnd();
        const tipo = r < 0.1 ? 'CANCELADA' : d >= 0 && r < 0.22 ? 'PENDIENTE' : 'CONFIRMADA';
        // Las reservas futuras se hicieron antes de hoy; las pasadas, 1-14 días antes del tour
        const antes = d >= 0 ? d + 1 + Math.floor(rnd() * 10) : 1 + Math.floor(rnd() * 14);
        await reservar(pick(atracciones), pick(clientes), fecha, tipo, antes);
      }
    }
    // Reservas conocidas de la cliente de demo (para probar "Mis reservas" y reseñas)
    const byName = (s: string) => must(atracciones.find((a) => a.nombre.includes(s)), `atracción "${s}"`);
    await reservar(byName('Cotopaxi'), maria, sumarDias(hoy, -20), 'CONFIRMADA', 10);
    await reservar(byName('Pailón'), maria, sumarDias(hoy, -5), 'CONFIRMADA', 3);
    await reservar(byName('Mitad del Mundo'), maria, sumarDias(hoy, 6), 'CONFIRMADA', 2);
    await reservar(byName('Kicker'), maria, sumarDias(hoy, 18), 'PENDIENTE', 1);

    // ── Reseñas (una por cliente y atracción) ───────────────────────────
    for (const a of atracciones) {
      const n = 3 + Math.floor(rnd() * 5);
      const autores = [...clientes].sort(() => rnd() - 0.5).slice(0, Math.min(n, clientes.length)).filter((u) => u.id !== maria.id);
      for (const u of autores) {
        const x = rnd();
        const estrellas = x < 0.62 ? 5 : x < 0.92 ? 4 : 3;
        await tx.query(
          `INSERT INTO resena (atr_id, usu_id, ren_autor_nombre, ren_puntuacion, ren_comentario, ren_creado_en)
           VALUES ($1, $2, $3, $4, $5, now() - make_interval(days => $6))`,
          [a.atr_id, u.id, u.nombre, estrellas, pick(COMENTARIOS[estrellas]), Math.floor(rnd() * 120)],
        );
      }
    }
    await tx.query(
      `UPDATE atraccion a SET atr_calificacion_promedio = x.promedio, atr_numero_resenas = x.n
         FROM (SELECT atr_id, ROUND(AVG(ren_puntuacion)::numeric, 2) AS promedio, COUNT(*)::int AS n
                 FROM resena WHERE ren_visible GROUP BY atr_id) x
        WHERE a.atr_id = x.atr_id`,
    );

    // ── Fechas bloqueadas, favoritos y mensajes ─────────────────────────
    const bloqueos = [
      { a: byName('Cotopaxi'), fecha: sumarDias(hoy, 12), motivo: 'Mantenimiento de senderos del parque' },
      { a: byName('Nariz del Diablo'), fecha: `${hoy.slice(0, 4)}-12-25`, motivo: 'Feriado de Navidad' },
    ].filter((b) => b.fecha >= hoy);
    for (const b of bloqueos) {
      await tx.query('INSERT INTO fecha_bloqueada (atr_id, fb_fecha, fb_motivo) VALUES ($1, $2, $3)', [b.a.atr_id, b.fecha, b.motivo]);
    }
    for (const a of [byName('Quilotoa'), byName('Kicker')]) {
      await tx.query('INSERT INTO favorito (usu_id, atr_id) VALUES ($1, $2)', [maria.id, a.atr_id]);
    }
    for (const [i, m] of MENSAJES.entries()) {
      await tx.query(
        'INSERT INTO mensaje_contacto (men_nombre, men_correo, men_asunto, men_cuerpo, men_leido, men_creado_en) VALUES ($1, $2, $3, $4, $5, now() - make_interval(hours => $6))',
        [m.nombre, m.email, m.asunto, m.mensaje, i >= 2, (i + 1) * 7],
      );
    }
  }
}
