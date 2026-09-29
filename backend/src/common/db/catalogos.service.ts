import { Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { DbService } from './db.service';

type Mapa = Map<string, number>;

/**
 * Catálogos fijos del modelo (estado, metodo_pago, rol): se leen una vez y se
 * cachean, para resolver códigos legibles ('CONFIRMADA', 'TARJETA') a sus PK.
 *
 * IMPORTANTE: con DB_POOL_MAX=1 (serverless) no se puede cargar el catálogo desde
 * DENTRO de una transacción: pediría una segunda conexión y se bloquearía. Por eso
 * se precarga al iniciar y los flujos transaccionales llaman a `precargar()` antes.
 */
@Injectable()
export class CatalogosService implements OnModuleInit {
  private cache: Promise<{ estados: Mapa; metodos: Mapa; metodosPorId: Map<number, string>; roles: Mapa }> | null = null;

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    this.cargar().catch(() => undefined); // si falla, se reintenta en el primer uso
  }

  /** Garantiza el catálogo en memoria. Llamar ANTES de abrir una transacción. */
  async precargar(): Promise<void> {
    await this.cargar();
  }

  private cargar() {
    this.cache ??= (async () => {
      const [estados, metodos, roles] = await Promise.all([
        this.db.query<{ est_id: number; est_codigo: string }>('SELECT est_id, est_codigo FROM estado'),
        this.db.query<{ mpa_id: number; mpa_codigo: string }>('SELECT mpa_id, mpa_codigo FROM metodo_pago'),
        this.db.query<{ rol_id: number; rol_nombre: string }>('SELECT rol_id, rol_nombre FROM rol'),
      ]);
      return {
        estados: new Map(estados.map((e) => [e.est_codigo, e.est_id])),
        metodos: new Map(metodos.map((m) => [m.mpa_codigo, m.mpa_id])),
        metodosPorId: new Map(metodos.map((m) => [m.mpa_id, m.mpa_codigo])),
        roles: new Map(roles.map((r) => [r.rol_nombre, r.rol_id])),
      };
    })().catch((e) => {
      this.cache = null;
      throw e;
    });
    return this.cache;
  }

  private req(mapa: Mapa, codigo: string, que: string): number {
    const id = mapa.get(codigo);
    if (id === undefined) throw new InternalServerErrorException(`Falta el ${que} "${codigo}" en el catálogo de la base.`);
    return id;
  }

  async estado(codigo: string) {
    return this.req((await this.cargar()).estados, codigo, 'estado');
  }
  async metodoPago(codigo: string) {
    return this.req((await this.cargar()).metodos, codigo, 'método de pago');
  }
  async rol(nombre: string) {
    return this.req((await this.cargar()).roles, nombre, 'rol');
  }
}
