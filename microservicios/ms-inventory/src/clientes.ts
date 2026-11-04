import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from './comun/db.service';
import { llamarGrpc } from './comun/grpc';
import { llamar } from './comun/http';

export interface AtraccionRef {
  atr_id: number;
  atr_uuid: string;
  publicada: boolean;
}

/**
 * ms_catalog (REST): resuelve el id, UUID o slug que manda Booking al atr_id lógico de este servicio.
 * Cada atracción resuelta se guarda en atraccion_ref (atr_id ↔ UUID): el stock que se envía a Booking
 * lleva el UUID y no hace falta volver a preguntar.
 */
@Injectable()
export class CatalogoClient {
  constructor(private readonly db: DbService) {}

  async resolver(ref: string): Promise<AtraccionRef> {
    let a: { atr_id: number; atr_uuid: string; atr_estado: string; atr_eliminado_en: string | null };
    try {
      a = await llamar('catalog', 'GET', `/api/v1/atracciones/${encodeURIComponent(ref)}`);
    } catch (e) {
      if ((e as { status?: number }).status === 404) throw new NotFoundException(`La atracción ${ref} no existe.`);
      throw e;
    }
    await this.db.query('INSERT INTO atraccion_ref (atr_id, atr_uuid) VALUES ($1, $2) ON CONFLICT (atr_id) DO UPDATE SET atr_uuid = EXCLUDED.atr_uuid', [a.atr_id, a.atr_uuid]);
    return { atr_id: a.atr_id, atr_uuid: a.atr_uuid, publicada: a.atr_estado === 'PUBLICADA' && !a.atr_eliminado_en };
  }

  /** UUID de un atr_id ya conocido (sin red); si no está, se pregunta a ms_catalog. */
  async uuid(atrId: number): Promise<string> {
    const f = await this.db.one<{ atr_uuid: string }>('SELECT atr_uuid::text FROM atraccion_ref WHERE atr_id = $1', [atrId]);
    return f?.atr_uuid ?? (await this.resolver(String(atrId))).atr_uuid;
  }
}

export interface Tarifas {
  atr_id: string;
  moneda: string;
  adulto: string;
  nino: string;
  mayor: string;
  estudiante: string;
}

/** ms_pricing (gRPC): tarifas vigentes para los precios de cada turno. */
@Injectable()
export class PricingClient {
  async tarifas(atrId: number): Promise<Tarifas> {
    const r = await llamarGrpc<{ tarifas: Tarifas[] }>('pricing.proto', 'descubre.pricing.v1.PricingService', 'PRICING_GRPC_URL', 'localhost:50044', 'ObtenerTarifas', { atr_ids: [atrId] });
    return r.tarifas[0];
  }
}
