import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ahoraServidor, sincronizarReloj } from '../src/api/reloj.js';

const respuesta = (fecha) => ({ headers: { get: (k) => (k === 'Date' ? fecha : null) } });

describe('reloj del servidor (pruebas DPoP con el reloj del equipo desfasado)', () => {
  it('adopta la hora del servidor si el equipo va adelantado o atrasado', () => {
    sincronizarReloj(respuesta(new Date(Date.now() + 10 * 60_000).toUTCString())); // servidor 10 min por delante
    assert.ok(Math.abs(ahoraServidor() - (Date.now() + 10 * 60_000)) < 2000);
    sincronizarReloj(respuesta(new Date(Date.now() - 3 * 3_600_000).toUTCString())); // servidor 3 h por detrás
    assert.ok(Math.abs(ahoraServidor() - (Date.now() - 3 * 3_600_000)) < 2000);
  });

  it('ignora diferencias pequeñas (latencia) y cabeceras ausentes o inválidas', () => {
    sincronizarReloj(respuesta(new Date(Date.now() + 5_000).toUTCString()));
    assert.ok(Math.abs(ahoraServidor() - Date.now()) < 50);
    sincronizarReloj(respuesta(null));
    sincronizarReloj(respuesta('no es una fecha'));
    assert.ok(Math.abs(ahoraServidor() - Date.now()) < 50);
  });
});
