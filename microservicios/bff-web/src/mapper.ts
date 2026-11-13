/**
 * Traduce entre los microservicios (columnas en español) y el formato que ya usan la web y el panel
 * (el mismo de la API de la tienda). Funciones puras: si cambia una forma, solo se toca aquí.
 */
export interface Atraccion {
  atr_id: number;
  atr_uuid: string;
  atr_nombre: string;
  atr_slug: string;
  atr_descripcion: string;
  atr_descripcion_corta: string | null;
  atr_tipo: string;
  atr_estado: string;
  atr_latitud: number;
  atr_longitud: number;
  atr_direccion: string | null;
  atr_punto_encuentro: string | null;
  atr_duracion_horas: number;
  atr_moneda: string;
  ciu_id: number;
  atr_cancelacion_gratuita: boolean;
  atr_horas_cancelacion: number;
  atr_destacada: boolean;
  atr_calificacion_promedio: number;
  atr_numero_resenas: number;
  atr_creado_en: string;
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
  operador: { ope_codigo: number; ope_nombre: string };
  categorias: { cat_nombre: string; cat_slug: string }[];
  idiomas: { idi_codigo: string }[];
  inclusiones: { inc_tipo: string; inc_nombre: string }[];
  fotos: { fot_url: string; fot_alt: string }[];
  itinerario: { iti_hora: string; iti_titulo: string; iti_descripcion: string | null; iti_duracion_min: number; iti_lugar: string | null }[];
  tarifas: { tav_tipo: string; tav_precio: number; tav_moneda: string }[];
}

export interface Ciudad {
  ciu_id: number;
  ciu_nombre: string;
  prov_nombre: string;
  reg_nombre: string;
}

export interface Horario {
  hor_hora: string;
  hor_cupo: number;
  hor_activo: boolean;
}

const DIAS_NUEVO = 7;
const TIPO_A_WEB: Record<string, string> = { ADMISSION: 'SINGLE_TICKET', TRANSPORT: 'SINGLE_TICKET', GUIDED_TOUR: 'GUIDED_TOUR', DAY_TRIP: 'GUIDED_TOUR', PACKAGE: 'PACKAGE' };
const WEB_A_TIPO: Record<string, string> = { SINGLE_TICKET: 'ADMISSION', GUIDED_TOUR: 'GUIDED_TOUR', PACKAGE: 'PACKAGE' };
export const TIPOS_DE: Record<string, string[]> = { SINGLE_TICKET: ['ADMISSION', 'TRANSPORT'], GUIDED_TOUR: ['GUIDED_TOUR', 'DAY_TRIP'], PACKAGE: ['PACKAGE'] };

const fotoAbsoluta = (url: string) => (/^https?:\/\//.test(url) ? url : `${(process.env.FOTOS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`);

const duracionIso = (h: number) => {
  const horas = Math.floor(h);
  const minutos = Math.round((h - horas) * 60);
  return `PT${horas ? `${horas}H` : ''}${minutos ? `${minutos}M` : ''}` || 'PT0M';
};

/** «PT2H30M» → 2.5 */
export function horasDeIso(iso: unknown): number | undefined {
  const m = typeof iso === 'string' ? /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso) : null;
  return m && (m[1] || m[2]) ? Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60 : undefined;
}

const dinero = (moneda: string, total: number) => ({ currency: moneda, total });

export function aWeb(a: Atraccion, c: Ciudad | undefined, horarios: Horario[] = [], ahora = Date.now()) {
  const lista = (tipo: string) => a.inclusiones.filter((i) => i.inc_tipo === tipo).map((i) => i.inc_nombre);
  const tarifa = (tipo: string) => a.tarifas.find((t) => t.tav_tipo === tipo)?.tav_precio;
  const moneda = a.tarifas[0]?.tav_moneda ?? a.atr_moneda;
  const precio = tarifa('ADULTO') ?? 0;
  const mayor = tarifa('MAYOR');
  const estudiante = tarifa('ESTUDIANTE');
  const activos = horarios.filter((h) => h.hor_activo !== false);
  const self = `/atracciones/${a.atr_uuid}`;
  const frontend = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '');
  const pilares = [a.atr_pilar_limpieza, a.atr_pilar_servicio, a.atr_pilar_relacion_valor, a.atr_pilar_puntualidad];
  return {
    id: a.atr_uuid,
    name: a.atr_nombre,
    slug: a.atr_slug,
    short_description: a.atr_descripcion_corta ?? a.atr_descripcion.slice(0, 160),
    long_description: a.atr_descripcion,
    duration: duracionIso(a.atr_duracion_horas),
    duration_hours: a.atr_duracion_horas,
    price: dinero(moneda, precio),
    child_price: dinero(moneda, tarifa('NINO') ?? precio),
    operator: { id: a.operador.ope_codigo, name: a.operador.ope_nombre },
    product_type: TIPO_A_WEB[a.atr_tipo] ?? 'GUIDED_TOUR',
    includes: lista('INCLUYE'),
    not_includes: lista('NO_INCLUYE'),
    recommendations: lista('RECOMENDACION'),
    categories: a.categorias.map((x) => x.cat_slug),
    badges: ahora - new Date(a.atr_creado_en).getTime() < DIAS_NUEVO * 86_400_000 ? ['new'] : [],
    locations: [{
      address: a.atr_direccion ?? c?.ciu_nombre ?? '',
      city: a.ciu_id,
      country: 'ec',
      coordinates: { latitude: a.atr_latitud, longitude: a.atr_longitud },
      type: 'attraction',
    }],
    destination: { code: a.ciu_id, name: c?.ciu_nombre ?? '', province: c?.prov_nombre ?? '', region: c?.reg_nombre ?? '' },
    photos: a.fotos.map((f) => ({ url: fotoAbsoluta(f.fot_url), alt: f.fot_alt })),
    supported_languages: a.idiomas.map((i) => i.idi_codigo),
    free_cancellation: a.atr_cancelacion_gratuita,
    cancellation_hours: a.atr_horas_cancelacion,
    times: activos.map((h) => h.hor_hora).sort(),
    capacity_per_slot: activos.reduce((m, h) => Math.max(m, h.hor_cupo), 0),
    meeting_point: a.atr_punto_encuentro ?? undefined,
    senior_price: mayor != null ? dinero(moneda, mayor) : undefined,
    student_price: estudiante != null ? dinero(moneda, estudiante) : undefined,
    includes_food: a.atr_incluye_comida,
    includes_transport: a.atr_incluye_transporte,
    includes_guide: a.atr_incluye_guia,
    wheelchair_accessible: a.atr_accesible_silla,
    stroller_accessible: a.atr_accesible_coche,
    service_animals_allowed: a.atr_animales_servicio,
    guide_name: a.atr_guia ?? undefined,
    arrival_instructions: a.atr_instrucciones_llegada ?? undefined,
    allows_package: a.atr_permite_paquete,
    package_discount: a.atr_descuento_paquete,
    itinerary: a.itinerario.map((s) => ({
      time: s.iti_hora.slice(0, 5),
      title: s.iti_titulo,
      description: s.iti_descripcion ?? undefined,
      duration_minutes: s.iti_duracion_min,
      location: s.iti_lugar ?? undefined,
    })),
    rating_breakdown: pilares.some((p) => p != null)
      ? { cleanliness: a.atr_pilar_limpieza ?? undefined, service: a.atr_pilar_servicio ?? undefined, value: a.atr_pilar_relacion_valor ?? undefined, punctuality: a.atr_pilar_puntualidad ?? undefined }
      : undefined,
    featured: a.atr_destacada,
    is_active: a.atr_estado === 'PUBLICADA',
    status: a.atr_estado,
    ratings: { number_of_reviews: a.atr_numero_resenas, score: a.atr_calificacion_promedio },
    url: { web: `${frontend}/atraccion/${a.atr_uuid}`, app: `descubreec://attractions/${a.atr_uuid}` },
    _links: { self: { href: self }, availability: { href: `${self}/availability` }, reviews: { href: `${self}/reviews` } },
  };
}

export interface Referencias {
  categorias: { cat_id: number; cat_slug: string }[];
  idiomas: { idi_id: number; idi_codigo: string }[];
  operadores: { ope_id: number; ope_codigo: number }[];
}

type Cuerpo = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Las fotos propias se guardan sin el token firmado de vista previa (?t=…). */
const fotoAGuardar = (url: string) => (/\/media\//.test(url) ? url.split('?')[0] : url);

/** Cuerpo del formulario del panel → campos de ms-catalog. Solo incluye lo que llegó (PATCH parcial). */
export function aCampos(b: Cuerpo, r: Referencias): Cuerpo {
  const d: Cuerpo = {};
  const pon = (campo: string, valor: unknown) => {
    if (valor !== undefined) d[campo] = valor;
  };
  const loc = b.locations?.[0];
  pon('atr_nombre', b.name);
  pon('atr_descripcion', b.long_description);
  pon('atr_descripcion_corta', b.short_description);
  pon('atr_tipo', b.product_type ? WEB_A_TIPO[b.product_type] ?? b.product_type : undefined);
  pon('atr_latitud', loc?.coordinates?.latitude);
  pon('atr_longitud', loc?.coordinates?.longitude);
  pon('atr_direccion', loc?.address);
  pon('ciu_id', loc?.city);
  pon('atr_punto_encuentro', b.meeting_point);
  pon('atr_duracion_horas', b.duration_hours ?? horasDeIso(b.duration));
  pon('atr_cancelacion_gratuita', b.free_cancellation);
  pon('atr_horas_cancelacion', b.cancellation_hours);
  pon('atr_destacada', b.featured);
  pon('atr_incluye_comida', b.includes_food);
  pon('atr_incluye_transporte', b.includes_transport);
  pon('atr_incluye_guia', b.includes_guide);
  pon('atr_accesible_silla', b.wheelchair_accessible);
  pon('atr_accesible_coche', b.stroller_accessible);
  pon('atr_animales_servicio', b.service_animals_allowed);
  pon('atr_guia', b.guide_name === '' ? undefined : b.guide_name);
  pon('atr_instrucciones_llegada', b.arrival_instructions === '' ? undefined : b.arrival_instructions);
  pon('atr_permite_paquete', b.allows_package);
  pon('atr_descuento_paquete', b.package_discount);
  if (b.operator?.id != null) {
    const op = r.operadores.find((o) => o.ope_codigo === Number(b.operator.id));
    if (op) d.ope_id = op.ope_id;
  }
  if (b.categories) d.cat_ids = b.categories.map((s: string) => r.categorias.find((c) => c.cat_slug === s)?.cat_id).filter(Boolean);
  if (b.supported_languages) d.idi_ids = b.supported_languages.map((s: string) => r.idiomas.find((i) => i.idi_codigo === s)?.idi_id).filter(Boolean);
  if (b.includes || b.not_includes || b.recommendations) {
    const textos = (tipo: string, l?: string[]) => (l ?? []).map((inc_nombre) => ({ inc_tipo: tipo, inc_nombre }));
    d.inclusiones_texto = [...textos('INCLUYE', b.includes), ...textos('NO_INCLUYE', b.not_includes), ...textos('RECOMENDACION', b.recommendations)];
  }
  if (b.photos) {
    d.fotos = b.photos.map((f: { url: string; alt?: string }) => ({ fot_url: fotoAGuardar(f.url), fot_alt: f.alt && f.alt.length >= 3 ? f.alt : b.name ?? 'Foto de la atracción' }));
  }
  if (b.itinerary) {
    d.itinerario = b.itinerary.map((x: Cuerpo, i: number) => ({
      iti_orden: i + 1, iti_hora: x.time, iti_titulo: x.title, iti_descripcion: x.description, iti_duracion_min: x.duration_minutes, iti_lugar: x.location,
    }));
  }
  return d;
}

/** Precios del formulario → tarifas de ms-pricing. Sin precio de adulto no cambia nada. */
export function aTarifas(b: Cuerpo): { tar_tipo: string; tar_precio: number }[] | null {
  if (b.price?.total == null) return null;
  const valor = (v: unknown) => (typeof v === 'object' && v ? (v as { total?: number }).total : (v as number | null | undefined));
  const t = [{ tar_tipo: 'ADULTO', tar_precio: Number(b.price.total) }];
  const extra: [string, unknown][] = [['NINO', b.child_price], ['MAYOR', b.senior_price], ['ESTUDIANTE', b.student_price]];
  for (const [tar_tipo, v] of extra) {
    const n = valor(v);
    if (n != null) t.push({ tar_tipo, tar_precio: Number(n) });
  }
  return t;
}

export function aHorarios(b: Cuerpo): { hor_hora: string; hor_cupo: number }[] | null {
  if (!Array.isArray(b.times) || b.capacity_per_slot == null) return null;
  return b.times.map((hor_hora: string) => ({ hor_hora, hor_cupo: Number(b.capacity_per_slot) }));
}

export interface Turno {
  dis_fecha: string;
  hor_hora: string;
  dis_cupo_total: number;
  dis_cupo_reservado: number;
  dis_cerrada: boolean;
}
export interface Bloqueo {
  fb_id: number;
  fb_fecha: string;
  fb_motivo: string;
}

/** Cupos de cada turno de un día: los mismos que descuenta una reserva de Booking. */
function salidas(fecha: string, hoy: string, ahora: string, horarios: Horario[], turnos: Turno[]) {
  const porHora = new Map(turnos.filter((t) => t.dis_fecha === fecha).map((t) => [t.hor_hora, t]));
  return horarios
    .filter((h) => h.hor_activo !== false && (fecha > hoy || h.hor_hora > ahora))
    .map((h) => {
      const t = porHora.get(h.hor_hora);
      const capacity = t?.dis_cupo_total ?? h.hor_cupo;
      return { time: h.hor_hora, capacity, available: t?.dis_cerrada ? 0 : Math.max(0, capacity - (t?.dis_cupo_reservado ?? 0)) };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function disponibilidadDia(fecha: string, hoy: string, ahora: string, horarios: Horario[], turnos: Turno[], bloqueos: Bloqueo[]) {
  const vacio = (reason: string) => ({ date: fecha, available_spots: 0, times: [] as string[], slots: [] as unknown[], unavailable_reason: reason });
  if (fecha < hoy) return vacio('La fecha seleccionada ya pasó.');
  const b = bloqueos.find((x) => x.fb_fecha === fecha);
  if (b) return vacio(`No opera este día: ${b.fb_motivo}`);
  const slots = salidas(fecha, hoy, ahora, horarios, turnos);
  const available_spots = slots.reduce((s, x) => s + x.available, 0);
  return {
    date: fecha,
    available_spots,
    times: slots.filter((s) => s.available > 0).map((s) => s.time),
    slots,
    ...(slots.length === 0 ? { unavailable_reason: 'Ya no quedan salidas para hoy.' } : available_spots === 0 ? { unavailable_reason: 'Agotado para esta fecha.' } : {}),
  };
}

export function calendarioMes(mes: string, hoy: string, ahora: string, horarios: Horario[], turnos: Turno[], bloqueos: Bloqueo[]) {
  const [anio, m] = mes.split('-').map(Number);
  const dias = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  return Array.from({ length: dias }, (_, i) => {
    const fecha = `${mes}-${String(i + 1).padStart(2, '0')}`;
    if (fecha < hoy) return { date: fecha, available_spots: 0, status: 'past' };
    const b = bloqueos.find((x) => x.fb_fecha === fecha);
    if (b) return { date: fecha, available_spots: 0, status: 'blocked', reason: b.fb_motivo };
    const slots = salidas(fecha, hoy, ahora, horarios, turnos);
    const capacidad = slots.reduce((s, x) => s + x.capacity, 0);
    const libres = slots.reduce((s, x) => s + x.available, 0);
    return { date: fecha, available_spots: libres, status: libres === 0 ? 'full' : libres <= Math.max(3, capacidad * 0.2) ? 'low' : 'available' };
  });
}

export interface FilaReserva {
  id: string;
  codigo: string;
  estado: string;
  fecha: string;
  hora: string;
  adultos: number;
  ninos: number;
  seniors: number;
  estudiantes: number;
  infantes: number;
  tickets: number;
  total: number;
  moneda: string;
  atr_uuid: string;
  atr_nombre: string;
  punto_encuentro: string | null;
  cancelacion_gratuita: boolean;
  horas_cancelacion: number;
  metodo: string | null;
  pago_estado: string | null;
  origen: string;
  observaciones: string | null;
  client_id: string | null;
  aviso_checkin: string | null;
  checkin_en: string | null;
  cancelado_en: string | null;
  motivo_cancelacion: string | null;
  creado_en: string;
  pax_nombre: string | null;
  pax_documento: string | null;
  pax_correo: string | null;
  pax_telefono: string | null;
  politica: { policy: string; freeUntil: string | Date | null };
}

const metodoWeb = (m: string | null) => (!m ? undefined : /SITIO/.test(m) ? 'EN_SITIO' : /TRANSF/.test(m) ? 'TRANSFERENCIA' : 'TARJETA');

/** El estado que ve la web: una reserva con el pago sin confirmar está pendiente. */
const statusWeb = (r: FilaReserva) => (r.estado === 'CANCELADA' ? 'CANCELLED' : r.pago_estado === 'PENDIENTE' && !r.checkin_en ? 'PENDING' : 'CONFIRMED');

export function reservaAWeb(r: FilaReserva, a?: ReturnType<typeof aWeb>) {
  const self = `/atracciones/reservations/${r.id}`;
  const status = statusWeb(r);
  const { policy, freeUntil } = r.politica;
  return {
    reservation_id: r.id,
    code: r.codigo,
    status,
    ticket_count: r.tickets,
    adults: r.adultos,
    children: r.ninos,
    seniors: r.seniors,
    infants: r.infantes,
    students: r.estudiantes,
    total_price: { currency: r.moneda, total: r.total },
    date: r.fecha,
    time: r.hora,
    attraction: {
      id: r.atr_uuid,
      name: r.atr_nombre,
      city: a?.destination.name ?? '',
      photo: a?.photos[0]?.url ?? '',
      meeting_point: r.punto_encuentro ?? undefined,
      free_cancellation: r.cancelacion_gratuita,
      cancellation_hours: r.horas_cancelacion,
    },
    customer: { name: r.pax_nombre ?? '', email: r.pax_correo ?? '', phone: r.pax_telefono ?? undefined, document: r.pax_documento ?? undefined },
    payment_method: metodoWeb(r.metodo),
    notes: r.observaciones ?? undefined,
    cancellation_reason: r.motivo_cancelacion ?? undefined,
    cancelled_at: r.cancelado_en ? new Date(r.cancelado_en).toISOString() : undefined,
    created_at: new Date(r.creado_en).toISOString(),
    can_cancel: policy !== 'NOT_ALLOWED',
    cancellation_policy: policy,
    refundable: policy === 'FULL_REFUND' || policy === 'NO_CHARGE',
    ...(freeUntil ? { free_cancellation_until: new Date(freeUntil).toISOString() } : {}),
    origin: r.origen,
    client_id: r.client_id ?? undefined,
    booking_notice: r.aviso_checkin ?? undefined,
    ...(r.checkin_en ? { checked_in_at: new Date(r.checkin_en).toISOString() } : {}),
    _links: { self: { href: self }, attraction: { href: `/atracciones/${r.atr_uuid}` } },
  };
}

const PAGO_A_CONTRATO: Record<string, string> = { TARJETA: 'TARJETA_CREDITO', TRANSFERENCIA: 'TRANSFERENCIA', EN_SITIO: 'PAGO_EN_SITIO' };

const tipoDocumento = (d: string) => (/^\d{13}$/.test(d) ? 'RUC' : /^\d{10}$/.test(d) ? 'CEDULA' : 'PASAPORTE');

/** Compra de la web → pedido de ms-booking. `ticket_count` incluye a todos los viajeros. */
export function aPedido(atrUuid: string, b: Cuerpo, correo: string | undefined, documento: string) {
  const [h, m] = String(b.time).split(':');
  const hhmm = `${h.padStart(2, '0')}:${m}`;
  const ninos = b.children ?? 0;
  const seniors = b.seniors ?? 0;
  const estudiantes = b.students ?? 0;
  const infantes = b.infants ?? 0;
  return {
    atraccion_id: atrUuid,
    fecha: b.date,
    slot_id: `slot-${String(b.date).replace(/-/g, '')}-${hhmm.replace(':', '')}`,
    hora: hhmm,
    adult_count: b.ticket_count - ninos - seniors - estudiantes - infantes,
    child_count: ninos,
    senior_count: seniors,
    student_count: estudiantes,
    infant_count: infantes,
    customer: { full_name: b.customer_name, email: b.customer_email ?? correo, phone: b.customer_phone, document_type: tipoDocumento(documento), document_id: documento },
    payment_method: PAGO_A_CONTRATO[b.payment_method ?? 'TARJETA'] ?? 'TARJETA_CREDITO',
    ...(b.notes ? { special_requirements: b.notes } : {}),
  };
}

const plano = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const soloAlfanumerico = (t: string) => t.replace(/[^0-9a-z]/gi, '').toLowerCase();

/**
 * Buscador del panel: código, titular, correo, cédula o teléfono. La cédula y el teléfono se comparan sin
 * espacios ni guiones, así «171003406-5» encuentra 1710034065.
 */
export function coincideBusqueda(r: ReturnType<typeof reservaAWeb>, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  const texto = plano(q.trim());
  if ([r.code, r.customer.name, r.customer.email].some((t) => plano(t ?? '').includes(texto))) return true;
  const digitos = soloAlfanumerico(q);
  return digitos.length >= 4 && [r.customer.document, r.customer.phone].some((t) => !!t && soloAlfanumerico(t).includes(digitos));
}
