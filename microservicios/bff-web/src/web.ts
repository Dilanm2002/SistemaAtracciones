import { BadRequestException, Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, Headers, HttpCode, HttpException, Injectable, NotFoundException, Param, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { Usuario, verificarJwt } from './comun/auth';
import { aCampos, aHorarios, aPedido, aTarifas, aWeb, Atraccion, Bloqueo, calendarioMes, Ciudad, disponibilidadDia, FilaReserva, Horario, Referencias, reservaAWeb, TIPOS_DE, Turno } from './mapper';

const PUERTOS: Record<string, [string, number]> = {
  location: ['LOCATION_URL', 4001], catalog: ['CATALOG_URL', 4002], review: ['REVIEW_URL', 4003], pricing: ['PRICING_URL', 4004], inventory: ['INVENTORY_URL', 4005], booking: ['BOOKING_URL', 4008],
};
const url = (s: string) => (process.env[PUERTOS[s][0]] ?? `http://localhost:${PUERTOS[s][1]}`).replace(/\/$/, '');

interface Opciones {
  cuerpo?: unknown;
  auth?: string;
  idem?: string;
}

/** Llama a un microservicio. Sus errores llegan a la web con el mismo código y mensaje. */
async function llamar<T>(servicio: string, metodo: string, ruta: string, o: Opciones = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${url(servicio)}${ruta}`, {
      method: metodo,
      headers: {
        Accept: 'application/json',
        ...(o.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(o.auth ? { Authorization: o.auth } : {}),
        ...(o.idem ? { 'Idempotency-Key': o.idem } : {}),
      },
      body: o.cuerpo !== undefined ? JSON.stringify(o.cuerpo) : undefined,
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new HttpException({ message: 'Un servicio no respondió. Intenta de nuevo en un momento.', code: 'SERVICE_UNAVAILABLE' }, 503);
  }
  if (r.status === 204) return null as T;
  const datos = (await r.json().catch(() => null)) as (T & { detail?: string; title?: string; code?: string; invalid_params?: { name: string; reason: string }[] }) | null;
  if (!r.ok) {
    const razones = datos?.invalid_params?.map((p) => p.reason).join('; ');
    throw new HttpException({ message: razones || datos?.detail || datos?.title || 'Error del servicio', code: datos?.code, invalid_params: datos?.invalid_params }, r.status);
  }
  return datos as T;
}

const hoyEc = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const horaEc = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(11, 16);
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esPersonal = (u?: Usuario | null) => !!u && [u.rol, ...(u.roles ?? [])].some((r) => r === 'ADMIN' || r === 'OPERADOR');
const esAdmin = (u?: Usuario | null) => !!u && [u.rol, ...(u.roles ?? [])].includes('ADMIN');
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Peticion = Request & { usuario?: Usuario };
const CACHE_MS = 10_000;

/** Lee el JWT si viene; con `obligatorio` lo exige. La firma la vuelven a comprobar los microservicios. */
function usuarioDe(req: Request): Usuario | null {
  const [tipo, token] = (req.header('authorization') ?? '').split(' ');
  if (!token) return null;
  const u = /^(Bearer|DPoP)$/i.test(tipo) && process.env.JWT_SECRET ? verificarJwt(token, process.env.JWT_SECRET) : null;
  if (!u) throw new UnauthorizedException({ message: 'Tu sesión venció. Vuelve a iniciar sesión.', code: 'UNAUTHORIZED' });
  return u;
}

@Injectable()
export class ConSesion implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Peticion>();
    const u = usuarioDe(req);
    if (!u) throw new UnauthorizedException({ message: 'Inicia sesión para continuar.', code: 'UNAUTHORIZED' });
    req.usuario = u;
    return true;
  }
}

/** Reúne el catálogo con ciudades y horarios; lo que cambia poco se guarda unos segundos en memoria. */
@Injectable()
export class CatalogoWeb {
  private lista: { datos: Atraccion[]; hasta: number } | null = null;
  private ciudadesCache: { datos: Map<number, Ciudad>; hasta: number } | null = null;

  invalidar() {
    this.lista = null;
  }

  async todas(): Promise<Atraccion[]> {
    if (this.lista && this.lista.hasta > Date.now()) return this.lista.datos;
    const datos: Atraccion[] = [];
    for (let page = 1; ; page++) {
      const r = await llamar<{ data: Atraccion[]; total: number }>('catalog', 'GET', `/api/v1/atracciones?limit=100&page=${page}`);
      datos.push(...r.data);
      if (!r.data.length || datos.length >= r.total) break;
    }
    this.lista = { datos, hasta: Date.now() + CACHE_MS };
    return datos;
  }

  async ciudades(): Promise<Map<number, Ciudad>> {
    if (this.ciudadesCache && this.ciudadesCache.hasta > Date.now()) return this.ciudadesCache.datos;
    const c = await llamar<Ciudad[]>('location', 'GET', '/api/v1/ciudades');
    const datos = new Map(c.map((x) => [Number(x.ciu_id), x]));
    this.ciudadesCache = { datos, hasta: Date.now() + 300_000 };
    return datos;
  }

  horarios(atrId: number) {
    return llamar<Horario[]>('inventory', 'GET', `/api/v1/horarios?atr_id=${atrId}`).then((h) => h.map((x) => ({ ...x, hor_hora: x.hor_hora.slice(0, 5) })));
  }

  async una(ref: string): Promise<Atraccion> {
    const a = (await this.todas()).find((x) => x.atr_uuid === ref || x.atr_slug === ref)
      ?? (await llamar<Atraccion>('catalog', 'GET', `/api/v1/atracciones/${encodeURIComponent(ref)}`));
    return a;
  }

  /** Atracción en el formato de la web, con sus horarios. */
  async completa(a: Atraccion) {
    const [c, h] = await Promise.all([this.ciudades(), this.horarios(a.atr_id).catch(() => [] as Horario[])]);
    return aWeb(a, c.get(Number(a.ciu_id)), h);
  }

  async referencias(): Promise<Referencias> {
    const [categorias, idiomas, operadores] = await Promise.all([
      llamar<Referencias['categorias']>('catalog', 'GET', '/api/v1/categorias'),
      llamar<Referencias['idiomas']>('catalog', 'GET', '/api/v1/idiomas'),
      llamar<Referencias['operadores']>('catalog', 'GET', '/api/v1/operadores'),
    ]);
    return { categorias, idiomas, operadores };
  }
}

@Controller({ path: 'atracciones', version: '1' })
export class AtraccionesWebController {
  constructor(private readonly c: CatalogoWeb) {}

  // ── Público ──

  @Post('search')
  @HttpCode(200)
  async search(@Body() b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const f = b.filters ?? {};
    const [todas, ciudades] = await Promise.all([this.c.todas(), this.c.ciudades()]);
    const precio = (a: Atraccion) => a.tarifas.find((t) => t.tav_tipo === 'ADULTO')?.tav_precio ?? 0;
    const q = f.query?.trim() ? sinTildes(f.query.trim()) : null;
    const tipos: string[] | null = f.product_types?.length ? f.product_types.flatMap((t: string) => TIPOS_DE[t] ?? []) : null;
    const lista = todas.filter((a) => {
      if (a.atr_estado !== 'PUBLICADA') return false;
      const ciudad = ciudades.get(Number(a.ciu_id));
      if (b.cities?.length && !b.cities.includes(Number(a.ciu_id))) return false;
      if (q && ![a.atr_nombre, a.atr_descripcion, ciudad?.ciu_nombre ?? '', ciudad?.prov_nombre ?? ''].some((t) => sinTildes(t).includes(q))) return false;
      if (f.categories?.length && !a.categorias.some((x) => f.categories.includes(x.cat_slug))) return false;
      if (f.regions?.length && !f.regions.includes(ciudad?.reg_nombre)) return false;
      if (f.duration?.min_hours != null && a.atr_duracion_horas < f.duration.min_hours) return false;
      if (f.duration?.max_hours != null && a.atr_duracion_horas > f.duration.max_hours) return false;
      if (f.free_cancellation && !a.atr_cancelacion_gratuita) return false;
      if (tipos && !tipos.includes(a.atr_tipo)) return false;
      if (f.rating?.minimum_review_score != null && a.atr_calificacion_promedio < f.rating.minimum_review_score) return false;
      if (f.rating?.minimum_review_count != null && a.atr_numero_resenas < f.rating.minimum_review_count) return false;
      if (f.price?.min != null && precio(a) < f.price.min) return false;
      if (f.price?.max != null && precio(a) > f.price.max) return false;
      return true;
    });
    const orden: Record<string, (x: Atraccion, y: Atraccion) => number> = {
      price_asc: (x, y) => precio(x) - precio(y),
      price_desc: (x, y) => precio(y) - precio(x),
      rating: (x, y) => y.atr_calificacion_promedio - x.atr_calificacion_promedio || y.atr_numero_resenas - x.atr_numero_resenas,
      newest: (x, y) => new Date(y.atr_creado_en).getTime() - new Date(x.atr_creado_en).getTime(),
      duration: (x, y) => x.atr_duracion_horas - y.atr_duracion_horas,
    };
    lista.sort(orden[b.sort?.by] ?? ((x, y) => Number(y.atr_destacada) - Number(x.atr_destacada) || y.atr_numero_resenas - x.atr_numero_resenas));
    const rows = Math.min(Number(b.rows) || 12, 100);
    let offset = 0;
    try {
      offset = b.next_page ? Number(JSON.parse(Buffer.from(String(b.next_page), 'base64').toString()).offset) || 0 : 0;
    } catch {
      throw new BadRequestException('next_page no es válido.');
    }
    const pagina = lista.slice(offset, offset + rows);
    const siguiente = offset + pagina.length;
    return {
      data: pagina.map((a) => aWeb(a, ciudades.get(Number(a.ciu_id)))),
      metadata: { total_results: lista.length, ...(siguiente < lista.length ? { next_page: Buffer.from(JSON.stringify({ offset: siguiente })).toString('base64') } : {}) },
      request_id: randomUUID(),
    };
  }

  @Post('details')
  @HttpCode(200)
  async details(@Body() b: { attractions?: string[] }) {
    const ids = new Set((b.attractions ?? []).slice(0, 50));
    const lista = (await this.c.todas()).filter((a) => ids.has(a.atr_uuid) && a.atr_estado === 'PUBLICADA');
    return { data: await Promise.all(lista.map((a) => this.c.completa(a))) };
  }

  @Get()
  async listar(@Query() q: Record<string, string>, @Req() req: Peticion) {
    const u = usuarioDe(req);
    let lista = await this.c.todas();
    if (q.status === 'all' && esPersonal(u)) {
      if (!esAdmin(u)) lista = lista.filter((a) => a.operador.ope_codigo === u!.operador);
    } else {
      lista = lista.filter((a) => a.atr_estado === 'PUBLICADA');
    }
    if (q.featured === 'true') lista = lista.filter((a) => a.atr_destacada);
    const limite = Math.min(Number(q.limit) || 20, 200);
    const data = await Promise.all(lista.slice(0, limite).map((a) => this.c.completa(a)));
    return { data, metadata: { total_results: lista.length } };
  }

  // ── Reservas (se declaran antes de :id) ──

  private async aWebVarias(filas: FilaReserva[]) {
    const [todas, ciudades] = await Promise.all([this.c.todas(), this.c.ciudades()]);
    const porUuid = new Map(todas.map((a) => [a.atr_uuid, aWeb(a, ciudades.get(Number(a.ciu_id)))]));
    return filas.map((r) => reservaAWeb(r, porUuid.get(r.atr_uuid)));
  }

  @Get('reservations')
  @UseGuards(ConSesion)
  async reservas(@Query() q: Record<string, string>, @Req() req: Peticion) {
    const filas = await llamar<FilaReserva[]>('booking', 'GET', `/api/v1/web/reservas${q.all === 'true' ? '?todas=true' : ''}`, { auth: req.header('authorization') });
    const hoy = hoyEc();
    const texto = q.q ? sinTildes(q.q) : null;
    const lista = await this.aWebVarias(filas);
    return lista.filter((r) => {
      if (q.status && r.status !== q.status) return false;
      if (q.when === 'upcoming' && r.date < hoy) return false;
      if (q.when === 'past' && r.date >= hoy) return false;
      if (q.date && r.date !== q.date) return false;
      if (q.attraction_id && r.attraction.id !== q.attraction_id) return false;
      return !texto || [r.code, r.customer.name, r.customer.email].some((t) => sinTildes(t).includes(texto));
    });
  }

  @Get('reservations/:rid')
  @UseGuards(ConSesion)
  async reserva(@Param('rid') rid: string, @Req() req: Peticion) {
    const r = await llamar<FilaReserva>('booking', 'GET', `/api/v1/web/reservas/${encodeURIComponent(rid)}`, { auth: req.header('authorization') });
    return (await this.aWebVarias([r]))[0];
  }

  @Get('reservations/:rid/calendar-link')
  @UseGuards(ConSesion)
  async calendario(@Param('rid') rid: string, @Req() req: Peticion) {
    const r = await llamar<{ url: string }>('booking', 'GET', `/api/v1/web/reservas/${encodeURIComponent(rid)}/calendario`, { auth: req.header('authorization') });
    return r;
  }

  @Post('reservations/:rid/cancel')
  @HttpCode(200)
  @UseGuards(ConSesion)
  async cancelar(@Param('rid') rid: string, @Body() b: { reason?: string; accept_no_refund?: boolean }, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    const r = await llamar<FilaReserva>('booking', 'POST', `/api/v1/web/reservas/${encodeURIComponent(rid)}/cancelar`, { auth: req.header('authorization'), idem: key, cuerpo: b });
    return (await this.aWebVarias([r]))[0];
  }

  @Post('reservations/:rid/confirm')
  @HttpCode(200)
  @UseGuards(ConSesion)
  async confirmar(@Param('rid') rid: string, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    const r = await llamar<FilaReserva>('booking', 'POST', `/api/v1/web/reservas/${encodeURIComponent(rid)}/confirmar`, { auth: req.header('authorization'), idem: key, cuerpo: {} });
    return (await this.aWebVarias([r]))[0];
  }

  @Post('reservations/:rid/checkin')
  @HttpCode(200)
  @UseGuards(ConSesion)
  checkin(@Param('rid') rid: string, @Body() b: { documento_identidad: string }, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    return llamar('booking', 'POST', `/api/v1/web/reservas/${encodeURIComponent(rid)}/checkin`, { auth: req.header('authorization'), idem: key ?? randomUUID(), cuerpo: b });
  }

  // ── Una atracción ──

  @Get(':id')
  async una(@Param('id') id: string, @Req() req: Peticion) {
    const a = await this.c.una(id);
    if (a.atr_estado !== 'PUBLICADA' && !esPersonal(usuarioDe(req))) throw new NotFoundException(`La atracción ${id} no existe.`);
    return this.c.completa(a);
  }

  private async inventario(atrId: number, desde: string, hasta: string) {
    const [horarios, turnos, bloqueos] = await Promise.all([
      this.c.horarios(atrId),
      llamar<Turno[]>('inventory', 'GET', `/api/v1/disponibilidad?atr_id=${atrId}&desde=${desde}&hasta=${hasta}`),
      llamar<Bloqueo[]>('inventory', 'GET', `/api/v1/fechas-bloqueadas?atr_id=${atrId}`),
    ]);
    return { horarios, turnos: turnos.map((t) => ({ ...t, hor_hora: t.hor_hora.slice(0, 5) })), bloqueos };
  }

  @Get(':id/availability')
  async disponibilidad(@Param('id') id: string, @Query('date') date: string) {
    if (!RE_FECHA.test(date ?? '')) throw new BadRequestException('Indica la fecha en date (AAAA-MM-DD).');
    const a = await this.c.una(id);
    const hoy = hoyEc();
    // Sin consultar el pasado: ms-inventory solo acepta el rango desde hoy
    const { horarios, turnos, bloqueos } = date < hoy ? { horarios: [], turnos: [], bloqueos: [] } : await this.inventario(a.atr_id, date, date);
    return disponibilidadDia(date, hoy, horaEc(), horarios, turnos, bloqueos);
  }

  @Get(':id/availability/calendar')
  async calendarioMes(@Param('id') id: string, @Query('month') month: string) {
    if (!RE_MES.test(month ?? '')) throw new BadRequestException('Indica el mes en month (AAAA-MM).');
    const a = await this.c.una(id);
    const hoy = hoyEc();
    const finMes = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()).padStart(2, '0')}`;
    const { horarios, turnos, bloqueos } = finMes < hoy ? { horarios: [], turnos: [], bloqueos: [] } : await this.inventario(a.atr_id, `${month}-01`, finMes);
    return calendarioMes(month, hoy, horaEc(), horarios, turnos, bloqueos);
  }

  @Post(':id/reservations')
  @UseGuards(ConSesion)
  async reservar(@Param('id') id: string, @Body() b: Record<string, any>, @Headers('idempotency-key') key: string, @Req() req: Peticion) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const documento = String(b.customer_document ?? '').replace(/[\s.-]/g, '').toUpperCase();
    if (!documento) throw new BadRequestException({ message: 'Indica el documento del titular: se valida en el punto de encuentro.', code: 'VALIDATION_FAILED' });
    const a = await this.c.una(id);
    const auth = req.header('authorization');
    const hecha = await llamar<{ reservation_id: string }>('booking', 'POST', '/api/v1/web/reservas', { auth, idem: key, cuerpo: aPedido(a.atr_uuid, b, req.usuario!.email, documento) });
    const r = await llamar<FilaReserva>('booking', 'GET', `/api/v1/web/reservas/${hecha.reservation_id}`, { auth });
    return (await this.aWebVarias([r]))[0];
  }

  // ── Panel: crear y editar ──

  /** Crea en BORRADOR, fija precios y cupos, y solo entonces publica: Booking nunca ve una atracción a medias. */
  @Post()
  @UseGuards(ConSesion)
  async crear(@Body() b: Record<string, any>, @Req() req: Peticion) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!esPersonal(req.usuario)) throw new ForbiddenException({ message: 'No tienes permisos para esta acción.', code: 'FORBIDDEN' });
    const auth = req.header('authorization');
    const tarifas = aTarifas(b);
    const horarios = aHorarios(b);
    if (!tarifas) throw new BadRequestException('Indica el precio de adulto.');
    if (!horarios?.length) throw new BadRequestException('Indica al menos un horario y los cupos por salida.');
    const a = await llamar<Atraccion>('catalog', 'POST', '/api/v1/atracciones', { auth, cuerpo: { ...aCampos(b, await this.c.referencias()), atr_estado: 'BORRADOR' } });
    try {
      await llamar('pricing', 'PUT', `/api/v1/tarifas/${a.atr_id}`, { auth, cuerpo: { tarifas } });
      await llamar('inventory', 'PUT', `/api/v1/horarios/${a.atr_id}`, { auth, cuerpo: { horarios } });
    } catch (e) {
      await llamar('catalog', 'DELETE', `/api/v1/atracciones/${a.atr_id}`, { auth }).catch(() => undefined);
      throw e;
    }
    // Lo que sube una empresa queda pendiente hasta que un administrador lo apruebe
    const publicar = esAdmin(req.usuario) && b.is_active !== false;
    const final = publicar ? await llamar<Atraccion>('catalog', 'PATCH', `/api/v1/atracciones/${a.atr_id}`, { auth, cuerpo: { atr_estado: 'PUBLICADA' } }) : a;
    this.c.invalidar();
    const web = await this.c.completa(final);
    return { ...web, price: b.price, child_price: { currency: b.price.currency, total: b.child_price ?? b.price.total } };
  }

  @Patch(':id')
  @UseGuards(ConSesion)
  async actualizar(@Param('id') id: string, @Body() b: Record<string, any>, @Req() req: Peticion) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!esPersonal(req.usuario)) throw new ForbiddenException({ message: 'No tienes permisos para esta acción.', code: 'FORBIDDEN' });
    const auth = req.header('authorization');
    const a0 = await this.c.una(id);
    const campos = aCampos(b, await this.c.referencias());
    delete campos.ope_id; // la empresa dueña no cambia al editar
    if (b.is_active !== undefined && (esAdmin(req.usuario) || a0.atr_estado !== 'BORRADOR')) campos.atr_estado = b.is_active ? 'PUBLICADA' : 'INACTIVA';
    const tarifas = aTarifas(b);
    const horarios = aHorarios(b);
    // Permisos sobre esta atracción: los comprueba ms-catalog, por eso va primero
    const a = await llamar<Atraccion>('catalog', 'PATCH', `/api/v1/atracciones/${a0.atr_id}`, { auth, cuerpo: campos });
    if (tarifas) await llamar('pricing', 'PUT', `/api/v1/tarifas/${a.atr_id}`, { auth, cuerpo: { tarifas } });
    if (horarios) await llamar('inventory', 'PUT', `/api/v1/horarios/${a.atr_id}`, { auth, cuerpo: { horarios } });
    this.c.invalidar();
    return this.c.completa(a);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ConSesion)
  async eliminar(@Param('id') id: string, @Req() req: Peticion) {
    const a = await this.c.una(id);
    await llamar('catalog', 'DELETE', `/api/v1/atracciones/${a.atr_id}`, { auth: req.header('authorization') });
    this.c.invalidar();
  }

  @Post(':id/review')
  @HttpCode(200)
  @UseGuards(ConSesion)
  async revisar(@Param('id') id: string, @Body() b: { decision: 'APPROVE' | 'REJECT' }, @Req() req: Peticion) {
    if (!esAdmin(req.usuario)) throw new ForbiddenException({ message: 'Solo un administrador aprueba experiencias.', code: 'FORBIDDEN' });
    const a0 = await this.c.una(id);
    const a = await llamar<Atraccion>('catalog', 'PATCH', `/api/v1/atracciones/${a0.atr_id}`, { auth: req.header('authorization'), cuerpo: { atr_estado: b.decision === 'APPROVE' ? 'PUBLICADA' : 'INACTIVA' } });
    this.c.invalidar();
    return this.c.completa(a);
  }

  // ── Panel: fechas bloqueadas ──

  @Get(':id/blocked-dates')
  async bloqueadas(@Param('id') id: string) {
    const a = await this.c.una(id);
    const b = await llamar<Bloqueo[]>('inventory', 'GET', `/api/v1/fechas-bloqueadas?atr_id=${a.atr_id}`);
    return b.map((x) => ({ id: x.fb_id, date: x.fb_fecha, reason: x.fb_motivo }));
  }

  @Post(':id/blocked-dates')
  @UseGuards(ConSesion)
  async bloquear(@Param('id') id: string, @Body() b: { date: string; reason: string }, @Req() req: Peticion) {
    const a = await this.c.una(id);
    const x = await llamar<Bloqueo>('inventory', 'POST', '/api/v1/fechas-bloqueadas', { auth: req.header('authorization'), cuerpo: { atr_id: a.atr_id, fb_fecha: b.date, fb_motivo: b.reason } });
    return { id: x.fb_id, date: x.fb_fecha, reason: x.fb_motivo };
  }

  @Delete(':id/blocked-dates/:bid')
  @HttpCode(204)
  @UseGuards(ConSesion)
  async desbloquear(@Param('bid') bid: string, @Req() req: Peticion) {
    await llamar('inventory', 'DELETE', `/api/v1/fechas-bloqueadas/${encodeURIComponent(bid)}`, { auth: req.header('authorization') });
  }

  // ── Reseñas ──

  @Get(':id/reviews')
  async resenas(@Param('id') id: string, @Query() q: Record<string, string>) {
    const a = await this.c.una(id);
    const page = Math.max(Number(q.page) || 1, 1);
    const limit = Math.min(Number(q.limit) || 5, 50);
    const todas = await llamar<{ data: { ren_id: number; ren_puntuacion: number; ren_comentario: string; ren_autor_nombre: string | null; ren_creado_en: string }[] }>(
      'review', 'GET', `/api/v1/resenas?atr_id=${a.atr_id}&limit=100`,
    );
    const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    todas.data.forEach((r) => distribution[r.ren_puntuacion]++);
    const filtradas = q.rating ? todas.data.filter((r) => r.ren_puntuacion === Number(q.rating)) : todas.data;
    return {
      data: filtradas.slice((page - 1) * limit, page * limit).map((r) => ({ id: String(r.ren_id), author: r.ren_autor_nombre ?? 'Viajero', rating: r.ren_puntuacion, comment: r.ren_comentario, created_at: r.ren_creado_en })),
      meta: { totalItems: filtradas.length, totalPages: Math.max(Math.ceil(filtradas.length / limit), 1), page, limit },
      distribution,
    };
  }

  /** Solo quien vivió la experiencia: una reserva propia, no cancelada y con fecha ya pasada. */
  private async puedeReseñar(id: string, req: Peticion) {
    const a = await this.c.una(id);
    const filas = await llamar<FilaReserva[]>('booking', 'GET', `/api/v1/web/reservas?atr_uuid=${a.atr_uuid}`, { auth: req.header('authorization') });
    const hoy = hoyEc();
    return { a, vivida: filas.some((r) => r.estado !== 'CANCELADA' && r.fecha <= hoy && (r.fecha < hoy || r.hora < horaEc())) };
  }

  @Get(':id/reviews/eligibility')
  @UseGuards(ConSesion)
  async elegible(@Param('id') id: string, @Req() req: Peticion) {
    const { vivida } = await this.puedeReseñar(id, req);
    return vivida ? { can_review: true } : { can_review: false, reason: 'Podrás opinar después de vivir esta experiencia con una reserva confirmada.' };
  }

  @Post(':id/reviews')
  @UseGuards(ConSesion)
  async reseñar(@Param('id') id: string, @Body() b: Record<string, number | string>, @Req() req: Peticion) {
    const { a, vivida } = await this.puedeReseñar(id, req);
    if (!vivida) throw new ForbiddenException({ message: 'Podrás opinar después de vivir esta experiencia con una reserva confirmada.', code: 'FORBIDDEN' });
    const r = await llamar<{ ren_id: number; ren_puntuacion: number; ren_comentario: string; ren_creado_en: string }>('review', 'POST', '/api/v1/resenas', {
      auth: req.header('authorization'),
      cuerpo: { atr_id: a.atr_id, ren_puntuacion: b.rating, ren_comentario: b.comment, ren_limpieza: b.cleanliness, ren_servicio: b.service, ren_relacion_valor: b.value, ren_puntualidad: b.punctuality },
    });
    this.c.invalidar();
    return { id: String(r.ren_id), author: req.usuario!.nombre ?? 'Viajero', rating: r.ren_puntuacion, comment: r.ren_comentario, created_at: r.ren_creado_en };
  }
}

/** Turistas de Booking para el panel (los datos son de ms_identity). */
@Controller({ path: 'turistas', version: '1' })
export class TuristasWebController {
  /** La cuenta web del usuario en ms_identity, para que Booking la reconozca por cédula o correo. */
  @Put('mi-cuenta')
  @UseGuards(ConSesion)
  async miCuenta(@Body() b: Record<string, unknown>, @Req() req: Peticion) {
    const u = (process.env.IDENTITY_URL ?? 'http://localhost:4012').replace(/\/$/, '');
    const r = await fetch(`${u}/api/v1/clientes/mi-cuenta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: req.header('authorization') ?? '' },
      body: JSON.stringify({ nombres: b.nombres, apellidos: b.apellidos, documento: b.documento || undefined, telefono: b.telefono || undefined }),
      signal: AbortSignal.timeout(7000),
    });
    const d = (await r.json().catch(() => null)) as { detail?: string } | null;
    if (!r.ok) throw new HttpException({ message: d?.detail ?? 'No se pudo sincronizar la cuenta.' }, r.status);
    return d;
  }

  @Get()
  @UseGuards(ConSesion)
  listar(@Query() q: Record<string, string>, @Req() req: Peticion) {
    const consulta = new URLSearchParams(Object.entries(q).filter(([k]) => ['q', 'page', 'limit'].includes(k))).toString();
    const u = process.env.IDENTITY_URL ?? 'http://localhost:4012';
    return fetch(`${u.replace(/\/$/, '')}/api/v1/clientes${consulta ? `?${consulta}` : ''}`, { headers: { Authorization: req.header('authorization') ?? '' }, signal: AbortSignal.timeout(7000) }).then(async (r) => {
      const d = (await r.json().catch(() => null)) as { detail?: string } | null;
      if (!r.ok) throw new HttpException({ message: d?.detail ?? 'No se pudo cargar la lista.' }, r.status);
      return d;
    });
  }
}

@Controller({ version: '1' })
export class SaludWebController {
  @Get('health')
  salud() {
    return { status: 'UP', service: 'bff-web' };
  }
}
