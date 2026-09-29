import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Ejecuta SQL parametrizado (nunca se concatenan valores del usuario en el texto). */
export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

class ManagerSql implements Sql {
  constructor(private readonly m: EntityManager) {}
  query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.m.query(sql, params);
  }
  async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.m.query(sql, params)) as T[])[0] ?? null;
  }
}

/**
 * Acceso a datos sobre el modelo relacional de database/01_esquema.sql.
 * El esquema es SQL-first (tablas con prefijo, PK compuestas, FK compuestas),
 * así que las consultas se escriben en SQL explícito con parámetros $n.
 */
@Injectable()
export class DbService implements Sql {
  private readonly base: ManagerSql;

  constructor(readonly ds: DataSource) {
    this.base = new ManagerSql(ds.manager);
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.base.query<T>(sql, params);
  }

  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.base.one<T>(sql, params);
  }

  /** Transacción: todo lo que haga `fn` con `tx` se confirma o se revierte junto. */
  tx<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.ds.transaction((m) => fn(new ManagerSql(m)));
  }
}

/** Acumula parámetros posicionales para construir un WHERE dinámico sin concatenar valores. */
export class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** Fecha actual en Ecuador, calculada por la base (para comparar con columnas DATE). */
export const HOY_EC = `(now() AT TIME ZONE 'America/Guayaquil')::date`;

export const num = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;
