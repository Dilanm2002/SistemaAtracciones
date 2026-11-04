import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DbService } from './comun/db.service';

const MAX_INTENTOS = 120; // una hora, a un intento cada 30 s
const ESPERA_MS = 30_000;
const TIMEOUT_MS = 8_000;

interface FilaAviso {
  [k: string]: unknown;
  codigo: string;
  client_id: string | null;
  tickets: number;
  asistentes: number | null;
  admin: string | null;
  observaciones: string | null;
  checkin_en: Date;
  intentos: number;
}

/**
 * Aviso de check-in a Booking (contrato v3.1). La llegada del turista ya quedó guardada cuando se envía,
 * así que una caída de Booking nunca afecta al guía: lo pendiente se reintenta solo cada 30 s.
 */
@Injectable()
export class AvisoCheckin implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AvisoCheckin');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DbService) {}

  get habilitado(): boolean {
    const v = process.env.BOOKING_AVISOS_ENABLED;
    return v ? v === 'true' : process.env.NODE_ENV !== 'test';
  }

  private get base(): string {
    return (process.env.BOOKING_API_URL ?? 'https://booking-core-api.azurewebsites.net').replace(/\/$/, '');
  }

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.reintentar(), ESPERA_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Envía sin esperar: la respuesta al guía no depende de Booking. */
  programar(resId: string): void {
    if (!this.habilitado) return;
    setImmediate(() => void this.enviar(resId).catch((e: Error) => this.logger.warn(`Aviso de ${resId} pendiente: ${e.message}`)));
  }

  async reintentar(): Promise<void> {
    if (!this.habilitado) return;
    const filas = await this.db.query<{ res_id: string }>(
      `SELECT res_id::text FROM reserva
        WHERE res_aviso_checkin = 'PENDIENTE' AND (res_aviso_intento_en IS NULL OR res_aviso_intento_en < now() - interval '25 seconds')
        ORDER BY res_id LIMIT 20`,
    );
    for (const f of filas) await this.enviar(f.res_id).catch((e: Error) => this.logger.warn(`Aviso de ${f.res_id} pendiente: ${e.message}`));
  }

  async enviar(resId: string): Promise<boolean> {
    const f = await this.db.one<FilaAviso>(
      `SELECT res_codigo AS codigo, res_client_id AS client_id, res_numero_tickets AS tickets, res_checkin_asistentes AS asistentes,
              res_checkin_admin AS admin, res_checkin_observaciones AS observaciones, res_checkin_en AS checkin_en, res_aviso_intentos AS intentos
         FROM reserva WHERE res_id = $1 AND res_aviso_checkin = 'PENDIENTE'`,
      [resId],
    );
    if (!f) return false;
    await this.db.query('UPDATE reserva SET res_aviso_intento_en = now() WHERE res_id = $1', [resId]);
    const { ok, detalle } = await this.publicar(f);
    const intentos = f.intentos + 1;
    const estado = ok ? 'ENVIADO' : intentos >= MAX_INTENTOS ? 'FALLIDO' : 'PENDIENTE';
    await this.db.query('UPDATE reserva SET res_aviso_checkin = $2, res_aviso_intentos = $3, res_aviso_respuesta = $4 WHERE res_id = $1', [resId, estado, intentos, detalle.slice(0, 300)]);
    if (!ok) this.logger.warn(`Aviso de check-in de ${f.codigo} sin confirmar (intento ${intentos}): ${detalle}`);
    return ok;
  }

  private async publicar(f: FilaAviso): Promise<{ ok: boolean; detalle: string }> {
    try {
      const r = await fetch(`${this.base}/api/v3/reservas/${encodeURIComponent(f.codigo)}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.BOOKING_API_KEY ?? '' },
        body: JSON.stringify({
          external_order_id: f.codigo,
          client_id: f.client_id,
          estado: 'CONFIRMADO_ASISTIDO',
          asistentes_reales: f.asistentes ?? f.tickets,
          admin_id: f.admin ?? 'guia-turistico',
          fecha_checkin: new Date(f.checkin_en).toISOString(),
          observaciones: f.observaciones ?? 'Turista validado en el punto de encuentro',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: r.ok, detalle: `HTTP ${r.status}: ${await r.text().catch(() => '')}` };
    } catch (e) {
      return { ok: false, detalle: (e as Error).message };
    }
  }
}
