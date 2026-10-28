import { Acuerdo } from './clientes';
import { AtraccionBD } from './modelo';

/** Idiomas (código ISO) → nombre, como los muestra el contrato con Booking («Español», «Inglés»). */
const IDIOMAS: Record<string, string> = {
  es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', pt: 'Portugués', it: 'Italiano', qu: 'Kichwa', zh: 'Chino', ja: 'Japonés',
};

/** 1–5 (estrellas) → 0–10 con un decimal, la escala del contrato con Booking. */
const a10 = (v: number | null | undefined) => (v ? Math.round(v * 20) / 10 : 0);

export const insigniaDe = (score: number) =>
  score >= 9 ? 'Excepcional' : score >= 8 ? 'Muy bueno' : score >= 7 ? 'Bueno' : score > 0 ? 'Aceptable' : 'Sin reseñas';

export const duracionTexto = (h: number) => {
  const n = Number.isInteger(h) ? String(h) : h.toLocaleString('es-EC', { maximumFractionDigits: 1 });
  return `${n} ${h === 1 ? 'hora' : 'horas'}`;
};

/** «09:00» → «9:00 a.m.» (formato de los turnos del contrato). */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

const e164 = (t: string | null) => (!t ? undefined : t.startsWith('+') ? t : `+593${t.replace(/^0/, '')}`);

/** Foto: URL absoluta (las relativas se sirven desde FOTOS_BASE_URL, hoy la tienda). */
const foto = (url: string) => (/^https?:\/\//.test(url) ? url : `${(process.env.FOTOS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`);

/**
 * Atracción de la base → esquemas del contrato v3 de Booking (AtraccionCardResponseV2 y
 * AtraccionDetailResponseV2), con sus alias en español. Mismas reglas que la tienda.
 */
export class MapperBooking {
  precio(a: AtraccionBD) {
    const t = (tipo: string) => a.tarifas.find((x) => x.tav_tipo === tipo)?.tav_precio;
    const adult = t('ADULTO') ?? 0;
    const child = t('NINO') ?? adult;
    const senior = t('MAYOR') ?? adult;
    const student = t('ESTUDIANTE') ?? adult;
    const currency = a.tarifas[0]?.tav_moneda ?? a.atr_moneda;
    return {
      currency, adult, child, senior, infant: 0, student,
      moneda: currency, adulto: adult, nino: child, tercera_edad: senior, infante: 0, estudiante: student,
    };
  }

  inclusiones(a: AtraccionBD) {
    return {
      includes_food: a.atr_incluye_comida,
      includes_transport: a.atr_incluye_transporte,
      includes_guide: a.atr_incluye_guia,
      incluye_comida: a.atr_incluye_comida,
      incluye_transporte: a.atr_incluye_transporte,
      incluye_guia: a.atr_incluye_guia,
    };
  }

  private punto(a: AtraccionBD, ciudad: string) {
    return a.atr_punto_encuentro ?? a.atr_direccion ?? ciudad;
  }

  card(a: AtraccionBD, ciudad: string) {
    const score = a10(a.atr_calificacion_promedio);
    const precio = this.precio(a);
    const rating = { score, review_count: a.atr_numero_resenas, badge_text: insigniaDe(score) };
    const corta = a.atr_descripcion_corta ?? a.atr_descripcion.slice(0, 200);
    const punto = this.punto(a, ciudad);
    const duracion = duracionTexto(a.atr_duracion_horas);
    return {
      id: a.atr_uuid,
      slug: a.atr_slug,
      name: a.atr_nombre,
      short_description: corta,
      city: ciudad,
      duration: duracion,
      duration_hours: a.atr_duracion_horas,
      price: precio,
      rating,
      free_cancellation: a.atr_cancelacion_gratuita,
      free_cancellation_hours: a.atr_horas_cancelacion,
      inclusions: this.inclusiones(a),
      meeting_point: punto,
      photos: a.fotos.map((f) => foto(f.fot_url)),
      permite_paquete: a.atr_permite_paquete,
      nombre: a.atr_nombre,
      descripcion_corta: corta,
      ciudad,
      duracion,
      precio,
      calificacion: rating,
      cancelacion_gratuita: a.atr_cancelacion_gratuita,
      inclusiones: this.inclusiones(a),
      punto_encuentro: punto,
    };
  }

  detalle(a: AtraccionBD, ciudad: string, acuerdo: Acuerdo) {
    const score = a10(a.atr_calificacion_promedio);
    const punto = this.punto(a, ciudad);
    const precio = this.precio(a);
    const pilares = {
      limpieza: a10(a.atr_pilar_limpieza),
      servicio: a10(a.atr_pilar_servicio),
      calidad_precio: a10(a.atr_pilar_relacion_valor),
      puntualidad: a10(a.atr_pilar_puntualidad),
    };
    const rating = {
      score,
      review_count: a.atr_numero_resenas,
      badge_text: insigniaDe(score),
      breakdown: { ...pilares, cleanliness: pilares.limpieza, service_score: pilares.servicio, value_for_money: pilares.calidad_precio, punctuality: pilares.puntualidad },
    };
    const itinerario = a.itinerario.map((p) => {
      const hora = hora12(p.iti_hora);
      return {
        stop_number: p.iti_orden,
        time: hora,
        title: p.iti_titulo,
        ...(p.iti_descripcion ? { description: p.iti_descripcion, descripcion: p.iti_descripcion } : {}),
        duration_minutes: p.iti_duracion_min,
        ...(p.iti_lugar ? { location_name: p.iti_lugar, nombre_ubicacion: p.iti_lugar } : {}),
        numero_parada: p.iti_orden,
        hora,
        titulo: p.iti_titulo,
        duracion_minutos: p.iti_duracion_min,
      };
    });
    const geo = {
      address: punto,
      city: ciudad,
      latitude: a.atr_latitud,
      longitude: a.atr_longitud,
      ...(a.atr_instrucciones_llegada ? { arrival_instructions: a.atr_instrucciones_llegada, instrucciones_llegada: a.atr_instrucciones_llegada } : {}),
      google_maps_url: `https://maps.google.com/?q=${a.atr_latitud},${a.atr_longitud}`,
      direccion: punto,
      ciudad,
      latitud: a.atr_latitud,
      longitud: a.atr_longitud,
    };
    const accesibilidad = {
      wheelchair_accessible: a.atr_accesible_silla,
      stroller_accessible: a.atr_accesible_coche,
      service_animals_allowed: a.atr_animales_servicio,
      accesible_silla_ruedas: a.atr_accesible_silla,
      accesible_carriola: a.atr_accesible_coche,
      admite_animales_asistencia: a.atr_animales_servicio,
    };
    const descripcionPolitica = a.atr_cancelacion_gratuita
      ? `Cancela gratis hasta ${a.atr_horas_cancelacion} horas antes de la actividad y recibe el 100 % de reembolso.`
      : 'Esta experiencia no tiene cancelación gratuita: solo se reembolsa en la hora siguiente a la compra.';
    const politica = {
      free_cancellation: a.atr_cancelacion_gratuita,
      deadline_hours: a.atr_horas_cancelacion,
      description: descripcionPolitica,
      cancelacion_gratuita: a.atr_cancelacion_gratuita,
      horas_limite: a.atr_horas_cancelacion,
      descripcion: descripcionPolitica,
    };
    const duracion = duracionTexto(a.atr_duracion_horas);
    const paquete = a.atr_permite_paquete && acuerdo.permite;
    const o = a.operador;
    return {
      id: a.atr_uuid,
      uuid: a.atr_uuid,
      slug: a.atr_slug,
      name: a.atr_nombre,
      description: a.atr_descripcion,
      city: ciudad,
      duration: duracion,
      price: precio,
      rating,
      inclusions: this.inclusiones(a),
      inclusions_list: a.inclusiones.filter((i) => i.inc_tipo === 'INCLUYE').map((i) => i.inc_nombre),
      exclusions_list: a.inclusiones.filter((i) => i.inc_tipo === 'NO_INCLUYE').map((i) => i.inc_nombre),
      itinerary: itinerario,
      meeting_point_geo: geo,
      accessibility: accesibilidad,
      guide_languages: a.idiomas.map((i) => IDIOMAS[i.idi_codigo.trim()] ?? i.idi_nombre),
      cancellation_policy: politica,
      permite_paquete: paquete,
      // Nunca más de lo pactado en el acuerdo B2B de promociones
      porcentaje_descuento_paquete: paquete ? Math.min(a.atr_descuento_paquete, acuerdo.maximo) : 0,
      photos: a.fotos.map((f) => foto(f.fot_url)),
      proveedor: {
        id: `proveedor-${o.ope_codigo}`,
        nombre_comercial: o.ope_nombre,
        ...(o.ope_ruc ? { ruc: o.ope_ruc } : {}),
        ...(o.ope_telefono ? { telefono_emergencia: e164(o.ope_telefono) } : {}),
        ...(o.ope_correo ? { email_soporte: o.ope_correo } : {}),
      },
      nombre: a.atr_nombre,
      descripcion: a.atr_descripcion,
      ciudad,
      duracion,
      precio,
      calificacion: rating,
      inclusiones: this.inclusiones(a),
      punto_encuentro_geo: geo,
      itinerario,
      accesibilidad,
      politica_cancelacion: politica,
    };
  }
}
