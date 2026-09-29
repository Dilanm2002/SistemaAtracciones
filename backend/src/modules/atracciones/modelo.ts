import { HOY_EC } from '../../common/db/db.service';
import { ProductType } from './dto/create-atraccion.dto';
import { PaymentMethod, ReservationStatus } from './dto/reservation.dto';

/**
 * Traducción entre el modelo relacional (database/01_esquema.sql) y el contrato
 * OpenAPI. Todo lo que conecta nombres internos con nombres del contrato vive aquí.
 */

export enum Region {
  SIERRA = 'SIERRA',
  COSTA = 'COSTA',
  AMAZONIA = 'AMAZONIA',
  GALAPAGOS = 'GALAPAGOS',
}

/** atraccion.atr_tipo → product_type del contrato */
export const TIPO_A_CONTRATO: Record<string, ProductType> = {
  ADMISSION: ProductType.SINGLE_TICKET,
  TRANSPORT: ProductType.SINGLE_TICKET,
  GUIDED_TOUR: ProductType.GUIDED_TOUR,
  DAY_TRIP: ProductType.GUIDED_TOUR,
  PACKAGE: ProductType.PACKAGE,
};

/** product_type del contrato → atr_tipo con el que se guarda */
export const CONTRATO_A_TIPO: Record<ProductType, string> = {
  [ProductType.SINGLE_TICKET]: 'ADMISSION',
  [ProductType.GUIDED_TOUR]: 'GUIDED_TOUR',
  [ProductType.PACKAGE]: 'PACKAGE',
};

/** product_type → todos los atr_tipo que lo representan (para filtrar) */
export const TIPOS_DE: Record<ProductType, string[]> = {
  [ProductType.SINGLE_TICKET]: ['ADMISSION', 'TRANSPORT'],
  [ProductType.GUIDED_TOUR]: ['GUIDED_TOUR', 'DAY_TRIP'],
  [ProductType.PACKAGE]: ['PACKAGE'],
};

/** estado.est_codigo (grupo RESERVA) → status del contrato */
export const ESTADO_A_STATUS: Record<string, ReservationStatus> = {
  CONFIRMADA: ReservationStatus.CONFIRMED,
  COMPLETADA: ReservationStatus.CONFIRMED,
  PENDIENTE_PAGO: ReservationStatus.PENDING,
  CANCELADA_RES: ReservationStatus.CANCELLED,
};

export const STATUS_A_ESTADOS: Record<ReservationStatus, string[]> = {
  [ReservationStatus.CONFIRMED]: ['CONFIRMADA', 'COMPLETADA'],
  [ReservationStatus.PENDING]: ['PENDIENTE_PAGO'],
  [ReservationStatus.CANCELLED]: ['CANCELADA_RES'],
};

export const METODOS: PaymentMethod[] = [PaymentMethod.TARJETA, PaymentMethod.TRANSFERENCIA, PaymentMethod.EN_SITIO];

/** Tarifa vigente de un tipo (ADULTO/NINO) para la atracción `alias`. */
export const sqlTarifa = (tipo: 'ADULTO' | 'NINO', alias = 'a') => `(
  SELECT t.tar_precio::float8 FROM tarifa t
   WHERE t.atr_id = ${alias}.atr_id AND t.tar_tipo = '${tipo}'
     AND t.tar_vigente_desde <= ${HOY_EC}
     AND (t.tar_vigente_hasta IS NULL OR t.tar_vigente_hasta >= ${HOY_EC})
   ORDER BY t.tar_vigente_desde DESC LIMIT 1)`;

export interface FilaAtraccion {
  id: string;
  uuid: string;
  nombre: string;
  slug: string;
  descripcion: string;
  descripcion_corta: string | null;
  tipo: string;
  estado: string;
  latitud: number;
  longitud: number;
  direccion: string | null;
  punto_encuentro: string | null;
  duracion_horas: number;
  moneda: string;
  cancelacion_gratuita: boolean;
  horas_cancelacion: number;
  destacada: boolean;
  rating: number;
  numero_resenas: number;
  creado_en: Date;
  ciu_id: number;
  ciudad: string;
  prov_id: number;
  provincia: string;
  region: Region;
  ope_id: string;
  ope_codigo: number;
  operador: string;
  precio_adulto: number | null;
  precio_nino: number | null;
  vendidos_60d: number;
  ocupacion_14d: number | null;
  fotos: { url: string; alt: string }[];
  horarios: { hora: string; cupo: number }[];
  categorias: string[];
  idiomas: string[];
  inclusiones: { tipo: 'INCLUYE' | 'NO_INCLUYE' | 'RECOMENDACION'; nombre: string }[];
}

/**
 * La atracción completa en UNA consulta: ubicación, operador, tarifa vigente y
 * listas (fotos, horarios, categorías, idiomas, inclusiones) con json_agg.
 * Evita el N+1 y las relaciones `eager` del modelo anterior (auditoría DAT-007).
 */
export const SELECT_ATRACCION = `
  SELECT a.atr_id::text AS id, a.atr_uuid::text AS uuid, a.atr_nombre AS nombre, a.atr_slug AS slug,
         a.atr_descripcion AS descripcion, a.atr_descripcion_corta AS descripcion_corta,
         a.atr_tipo AS tipo, a.atr_estado AS estado,
         a.atr_latitud::float8 AS latitud, a.atr_longitud::float8 AS longitud,
         a.atr_direccion AS direccion, a.atr_punto_encuentro AS punto_encuentro,
         a.atr_duracion_horas::float8 AS duracion_horas, a.atr_moneda AS moneda,
         a.atr_cancelacion_gratuita AS cancelacion_gratuita, a.atr_horas_cancelacion AS horas_cancelacion,
         a.atr_destacada AS destacada, a.atr_calificacion_promedio::float8 AS rating,
         a.atr_numero_resenas AS numero_resenas, a.atr_creado_en AS creado_en,
         c.ciu_id, c.ciu_nombre AS ciudad, pv.prov_id, pv.prov_nombre AS provincia, rg.reg_nombre AS region,
         o.ope_id::text AS ope_id, o.ope_codigo, o.ope_nombre AS operador,
         ${sqlTarifa('ADULTO')} AS precio_adulto,
         ${sqlTarifa('NINO')} AS precio_nino,
         (SELECT COALESCE(SUM(r.res_numero_tickets), 0)::int FROM reserva r
            JOIN disponibilidad d ON d.dis_id = r.dis_id JOIN estado e ON e.est_id = r.est_id
           WHERE d.atr_id = a.atr_id AND e.est_codigo <> 'CANCELADA_RES'
             AND r.res_creado_en > now() - interval '60 days') AS vendidos_60d,
         (SELECT SUM(d.dis_cupo_reservado)::float8 / NULLIF(SUM(d.dis_cupo_total), 0) FROM disponibilidad d
           WHERE d.atr_id = a.atr_id AND d.dis_fecha BETWEEN ${HOY_EC} AND ${HOY_EC} + 14) AS ocupacion_14d,
         COALESCE((SELECT json_agg(json_build_object('url', f.fot_url, 'alt', f.fot_alt) ORDER BY f.fot_orden, f.fot_id)
                     FROM atraccion_foto f WHERE f.atr_id = a.atr_id), '[]') AS fotos,
         COALESCE((SELECT json_agg(json_build_object('hora', to_char(h.hor_hora, 'HH24:MI'), 'cupo', h.hor_cupo) ORDER BY h.hor_hora)
                     FROM horario h WHERE h.atr_id = a.atr_id AND h.hor_activo), '[]') AS horarios,
         COALESCE((SELECT json_agg(ca.cat_slug ORDER BY ca.cat_orden, ca.cat_nombre)
                     FROM atraccion_categoria ac JOIN categoria ca ON ca.cat_id = ac.cat_id WHERE ac.atr_id = a.atr_id), '[]') AS categorias,
         COALESCE((SELECT json_agg(i.idi_codigo ORDER BY i.idi_id)
                     FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id WHERE ai.atr_id = a.atr_id), '[]') AS idiomas,
         COALESCE((SELECT json_agg(json_build_object('tipo', n.inc_tipo, 'nombre', n.inc_nombre) ORDER BY n.inc_orden, n.inc_id)
                     FROM atraccion_inclusion an JOIN inclusion n ON n.inc_id = an.inc_id WHERE an.atr_id = a.atr_id), '[]') AS inclusiones
    FROM atraccion a
    JOIN ciudad c     ON c.ciu_id = a.ciu_id
    JOIN provincia pv ON pv.prov_id = a.prov_id
    JOIN region rg    ON rg.reg_id = pv.reg_id
    JOIN operador o   ON o.ope_id = a.ope_id`;

/** Reserva con su compra, atracción, pasajero titular y método de pago. */
export interface FilaReserva {
  res_id: string;
  id: string;
  codigo: string;
  estado: string;
  tickets: number;
  adultos: number;
  ninos: number;
  total: number;
  moneda: string;
  fecha: string;
  hora: string;
  observaciones: string | null;
  motivo_cancelacion: string | null;
  cancelado_en: Date | null;
  creado_en: Date;
  atr_uuid: string;
  atr_nombre: string;
  ciudad: string;
  punto_encuentro: string | null;
  direccion: string | null;
  cancelacion_gratuita: boolean;
  horas_cancelacion: number;
  foto: string | null;
  ope_codigo: number;
  usu_id: string;
  correo: string;
  telefono: string | null;
  pax_nombre: string | null;
  pax_documento: string | null;
  pax_correo: string | null;
  pax_telefono: string | null;
  metodo: PaymentMethod | null;
}

export const SELECT_RESERVA = `
  SELECT r.res_id::text AS res_id, r.res_uuid::text AS id, r.res_codigo AS codigo, e.est_codigo AS estado,
         r.res_numero_tickets AS tickets, r.res_adultos AS adultos, r.res_ninos AS ninos,
         r.res_subtotal::float8 AS total, o.ord_moneda AS moneda,
         to_char(r.res_fecha, 'YYYY-MM-DD') AS fecha, to_char(r.res_hora, 'HH24:MI') AS hora,
         r.res_observaciones AS observaciones, r.res_motivo_cancelacion AS motivo_cancelacion,
         r.res_cancelado_en AS cancelado_en, r.res_creado_en AS creado_en,
         a.atr_uuid::text AS atr_uuid, a.atr_nombre, c.ciu_nombre AS ciudad,
         a.atr_punto_encuentro AS punto_encuentro, a.atr_direccion AS direccion,
         a.atr_cancelacion_gratuita AS cancelacion_gratuita, a.atr_horas_cancelacion AS horas_cancelacion,
         (SELECT f.fot_url FROM atraccion_foto f WHERE f.atr_id = a.atr_id ORDER BY f.fot_orden, f.fot_id LIMIT 1) AS foto,
         op.ope_codigo, o.usu_id::text AS usu_id, u.usu_correo AS correo, u.usu_telefono AS telefono,
         pax.pax_nombre, pax.pax_documento, pax.pax_correo, pax.pax_telefono, mp.mpa_codigo AS metodo
    FROM reserva r
    JOIN estado e         ON e.est_id = r.est_id
    JOIN orden_detalle dt ON dt.det_id = r.det_id
    JOIN orden o          ON o.ord_id = dt.ord_id
    JOIN usuario u        ON u.usu_id = o.usu_id
    JOIN atraccion a      ON a.atr_id = dt.atr_id
    JOIN ciudad c         ON c.ciu_id = a.ciu_id
    JOIN operador op      ON op.ope_id = a.ope_id
    LEFT JOIN metodo_pago mp ON mp.mpa_id = o.mpa_id
    LEFT JOIN LATERAL (SELECT x.pax_nombre, x.pax_documento, x.pax_correo, x.pax_telefono FROM reserva_pasajero x
                        WHERE x.res_id = r.res_id ORDER BY x.pax_es_titular DESC, x.pax_id LIMIT 1) pax ON TRUE`;

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
