import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** GET JSON con tiempo máximo (los servicios no se esperan más de 2 s entre sí). */
async function getJson<T>(url: string, headers: Record<string, string> = {}, ms = 2000): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return (await r.json()) as T;
}

export interface CiudadLocation {
  ciu_id: number;
  ciu_nombre: string;
  prov_nombre: string;
}

/**
 * Cliente de ms_location (REST). atraccion.ciu_id es un ID lógico: el nombre de la ciudad se pide a
 * Location y se guarda 5 minutos en memoria (es un catálogo que casi no cambia).
 */
@Injectable()
export class LocationClient {
  private readonly cache = new Map<number, { c: CiudadLocation; hasta: number }>();
  private readonly logger = new Logger('LocationClient');

  private get base() {
    return (process.env.LOCATION_URL ?? 'http://localhost:4001').replace(/\/$/, '');
  }

  /** Ciudades por id (las que faltan en caché, en una sola llamada). Si Location no responde, las desconocidas quedan sin nombre. */
  async ciudades(ids: number[]): Promise<Map<number, CiudadLocation>> {
    const ahora = Date.now();
    const faltan = [...new Set(ids)].filter((id) => (this.cache.get(id)?.hasta ?? 0) <= ahora);
    if (faltan.length) {
      try {
        const filas = await getJson<CiudadLocation[]>(`${this.base}/api/v1/ciudades?ids=${faltan.join(',')}`);
        for (const c of filas) this.cache.set(c.ciu_id, { c, hasta: ahora + 300_000 });
      } catch (e) {
        this.logger.warn(`ms_location no respondió: ${(e as Error).message}`);
      }
    }
    return new Map(ids.flatMap((id) => (this.cache.has(id) ? [[id, this.cache.get(id)!.c] as const] : [])));
  }

  /** ¿Existe la ciudad? (validación del ID lógico al crear o editar). 503 si Location no responde. */
  async existe(id: number): Promise<boolean> {
    let r: Response;
    try {
      r = await fetch(`${this.base}/api/v1/ciudades/${id}`, { signal: AbortSignal.timeout(2000) });
    } catch {
      throw new ServiceUnavailableException({ message: 'No se pudo validar la ciudad (ms_location no responde).', code: 'DEPENDENCY_UNAVAILABLE' });
    }
    if (r.status === 404) return false;
    if (!r.ok) throw new ServiceUnavailableException({ message: `ms_location respondió ${r.status} al validar la ciudad.`, code: 'DEPENDENCY_UNAVAILABLE' });
    const c = (await r.json()) as CiudadLocation;
    this.cache.set(c.ciu_id, { c, hasta: Date.now() + 300_000 });
    return true;
  }

  /** ids de las ciudades cuyo nombre contiene `texto` (sin tildes). 503 si Location no responde: no se puede filtrar. */
  async buscar(texto: string): Promise<number[]> {
    try {
      const filas = await getJson<CiudadLocation[]>(`${this.base}/api/v1/ciudades?q=${encodeURIComponent(texto)}`);
      for (const c of filas) this.cache.set(c.ciu_id, { c, hasta: Date.now() + 300_000 });
      return filas.map((c) => c.ciu_id);
    } catch (e) {
      this.logger.warn(`ms_location no respondió: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ message: 'No se pudo consultar las ciudades (ms_location no responde).', code: 'DEPENDENCY_UNAVAILABLE' });
    }
  }
}

export interface Acuerdo {
  permite: boolean;
  maximo: number;
}

/**
 * Lo que todavía vive en la tienda (migración gradual): el acuerdo B2B de promociones y la
 * disponibilidad por turno (será de ms_inventory). Base: TIENDA_URL (p. ej. http://localhost:3000).
 */
@Injectable()
export class TiendaClient {
  private acuerdoCache: { a: Acuerdo; hasta: number } | null = null;
  private readonly logger = new Logger('TiendaClient');

  private get base() {
    return (process.env.TIENDA_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  /** Acuerdo de promociones vigente (60 s en caché). Sin respuesta: PROMO_PERMITE / PROMO_DESCUENTO_MAXIMO. */
  async acuerdo(): Promise<Acuerdo> {
    if (this.acuerdoCache && this.acuerdoCache.hasta > Date.now()) return this.acuerdoCache.a;
    let a: Acuerdo = { permite: process.env.PROMO_PERMITE !== 'false', maximo: Number(process.env.PROMO_DESCUENTO_MAXIMO ?? 15) };
    const clave = process.env.BOOKING_API_KEY;
    if (clave) {
      try {
        const r = await getJson<{ permite_promociones: boolean; porcentaje_descuento_maximo: number }>(
          `${this.base}/api/v2/atracciones/promociones/contrato`,
          { 'x-api-key': clave },
        );
        a = { permite: r.permite_promociones, maximo: r.porcentaje_descuento_maximo };
      } catch (e) {
        this.logger.warn(`Acuerdo de promociones no disponible: ${(e as Error).message}`);
      }
    }
    this.acuerdoCache = { a, hasta: Date.now() + 60_000 };
    return a;
  }

  /** ¿Hay algún turno con al menos `cupos` libres ese día? (falso si la tienda no responde o la fecha no opera) */
  async hayCupos(uuid: string, fecha: string, cupos: number): Promise<boolean> {
    try {
      const r = await getJson<{ time_slots: { cupos_disponibles: number }[] }>(`${this.base}/api/v2/atracciones/${uuid}/disponibilidad?date=${fecha}`);
      return r.time_slots.some((t) => t.cupos_disponibles >= cupos);
    } catch {
      return false;
    }
  }
}
