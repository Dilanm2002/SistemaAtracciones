import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { basename, join } from 'path';
import { Client } from 'pg';

/**
 * Base de pruebas: TEST_DATABASE_URL (la de `docker compose up -d`). Cada suite parte de una base vacía:
 * se borra el esquema y el servicio vuelve a aplicar sus migraciones al arrancar.
 */
export const URL_PRUEBAS = process.env.TEST_DATABASE_URL;
export const describeDb = URL_PRUEBAS ? describe : describe.skip;
/** Con DB_SCHEMA las pruebas usan ese schema (como en Supabase) y solo borran ese. */
const SCHEMA = process.env.DB_SCHEMA || 'public';
const conexion = () => new Client({ connectionString: URL_PRUEBAS, options: `-c search_path=${SCHEMA}` });

export async function baseVacia(): Promise<void> {
  process.env.DATABASE_URL = URL_PRUEBAS;
  process.env.NODE_ENV = 'test';
  const c = conexion();
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await c.end();
}

/** Ejecuta SQL de preparación de datos directamente en la base de pruebas. */
export async function sql(texto: string, params: unknown[] = []) {
  const c = conexion();
  await c.connect();
  try {
    return (await c.query(texto, params)).rows;
  } finally {
    await c.end();
  }
}

/**
 * Prueba de esquemas contra un contrato OpenAPI 3.0 (la que pidió el equipo antes de integrar):
 * la respuesta de una operación debe cumplir el esquema que declara el contrato para ese código.
 */
export class Contrato {
  private readonly ajv = new Ajv({ strict: false, allErrors: true });
  private readonly doc: { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>> };
  private readonly cache = new Map<string, ValidateFunction>();

  /**
   * @param otros documentos a los que el contrato hace $ref externo, con el nombre de archivo como id
   *              (p. ej. ms_catalog referencia los esquemas oficiales de Booking).
   */
  constructor(archivo: string, private readonly id = 'contrato', otros: string[] = []) {
    addFormats(this.ajv);
    // json: true tolera claves repetidas (el contrato v3 de Booking las tiene en TimeSlotItem)
    const leer = (f: string) => load(readFileSync(f, 'utf8'), { json: true }) as object;
    for (const f of otros) this.ajv.addSchema(leer(f), basename(f));
    this.doc = leer(archivo) as never;
    this.ajv.addSchema(this.doc as object, this.id);
  }

  /** Valida contra un esquema de components/schemas. */
  esquema(nombre: string, datos: unknown): string[] {
    return this.validar(`${this.id}#/components/schemas/${nombre}`, datos);
  }

  /** Valida la respuesta de `METODO /ruta` (ruta del contrato, con {param}) para un status. */
  respuesta(metodo: string, ruta: string, status: number, datos: unknown): string[] {
    const op = this.doc.paths[ruta]?.[metodo.toLowerCase()];
    if (!op) return [`El contrato no declara ${metodo} ${ruta}`];
    const r = op.responses[String(status)];
    if (!r) return [`El contrato no declara la respuesta ${status} de ${metodo} ${ruta}`];
    const tipo = Object.keys(r.content ?? {})[0];
    if (!tipo) return [];
    const puntero = ['paths', ruta, metodo.toLowerCase(), 'responses', String(status), 'content', tipo, 'schema']
      .map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1'))
      .join('/');
    return this.validar(`${this.id}#/${puntero}`, datos);
  }

  private validar(ref: string, datos: unknown): string[] {
    let v = this.cache.get(ref);
    if (!v) {
      v = this.ajv.compile({ $ref: ref });
      this.cache.set(ref, v);
    }
    return v(datos) ? [] : (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`);
  }
}

export const contratoPropio = () => new Contrato(join(__dirname, '..', 'contract', 'openapi.yaml'));
