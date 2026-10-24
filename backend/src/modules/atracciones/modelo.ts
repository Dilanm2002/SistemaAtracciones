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
  CHECKED_IN: ReservationStatus.CONFIRMED,
  PENDIENTE_PAGO: ReservationStatus.PENDING,
  CANCELADA_RES: ReservationStatus.CANCELLED,
};

export const STATUS_A_ESTADOS: Record<ReservationStatus, string[]> = {
  [ReservationStatus.CONFIRMED]: ['CONFIRMADA', 'COMPLETADA', 'CHECKED_IN'],
  [ReservationStatus.PENDING]: ['PENDIENTE_PAGO'],
  [ReservationStatus.CANCELLED]: ['CANCELADA_RES'],
};

export const METODOS: PaymentMethod[] = [PaymentMethod.TARJETA, PaymentMethod.TRANSFERENCIA, PaymentMethod.EN_SITIO];

/** Tarifa vigente de un tipo (ADULTO/NINO) para la atracción `alias`. */
export const sqlTarifa = (tipo: 'ADULTO' | 'NINO' | 'MAYOR' | 'ESTUDIANTE', alias = 'a') => `(
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
  /** TRUE si el administrador la aprobó alguna vez (puede pausarse y reactivarse sin revisión) */
  aprobada: boolean;
  motivo_rechazo: string | null;
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
  precio_mayor: number | null;
  precio_estudiante: number | null;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  accesible_silla: boolean;
  accesible_coche: boolean;
  animales_servicio: boolean;
  guia: string | null;
  instrucciones_llegada: string | null;
  permite_paquete: boolean;
  descuento_paquete: number;
  ope_ruc: string | null;
  ope_telefono: string | null;
  ope_correo: string | null;
  itinerario: { orden: number; hora: string; titulo: string; descripcion: string | null; duracion_min: number; lugar: string | null }[];
  /** Promedio por pilar (1–5); las reseñas sin nota por pilar aportan su nota general */
  pilares: { limpieza: number | null; servicio: number | null; calidad_precio: number | null; puntualidad: number | null } | null;
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
         a.atr_tipo AS tipo, a.atr_estado AS estado, a.atr_aprobada AS aprobada, a.atr_motivo_rechazo AS motivo_rechazo,
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
         ${sqlTarifa('MAYOR')} AS precio_mayor,
         ${sqlTarifa('ESTUDIANTE')} AS precio_estudiante,
         a.atr_incluye_comida AS incluye_comida, a.atr_incluye_transporte AS incluye_transporte, a.atr_incluye_guia AS incluye_guia,
         a.atr_accesible_silla AS accesible_silla, a.atr_accesible_coche AS accesible_coche, a.atr_animales_servicio AS animales_servicio,
         a.atr_guia AS guia, a.atr_instrucciones_llegada AS instrucciones_llegada,
         a.atr_permite_paquete AS permite_paquete, a.atr_descuento_paquete::float8 AS descuento_paquete,
         o.ope_ruc AS ope_ruc, o.ope_telefono AS ope_telefono, o.ope_correo AS ope_correo,
         COALESCE((SELECT json_agg(json_build_object('orden', it.iti_orden, 'hora', to_char(it.iti_hora, 'HH24:MI'), 'titulo', it.iti_titulo,
                                                     'descripcion', it.iti_descripcion, 'duracion_min', it.iti_duracion_min, 'lugar', it.iti_lugar)
                            ORDER BY it.iti_orden)
                     FROM atraccion_itinerario it WHERE it.atr_id = a.atr_id), '[]') AS itinerario,
         (SELECT json_build_object(
                   'limpieza', AVG(COALESCE(re.ren_limpieza, re.ren_puntuacion))::float8,
                   'servicio', AVG(COALESCE(re.ren_servicio, re.ren_puntuacion))::float8,
                   'calidad_precio', AVG(COALESCE(re.ren_relacion_valor, re.ren_puntuacion))::float8,
                   'puntualidad', AVG(COALESCE(re.ren_puntualidad, re.ren_puntuacion))::float8)
            FROM resena re WHERE re.atr_id = a.atr_id AND re.ren_visible) AS pilares,
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
  factura: FilaFactura | null;
  dis_id: string;
  seniors: number;
  infantes: number;
  estudiantes: number;
  precio_estudiante: number | null;
  precio_adulto: number;
  precio_nino: number | null;
  precio_senior: number | null;
  origen: 'WEB' | 'BOOKING';
  saga_id: string | null;
  checkin_en: Date | null;
  checkin_guia: string | null;
  confirmado_en: Date | null;
  orden_numero: string;
  atr_slug: string;
  guia: string | null;
  instrucciones_llegada: string | null;
  pax_tipo_documento: 'CEDULA' | 'PASAPORTE' | 'RUC' | null;
  pago_estado: string | null;
  reembolso: { numero: string; monto: number } | null;
  acompanantes: { nombre: string; documento: string | null; tipo: 'ADULT' | 'CHILD' | 'SENIOR' | 'STUDENT' | 'INFANT' | null }[];
}

/** Factura de la orden (encabezado + factura_detalle), armada como JSON por SELECT_RESERVA. */
export interface FilaFactura {
  numero: string;
  estado: string;
  emitida_en: string;
  razon_social: string | null;
  subtotal: number;
  iva: number;
  total: number;
  lineas: {
    linea: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    descuento: number;
    base_imponible: number;
    tarifa_iva: number;
    valor_iva: number;
    total: number;
  }[];
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
         pax.pax_nombre, pax.pax_documento, pax.pax_correo, pax.pax_telefono, mp.mpa_codigo AS metodo,
         fac.factura,
         r.dis_id::text AS dis_id, r.res_seniors AS seniors, r.res_infantes AS infantes, r.res_estudiantes AS estudiantes,
         r.res_precio_estudiante::float8 AS precio_estudiante,
         r.res_precio_unitario::float8 AS precio_adulto, r.res_precio_nino::float8 AS precio_nino, r.res_precio_senior::float8 AS precio_senior,
         r.res_origen AS origen, r.res_saga_id AS saga_id, r.res_checkin_en AS checkin_en, r.res_checkin_guia AS checkin_guia,
         r.res_confirmado_en AS confirmado_en, o.ord_numero AS orden_numero, a.atr_slug AS atr_slug, a.atr_guia AS guia,
         a.atr_instrucciones_llegada AS instrucciones_llegada, pax.pax_tipo_documento,
         (SELECT ep.est_codigo FROM pago pg JOIN estado ep ON ep.est_id = pg.est_id
           WHERE pg.ord_id = o.ord_id ORDER BY pg.pag_id DESC LIMIT 1) AS pago_estado,
         (SELECT json_build_object('numero', rm.rem_numero, 'monto', rm.rem_monto::float8)
            FROM reembolso rm JOIN pago pg ON pg.pag_id = rm.pag_id
           WHERE pg.ord_id = o.ord_id ORDER BY rm.rem_id DESC LIMIT 1) AS reembolso,
         COALESCE((SELECT json_agg(json_build_object('nombre', x.pax_nombre, 'documento', x.pax_documento, 'tipo', x.pax_tipo_boleto) ORDER BY x.pax_id)
                     FROM reserva_pasajero x WHERE x.res_id = r.res_id AND NOT x.pax_es_titular), '[]') AS acompanantes
    FROM reserva r
    JOIN estado e         ON e.est_id = r.est_id
    JOIN orden_detalle dt ON dt.det_id = r.det_id
    JOIN orden o          ON o.ord_id = dt.ord_id
    JOIN usuario u        ON u.usu_id = o.usu_id
    JOIN atraccion a      ON a.atr_id = dt.atr_id
    JOIN ciudad c         ON c.ciu_id = a.ciu_id
    JOIN operador op      ON op.ope_id = a.ope_id
    LEFT JOIN metodo_pago mp ON mp.mpa_id = o.mpa_id
    LEFT JOIN LATERAL (SELECT x.pax_nombre, x.pax_documento, x.pax_correo, x.pax_telefono, x.pax_tipo_documento FROM reserva_pasajero x
                        WHERE x.res_id = r.res_id ORDER BY x.pax_es_titular DESC, x.pax_id LIMIT 1) pax ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_build_object(
               'numero', f.fac_numero, 'estado', ef.est_codigo, 'emitida_en', f.fac_emitida_en,
               'razon_social', f.fac_razon_social, 'subtotal', f.fac_subtotal::float8, 'iva', f.fac_iva::float8,
               'total', f.fac_total::float8,
               'lineas', COALESCE((SELECT json_agg(json_build_object(
                   'linea', d.fde_linea, 'codigo', d.fde_codigo, 'descripcion', d.fde_descripcion,
                   'cantidad', d.fde_cantidad, 'precio_unitario', d.fde_precio_unitario::float8,
                   'descuento', d.fde_descuento::float8, 'base_imponible', d.fde_base_imponible::float8,
                   'tarifa_iva', d.fde_tarifa_iva::float8, 'valor_iva', d.fde_valor_iva::float8,
                   'total', d.fde_total::float8) ORDER BY d.fde_linea)
                 FROM factura_detalle d WHERE d.fac_id = f.fac_id), '[]'::json)) AS factura
        FROM factura f JOIN estado ef ON ef.est_id = f.est_id WHERE f.ord_id = o.ord_id) fac ON TRUE`;

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
