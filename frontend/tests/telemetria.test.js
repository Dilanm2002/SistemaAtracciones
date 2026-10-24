import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navegador, rutaPlantilla } from '../src/api/telemetria.js';

test('rutaPlantilla: sin ids, códigos de reserva, números ni query string', () => {
  assert.equal(rutaPlantilla('/atraccion/0b1c2d3e-1111-4222-8333-444455556666'), '/atraccion/:id');
  assert.equal(rutaPlantilla('/reserva/0b1c2d3e-1111-4222-8333-444455556666/confirmada?x=ana@correo.ec'), '/reserva/:id/confirmada');
  assert.equal(rutaPlantilla('/admin/reservas/DEC-7F3K9Q'), '/admin/reservas/:id');
  assert.equal(rutaPlantilla('/destinos/1701#mapa'), '/destinos/:id');
  assert.equal(rutaPlantilla('/'), '/');
});

test('navegador: nombre, versión mayor y sistema; nunca el user agent completo', () => {
  assert.equal(navegador('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'), 'Chrome 141 · Android');
  assert.equal(navegador('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari 18 · iOS');
  assert.equal(navegador('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'), 'Edge 141 · Windows');
  assert.equal(navegador(''), 'Otro · Otro');
});
