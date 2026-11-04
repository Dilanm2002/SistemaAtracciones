import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

/** Acceso a SQL que comparten el pool y una transacción. */
export interface Sql {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

const envolver = (c: Pool | PoolClient): Sql => ({
  query: async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => (await c.query<T>(sql, params)).rows,
  one: async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> => (await c.query<T>(sql, params)).rows[0] ?? null,
});

/**
 * Schema propio en una base compartida (nube: un proyecto de Supabase con un schema por servicio).
 * Vacío = la base es solo del servicio y todo va en `public` (Docker local).
 */
export function schemaPropio(): string | null {
  const s = process.env.DB_SCHEMA?.trim();
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`DB_SCHEMA inválido: ${s}`);
  return s;
}

/**
 * SQL directo sobre la base PROPIA del microservicio (DATABASE_URL, y DB_SCHEMA si la base es
 * compartida). Ningún servicio toca los datos de otro: lo que necesita de afuera lo pide por su API o
 * lo recibe por eventos.
 */
@Injectable()
export class DbService implements Sql, OnModuleDestroy {
  readonly pool = crearPool();
  private readonly sql = envolver(this.pool);

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
    return this.sql.query<T>(sql, params);
  }

  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
    return this.sql.one<T>(sql, params);
  }

  async tx<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(envolver(c));
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

function crearPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    // Conexiones abiertas aunque no haya tráfico: reabrir una con TLS hacia Supabase tarda ~0,5 s y el
    // primer ping del semáforo de Booking tras un rato quieto saldría DEGRADED. 0 = no cerrar por inactividad.
    idleTimeoutMillis: Number(process.env.DB_IDLE_MS ?? 0),
    keepAlive: true,
  });
  // Si la base o el pooler cortan una conexión inactiva, el pool la descarta y abre otra en el siguiente
  // uso; sin este manejador el error tumbaría el proceso.
  pool.on('error', (e) => console.warn(`[db] conexión inactiva cerrada: ${e.message}`));
  // Con schema propio, cada conexión busca primero en él: ahí se crean y se leen todas sus tablas, aunque
  // `public` (la tienda) tenga tablas con los mismos nombres. `extensions` y `public` quedan al final solo
  // para encontrar pgcrypto y pg_trgm, que Supabase instala en uno u otro. Requiere una conexión de
  // sesión (en Supabase, el "Session pooler", puerto 5432).
  const schema = schemaPropio();
  if (schema) pool.on('connect', (c) => void c.query(`SET search_path TO ${schema}, extensions, public`));
  return pool;
}

/** Parámetros posicionales ($1, $2…) para armar filtros dinámicos sin concatenar valores. */
export class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}
