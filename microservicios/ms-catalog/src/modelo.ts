/** Atracción completa con los nombres de columna de la base (esquema `Atraccion` del contrato propio). */
export interface AtraccionBD {
  atr_id: number;
  atr_uuid: string;
  atr_nombre: string;
  atr_slug: string;
  atr_descripcion: string;
  atr_descripcion_corta: string | null;
  atr_tipo: string;
  atr_estado: 'BORRADOR' | 'PUBLICADA' | 'INACTIVA';
  atr_latitud: number;
  atr_longitud: number;
  atr_direccion: string | null;
  atr_punto_encuentro: string | null;
  atr_duracion_horas: number;
  atr_moneda: string;
  ciu_id: number;
  ope_id: number;
  atr_cancelacion_gratuita: boolean;
  atr_horas_cancelacion: number;
  atr_destacada: boolean;
  atr_calificacion_promedio: number;
  atr_numero_resenas: number;
  atr_creado_en: string;
  atr_actualizado_en: string;
  atr_eliminado_en: string | null;
  atr_incluye_comida: boolean;
  atr_incluye_transporte: boolean;
  atr_incluye_guia: boolean;
  atr_accesible_silla: boolean;
  atr_accesible_coche: boolean;
  atr_animales_servicio: boolean;
  atr_guia: string | null;
  atr_instrucciones_llegada: string | null;
  atr_permite_paquete: boolean;
  atr_descuento_paquete: number;
  atr_pilar_limpieza: number | null;
  atr_pilar_servicio: number | null;
  atr_pilar_relacion_valor: number | null;
  atr_pilar_puntualidad: number | null;
  operador: { ope_id: number; ope_codigo: number; ope_nombre: string; ope_ruc: string | null; ope_correo: string | null; ope_telefono: string | null };
  categorias: { cat_id: number; cat_nombre: string; cat_slug: string }[];
  idiomas: { idi_id: number; idi_codigo: string; idi_nombre: string }[];
  inclusiones: { inc_id: number; inc_tipo: 'INCLUYE' | 'NO_INCLUYE' | 'RECOMENDACION'; inc_nombre: string }[];
  fotos: { fot_id: number; fot_url: string; fot_alt: string; fot_orden: number }[];
  itinerario: {
    iti_id: number;
    iti_orden: number;
    iti_hora: string;
    iti_titulo: string;
    iti_descripcion: string | null;
    iti_duracion_min: number;
    iti_lugar: string | null;
  }[];
  tarifas: { tav_tipo: string; tav_precio: number; tav_moneda: string }[];
}

/** SELECT de la atracción completa (alias `a`). Los NUMERIC salen como número (float8). */
export const SELECT_ATRACCION = `
SELECT a.atr_id::int, a.atr_uuid::text, a.atr_nombre, a.atr_slug, a.atr_descripcion, a.atr_descripcion_corta, a.atr_tipo, a.atr_estado,
       a.atr_latitud::float8, a.atr_longitud::float8, a.atr_direccion, a.atr_punto_encuentro, a.atr_duracion_horas::float8, a.atr_moneda,
       a.ciu_id::int, a.ope_id::int, a.atr_cancelacion_gratuita, a.atr_horas_cancelacion::int, a.atr_destacada,
       a.atr_calificacion_promedio::float8, a.atr_numero_resenas, a.atr_creado_en, a.atr_actualizado_en, a.atr_eliminado_en,
       a.atr_incluye_comida, a.atr_incluye_transporte, a.atr_incluye_guia, a.atr_accesible_silla, a.atr_accesible_coche,
       a.atr_animales_servicio, a.atr_guia, a.atr_instrucciones_llegada, a.atr_permite_paquete, a.atr_descuento_paquete::float8,
       a.atr_pilar_limpieza::float8, a.atr_pilar_servicio::float8, a.atr_pilar_relacion_valor::float8, a.atr_pilar_puntualidad::float8,
       json_build_object('ope_id', o.ope_id, 'ope_codigo', o.ope_codigo, 'ope_nombre', o.ope_nombre, 'ope_ruc', o.ope_ruc,
                         'ope_correo', o.ope_correo, 'ope_telefono', o.ope_telefono) AS operador,
       COALESCE((SELECT json_agg(json_build_object('cat_id', c.cat_id, 'cat_nombre', c.cat_nombre, 'cat_slug', c.cat_slug) ORDER BY c.cat_orden, c.cat_id)
                   FROM atraccion_categoria ac JOIN categoria c ON c.cat_id = ac.cat_id WHERE ac.atr_id = a.atr_id), '[]') AS categorias,
       COALESCE((SELECT json_agg(json_build_object('idi_id', i.idi_id, 'idi_codigo', i.idi_codigo, 'idi_nombre', i.idi_nombre) ORDER BY i.idi_codigo)
                   FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id WHERE ai.atr_id = a.atr_id), '[]') AS idiomas,
       COALESCE((SELECT json_agg(json_build_object('inc_id', n.inc_id, 'inc_tipo', n.inc_tipo, 'inc_nombre', n.inc_nombre) ORDER BY n.inc_tipo, n.inc_orden, n.inc_id)
                   FROM atraccion_inclusion an JOIN inclusion n ON n.inc_id = an.inc_id WHERE an.atr_id = a.atr_id), '[]') AS inclusiones,
       COALESCE((SELECT json_agg(json_build_object('fot_id', f.fot_id, 'fot_url', f.fot_url, 'fot_alt', f.fot_alt, 'fot_orden', f.fot_orden) ORDER BY f.fot_orden, f.fot_id)
                   FROM atraccion_foto f WHERE f.atr_id = a.atr_id), '[]') AS fotos,
       COALESCE((SELECT json_agg(json_build_object('iti_id', t.iti_id, 'iti_orden', t.iti_orden, 'iti_hora', to_char(t.iti_hora, 'HH24:MI'),
                                                   'iti_titulo', t.iti_titulo, 'iti_descripcion', t.iti_descripcion,
                                                   'iti_duracion_min', t.iti_duracion_min, 'iti_lugar', t.iti_lugar) ORDER BY t.iti_orden)
                   FROM atraccion_itinerario t WHERE t.atr_id = a.atr_id), '[]') AS itinerario,
       COALESCE((SELECT json_agg(json_build_object('tav_tipo', v.tav_tipo, 'tav_precio', v.tav_precio::float8, 'tav_moneda', v.tav_moneda) ORDER BY v.tav_tipo)
                   FROM tarifa_vigente v WHERE v.atr_id = a.atr_id), '[]') AS tarifas
  FROM atraccion a JOIN operador o ON o.ope_id = a.ope_id`;

/** Lo que se ofrece a Booking: publicado y no eliminado. */
export const VISIBLE = `a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA'`;

/** Precio vigente de un tipo de boleto (para filtrar y ordenar por precio). */
export const sqlPrecio = (tipo: string) => `(SELECT v.tav_precio FROM tarifa_vigente v WHERE v.atr_id = a.atr_id AND v.tav_tipo = '${tipo}')`;
