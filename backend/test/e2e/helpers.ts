import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

/**
 * Infraestructura de las pruebas E2E: levanta la API completa (createApp) contra
 * un PostgreSQL real. Al iniciar, la app aplica las migraciones y carga el seed.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/descubre_ec_test npm run test:e2e
 *
 * Sin TEST_DATABASE_URL (ni DATABASE_URL) las suites se omiten.
 */
export const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
export const describeDb = DB_URL ? describe : describe.skip;

export const API = '/api/v1';

export const USERS = {
  admin: { email: 'admin@descubre-ec.com', password: 'Admin123' },
  operador: { email: 'operador@descubre-ec.com', password: 'Operador123' }, // empresa 101
  cliente: { email: 'cliente@descubre-ec.com', password: 'Cliente123' },
  ana: { email: 'ana.torres@correo.com', password: 'Cliente123' },
} as const;

export async function createTestApp(): Promise<NestExpressApplication> {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET ??= randomBytes(32).toString('hex'); // clave aleatoria por ejecución
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_DOCS = 'false';
  process.env.SEED_ON_START = 'true';
  process.env.DB_POOL_MAX = '8';
  // Importado aquí para que ConfigModule lea las variables anteriores
  Logger.overrideLogger(process.env.E2E_LOGS === 'true' ? ['error', 'warn'] : false);
  const { createApp } = await import('../../src/app.factory');
  const app = await createApp();
  await app.listen(0); // un solo servidor para todas las peticiones de la suite
  return app;
}

export const db = (app: NestExpressApplication) => app.get(DataSource);

let ipSeq = 1;
/** IP distinta por petición: el límite de peticiones (por IP) no interfiere entre casos. */
export const freshIp = () => `10.0.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

export function http(app: NestExpressApplication) {
  const server = app.getHttpServer();
  const wrap = (t: request.Test) => t.set('X-Forwarded-For', freshIp());
  return {
    get: (url: string) => wrap(request(server).get(`${API}${url}`)),
    post: (url: string) => wrap(request(server).post(`${API}${url}`)),
    put: (url: string) => wrap(request(server).put(`${API}${url}`)),
    patch: (url: string) => wrap(request(server).patch(`${API}${url}`)),
    delete: (url: string) => wrap(request(server).delete(`${API}${url}`)),
    raw: () => request(server),
  };
}

export async function login(app: NestExpressApplication, who: { email: string; password: string }): Promise<string> {
  const res = await http(app).post('/auth/login').send(who);
  if (res.status !== 200 && res.status !== 201) throw new Error(`login ${who.email} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.access_token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const idem = (): Record<string, string> => ({ 'Idempotency-Key': randomUUID() });

/** Fecha AAAA-MM-DD en hora de Ecuador, `dias` días desde hoy. */
export function fechaEc(dias: number): string {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
/** Nombres de prueba sin dígitos largos (pasan las reglas de texto legible). */
export const nombreUnico = (base: string) => {
  const letras = 'abcdefghijklmnopqrstuvwxyz';
  let n = Date.now() * 100 + seq++;
  let sufijo = '';
  while (n > 0) {
    sufijo += letras[n % 26];
    n = Math.floor(n / 26);
  }
  return `${base} ${sufijo}`;
};

/** Cuerpo válido para POST /atracciones (operador 101, primera ciudad disponible). */
export function nuevaAtraccion(cityId: number, extra: Record<string, unknown> = {}) {
  return {
    name: nombreUnico('Tour de prueba QA'),
    long_description: 'Recorrido de prueba creado por la suite E2E para validar reservas y cupos.',
    short_description: 'Recorrido de prueba de la suite E2E',
    duration: 'PT2H',
    price: { currency: 'USD', total: 40 },
    child_price: 25,
    operator: { id: 101, name: 'Andes Explorer Ecuador' },
    product_type: 'GUIDED_TOUR',
    includes: ['Guía bilingüe'],
    categories: ['cultural'],
    locations: [{ address: 'Plaza Grande, Centro Histórico', city: cityId, country: 'ec', coordinates: { latitude: -0.22, longitude: -78.51 } }],
    photos: [{ url: '/img/quito-centro.jpg', alt: 'Plaza Grande' }],
    supported_languages: ['es'],
    free_cancellation: true,
    cancellation_hours: 24,
    times: ['10:00'],
    capacity_per_slot: 5,
    ...extra,
  };
}

/** Cuerpo válido de una reserva. */
export function reserva(fecha: string, extra: Record<string, unknown> = {}) {
  return { date: fecha, time: '10:00', ticket_count: 1, customer_name: 'María Guamán', ...extra };
}
