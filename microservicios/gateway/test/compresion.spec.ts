import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request = require('supertest');
import { crearGateway } from '../src/app';

describe('compresión de respuestas grandes', () => {
  let app: NestExpressApplication;
  let servidor: Server;
  const GRANDE = JSON.stringify({ data: Array.from({ length: 2000 }, (_, i) => ({ id: i, nombre: 'Parque Nacional Cotopaxi' })) });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    servidor = createServer((req, res) => {
      const cuerpo = req.url?.includes('grande') ? GRANDE : '{"ok":true}';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) });
      res.end(cuerpo);
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    process.env.CATALOG_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    app = await crearGateway();
  });
  afterAll(async () => {
    await app.close();
    await new Promise((ok) => servidor.close(ok));
    delete process.env.CATALOG_URL;
  });

  it('una respuesta grande viaja comprimida y llega completa', async () => {
    const r = await request(app.getHttpServer()).get('/ms/catalog/v1/grande').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(JSON.stringify(r.body)).toBe(GRANDE);
  });

  it('una respuesta pequeña no se comprime', async () => {
    const r = await request(app.getHttpServer()).get('/ms/catalog/v1/pequena').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.body).toEqual({ ok: true });
  });

  it('quien no acepta gzip la recibe sin comprimir', async () => {
    const r = await request(app.getHttpServer()).get('/ms/catalog/v1/grande').set('Accept-Encoding', 'identity');
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(JSON.stringify(r.body)).toBe(GRANDE);
  });
});
