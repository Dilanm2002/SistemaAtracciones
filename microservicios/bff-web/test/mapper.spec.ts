import { aCampos, coincideBusqueda, aHorarios, aPedido, aTarifas, aWeb, Atraccion, calendarioMes, disponibilidadDia, FilaReserva, horasDeIso, reservaAWeb } from '../src/mapper';

const BASE = {
  atr_id: 7, atr_uuid: '0aa62c9e-4aa3-44c2-aae4-964fa13b46fb', atr_nombre: 'Cotopaxi', atr_slug: 'cotopaxi', atr_descripcion: 'Una descripción larga del parque nacional', atr_descripcion_corta: null,
  atr_tipo: 'DAY_TRIP', atr_estado: 'PUBLICADA', atr_latitud: -0.6, atr_longitud: -78.4, atr_direccion: null, atr_punto_encuentro: 'Parque', atr_duracion_horas: 2.5, atr_moneda: 'USD', ciu_id: 1,
  atr_cancelacion_gratuita: true, atr_horas_cancelacion: 24, atr_destacada: true, atr_calificacion_promedio: 4.5, atr_numero_resenas: 3, atr_creado_en: '2026-01-01T00:00:00Z',
  atr_incluye_comida: true, atr_incluye_transporte: false, atr_incluye_guia: true, atr_accesible_silla: false, atr_accesible_coche: false, atr_animales_servicio: false,
  atr_guia: null, atr_instrucciones_llegada: null, atr_permite_paquete: false, atr_descuento_paquete: 0, atr_pilar_limpieza: null, atr_pilar_servicio: null, atr_pilar_relacion_valor: null, atr_pilar_puntualidad: null,
  operador: { ope_codigo: 3, ope_nombre: 'Andes' }, categorias: [{ cat_nombre: 'Naturaleza', cat_slug: 'naturaleza' }], idiomas: [{ idi_codigo: 'es' }],
  inclusiones: [{ inc_tipo: 'INCLUYE', inc_nombre: 'Almuerzo' }, { inc_tipo: 'RECOMENDACION', inc_nombre: 'Abrigo' }], fotos: [{ fot_url: '/media/a.jpg', fot_alt: 'Volcán' }],
  itinerario: [{ iti_hora: '09:00:00', iti_titulo: 'Salida', iti_descripcion: null, iti_duracion_min: 30, iti_lugar: null }],
  tarifas: [{ tav_tipo: 'ADULTO', tav_precio: 65, tav_moneda: 'USD' }, { tav_tipo: 'NINO', tav_precio: 45, tav_moneda: 'USD' }],
} as Atraccion;
const CIUDAD = { ciu_id: 1, ciu_nombre: 'Quito', prov_nombre: 'Pichincha', reg_nombre: 'Sierra' };
const HORARIOS = [{ hor_hora: '14:00', hor_cupo: 6, hor_activo: true }, { hor_hora: '09:00', hor_cupo: 20, hor_activo: true }, { hor_hora: '20:00', hor_cupo: 99, hor_activo: false }];

describe('aWeb: atracción de los microservicios → formato de la web', () => {
  process.env.FOTOS_BASE_URL = 'https://fotos.test';
  const w = aWeb(BASE, CIUDAD, HORARIOS);

  it('precios, inclusiones, destino y fotos absolutas', () => {
    expect(w).toMatchObject({
      id: BASE.atr_uuid, duration: 'PT2H30M', price: { currency: 'USD', total: 65 }, child_price: { total: 45 }, product_type: 'GUIDED_TOUR',
      includes: ['Almuerzo'], recommendations: ['Abrigo'], not_includes: [], categories: ['naturaleza'], supported_languages: ['es'],
      destination: { code: 1, name: 'Quito', province: 'Pichincha', region: 'Sierra' }, photos: [{ url: 'https://fotos.test/media/a.jpg', alt: 'Volcán' }],
      is_active: true, ratings: { number_of_reviews: 3, score: 4.5 }, operator: { id: 3, name: 'Andes' },
    });
    expect(w.itinerary[0].time).toBe('09:00');
  });

  it('solo los horarios activos, ordenados; el cupo es el mayor', () => {
    expect(w.times).toEqual(['09:00', '14:00']);
    expect(w.capacity_per_slot).toBe(20);
  });

  it('sin tarifa aún (el evento tarda unos segundos) el precio es 0, no un error', () => {
    expect(aWeb({ ...BASE, tarifas: [] }, CIUDAD).price.total).toBe(0);
  });
});

describe('aCampos / aTarifas / aHorarios: formulario del panel → microservicios', () => {
  const REF = { categorias: [{ cat_id: 4, cat_slug: 'naturaleza' }], idiomas: [{ idi_id: 2, idi_codigo: 'es' }], operadores: [{ ope_id: 9, ope_codigo: 3 }] };
  const FORM = {
    name: 'Cotopaxi', long_description: 'Descripción', duration: 'PT1H30M', price: { currency: 'USD', total: 65 }, child_price: 45, senior_price: null, student_price: 50,
    operator: { id: 3 }, product_type: 'SINGLE_TICKET', includes: ['Almuerzo'], not_includes: [], recommendations: ['Abrigo'], categories: ['naturaleza', 'no-existe'],
    locations: [{ address: 'Av. 1', city: 1, coordinates: { latitude: -1, longitude: -78 } }], photos: [{ url: 'https://x.test/media/a.jpg?t=firma' }, { url: 'https://y.test/b.jpg?w=1' }],
    supported_languages: ['es'], times: ['09:00', '14:00'], capacity_per_slot: 15, guide_name: '',
    itinerary: [{ time: '09:00', title: 'Salida', duration_minutes: 30 }],
  };

  it('traduce los campos y resuelve códigos a ids', () => {
    expect(aCampos(FORM, REF)).toMatchObject({
      atr_nombre: 'Cotopaxi', atr_tipo: 'ADMISSION', atr_duracion_horas: 1.5, ciu_id: 1, ope_id: 9, cat_ids: [4], idi_ids: [2],
      inclusiones_texto: [{ inc_tipo: 'INCLUYE', inc_nombre: 'Almuerzo' }, { inc_tipo: 'RECOMENDACION', inc_nombre: 'Abrigo' }],
      itinerario: [{ iti_orden: 1, iti_hora: '09:00', iti_titulo: 'Salida', iti_duracion_min: 30 }],
    });
  });

  it('a las fotos propias les quita el token de vista previa, a las ajenas no', () => {
    expect(aCampos(FORM, REF).fotos.map((f: { fot_url: string }) => f.fot_url)).toEqual(['https://x.test/media/a.jpg', 'https://y.test/b.jpg?w=1']);
  });

  it('un PATCH parcial solo lleva lo que llegó', () => {
    expect(aCampos({ featured: true }, REF)).toEqual({ atr_destacada: true });
  });

  it('precios: ignora los vacíos; sin precio de adulto no cambia nada', () => {
    expect(aTarifas(FORM)).toEqual([{ tar_tipo: 'ADULTO', tar_precio: 65 }, { tar_tipo: 'NINO', tar_precio: 45 }, { tar_tipo: 'ESTUDIANTE', tar_precio: 50 }]);
    expect(aTarifas({ featured: true })).toBeNull();
  });

  it('cupos por salida', () => {
    expect(aHorarios(FORM)).toEqual([{ hor_hora: '09:00', hor_cupo: 15 }, { hor_hora: '14:00', hor_cupo: 15 }]);
    expect(aHorarios({ featured: true })).toBeNull();
  });

  it('duración ISO', () => {
    expect(horasDeIso('PT2H')).toBe(2);
    expect(horasDeIso('PT45M')).toBe(0.75);
    expect(horasDeIso('nada')).toBeUndefined();
  });
});

describe('disponibilidad: los cupos reservados desde Booking se ven en la web', () => {
  const H = HORARIOS;
  const T = [{ dis_fecha: '2030-01-10', hor_hora: '09:00', dis_cupo_total: 20, dis_cupo_reservado: 5, dis_cerrada: false }, { dis_fecha: '2030-01-10', hor_hora: '14:00', dis_cupo_total: 6, dis_cupo_reservado: 6, dis_cerrada: false }];

  it('descuenta lo reservado; el turno sin registro tiene todo su cupo', () => {
    expect(disponibilidadDia('2030-01-10', '2030-01-01', '10:00', H, T, [])).toEqual({
      date: '2030-01-10', available_spots: 15, times: ['09:00'], slots: [{ time: '09:00', capacity: 20, available: 15 }, { time: '14:00', capacity: 6, available: 0 }],
    });
    expect(disponibilidadDia('2030-01-11', '2030-01-01', '10:00', H, T, []).available_spots).toBe(26);
  });

  it('hoy: las salidas ya pasadas no se ofrecen', () => {
    expect(disponibilidadDia('2030-01-10', '2030-01-10', '10:00', H, T, []).slots).toEqual([{ time: '14:00', capacity: 6, available: 0 }]);
  });

  it('fecha pasada o bloqueada', () => {
    expect(disponibilidadDia('2029-12-31', '2030-01-01', '10:00', H, T, []).unavailable_reason).toMatch(/ya pasó/);
    expect(disponibilidadDia('2030-01-10', '2030-01-01', '10:00', H, T, [{ fb_id: 1, fb_fecha: '2030-01-10', fb_motivo: 'Feriado' }]).unavailable_reason).toMatch(/Feriado/);
  });

  it('calendario: todos los días del mes con su estado', () => {
    const m = calendarioMes('2030-01', '2030-01-05', '10:00', H, T, [{ fb_id: 1, fb_fecha: '2030-01-20', fb_motivo: 'Feriado' }]);
    expect(m).toHaveLength(31);
    expect(m[0].status).toBe('past');
    expect(m[9]).toEqual({ date: '2030-01-10', available_spots: 15, status: 'available' });
    expect(m[19]).toEqual({ date: '2030-01-20', available_spots: 0, status: 'blocked', reason: 'Feriado' });
    // Hoy después de la última salida: día pasado, no «agotado»
    expect(calendarioMes('2030-01', '2030-01-10', '23:00', H, T, [])[9]).toEqual({ date: '2030-01-10', available_spots: 0, status: 'past' });
  });
});

describe('reservas', () => {
  const FILA = {
    id: 'u1', codigo: 'DEC-ABC', estado: 'CONFIRMADA', fecha: '2030-01-10', hora: '09:00', adultos: 1, ninos: 1, seniors: 0, estudiantes: 0, infantes: 0, tickets: 2, total: 110, moneda: 'USD',
    atr_uuid: BASE.atr_uuid, atr_nombre: 'Cotopaxi', punto_encuentro: 'Parque', cancelacion_gratuita: true, horas_cancelacion: 24, metodo: 'TARJETA', pago_estado: 'APROBADO', origen: 'BOOKING',
    observaciones: null, client_id: 'DEC-USR-1', aviso_checkin: null, checkin_en: null, cancelado_en: null, motivo_cancelacion: null, creado_en: '2030-01-01T00:00:00Z',
    pax_nombre: 'Luis Andrade', pax_documento: '1724589633', pax_correo: 'l@a.com', pax_telefono: '099', politica: { policy: 'FULL_REFUND', freeUntil: '2030-01-09T14:00:00Z' },
  } as FilaReserva;

  it('una reserva de Booking se muestra en el panel con su origen', () => {
    expect(reservaAWeb(FILA)).toMatchObject({
      reservation_id: 'u1', code: 'DEC-ABC', status: 'CONFIRMED', ticket_count: 2, origin: 'BOOKING', client_id: 'DEC-USR-1', payment_method: 'TARJETA', can_cancel: true, refundable: true,
      customer: { name: 'Luis Andrade', document: '1724589633' }, total_price: { total: 110 }, free_cancellation_until: '2030-01-09T14:00:00.000Z',
    });
  });

  it('el buscador del panel encuentra por código, titular, correo, cédula o teléfono', () => {
    const r = reservaAWeb(FILA);
    for (const q of ['dec-abc', 'Luis', 'andrade', 'l@a.com', '1724589633', '172458963-3', '17245', undefined, '']) expect(coincideBusqueda(r, q)).toBe(true);
    for (const q of ['9999999999', 'Pepito', '17']) expect(coincideBusqueda(r, q)).toBe(false);
  });

  it('pago pendiente = PENDING; cancelada = CANCELLED; con check-in muestra la hora', () => {
    expect(reservaAWeb({ ...FILA, metodo: 'EN_SITIO', pago_estado: 'PENDIENTE' })).toMatchObject({ status: 'PENDING', payment_method: 'EN_SITIO' });
    expect(reservaAWeb({ ...FILA, estado: 'CANCELADA' }).status).toBe('CANCELLED');
    expect(reservaAWeb({ ...FILA, checkin_en: '2030-01-10T14:00:00Z' }).checked_in_at).toBe('2030-01-10T14:00:00.000Z');
  });

  it('una compra de la web arma el pedido de la saga; ticket_count incluye a todos', () => {
    const p = aPedido(BASE.atr_uuid, { date: '2030-01-10', time: '09:00', ticket_count: 4, children: 1, seniors: 1, customer_name: 'Luis Andrade', customer_phone: '0991234567', payment_method: 'EN_SITIO', notes: 'Vegano' }, 'l@a.com', '1724589633');
    expect(p).toEqual({
      atraccion_id: BASE.atr_uuid, fecha: '2030-01-10', slot_id: 'slot-20300110-0900', hora: '09:00', adult_count: 2, child_count: 1, senior_count: 1, student_count: 0, infant_count: 0,
      customer: { full_name: 'Luis Andrade', email: 'l@a.com', phone: '0991234567', document_type: 'CEDULA', document_id: '1724589633' }, payment_method: 'PAGO_EN_SITIO', special_requirements: 'Vegano',
    });
  });

  it('tipo de documento según su forma', () => {
    const doc = (d: string) => aPedido('x', { date: '2030-01-10', time: '09:00', ticket_count: 1 }, 'a@b.c', d).customer.document_type;
    expect([doc('1724589633'), doc('1790012345001'), doc('AB123456')]).toEqual(['CEDULA', 'RUC', 'PASAPORTE']);
  });
});
