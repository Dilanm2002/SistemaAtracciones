import { contextoActual, ejecutarEnContexto, nuevoContexto, registrarConsulta, traceparentDe } from './contexto';
import { _bufer, _reiniciarParaPruebas, huella, limpiar, percentil, registrarPeticion, rutaAgrupada } from './metricas-http';
import { calificar } from '../../modules/observabilidad/observabilidad.service';

describe('contexto de la petición (request_id + W3C Trace Context)', () => {
  it('continúa una traza válida y genera ids si no vienen o son inválidos', () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const c = nuevoContexto('req-12345678', tp);
    expect(c).toMatchObject({ requestId: 'req-12345678', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' });
    // la respuesta sigue la misma traza con un span nuevo
    expect(traceparentDe(c)).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);

    const n = nuevoContexto('<script>', '00-00000000000000000000000000000000-00f067aa0ba902b7-01');
    expect(n.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(n.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(n.traceId).not.toBe('0'.repeat(32));
  });

  it('las consultas suman tiempo a la petición en curso (y fuera de una petición no fallan)', () => {
    registrarConsulta(5);
    const c = nuevoContexto();
    ejecutarEnContexto(c, () => {
      registrarConsulta(12.5);
      registrarConsulta(7.5);
      expect(contextoActual()).toBe(c);
    });
    expect(c).toMatchObject({ dbMs: 20, dbConsultas: 2 });
    expect(contextoActual()).toBeUndefined();
  });
});

describe('métricas HTTP', () => {
  afterEach(() => _reiniciarParaPruebas());

  it('agrupa por plantilla de ruta, nunca por URL con ids', () => {
    expect(rutaAgrupada('/api/v1/atracciones/:id', '/api/v1/atracciones/0b1c…')).toBe('/atracciones/:id');
    expect(rutaAgrupada(undefined, '/img/atracciones/foto-1.jpg')).toBe('/img/*');
    expect(rutaAgrupada(undefined, '/api/v1/no-existe/123')).toBe('(sin ruta)');
  });

  it('acumula por minuto, método, ruta y estado con su histograma', () => {
    const t = new Date('2026-10-24T10:15:42Z');
    registrarPeticion('GET', '/atracciones', 200, 80, 30, t);
    registrarPeticion('GET', '/atracciones', 200, 300, 10, t);
    registrarPeticion('GET', '/atracciones', 200, 4000, 0, t);
    registrarPeticion('GET', '/atracciones', 500, 50, 0, t);
    const filas = [..._bufer().values()];
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ minuto: '2026-10-24T10:15:00.000Z', total: 3, maxMs: 4000, dbMs: 40, cubetas: [1, 0, 1, 0, 0] });
  });

  it('percentiles a partir del histograma', () => {
    // 90 rápidas (≤100 ms) y 10 lentas (entre 1000 y 2500 ms)
    expect(percentil(0.5, 100, [90, 0, 0, 0, 10], 2400)).toBeLessThanOrEqual(100);
    const p95 = percentil(0.95, 100, [90, 0, 0, 0, 10], 2400)!;
    expect(p95).toBeGreaterThan(1000);
    expect(p95).toBeLessThanOrEqual(2400);
    // por encima de 2500 ms el límite es el máximo observado
    expect(percentil(0.99, 10, [0, 0, 0, 0, 0], 7000)).toBeLessThanOrEqual(7000);
    expect(percentil(0.95, 0, [0, 0, 0, 0, 0], 0)).toBeNull();
  });
});

describe('incidentes sin datos personales', () => {
  it('limpiar quita correos, tokens, números largos y query strings', () => {
    const t = limpiar('Falló para ana.perez@correo.ec con cédula 1710034065 y token eyJhbGciOi.eyJzdWIiOjF9.c2ln en https://api.x/ruta?email=a@b.ec&x=1');
    expect(t).not.toMatch(/ana\.perez|1710034065|eyJ|email=/);
    expect(t).toContain('[correo]');
    expect(t).toContain('[número]');
    expect(t).toContain('[token]');
    expect(t).toContain('https://api.x/ruta');
  });

  it('la huella agrupa el mismo error aunque cambien los ids', () => {
    const a = huella('api', 'No existe la reserva 0b1c2d3e-1111-4222-8333-444455556666 (intento 3)', '/reservas');
    const b = huella('api', 'No existe la reserva 9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff (intento 7)', '/reservas');
    expect(a).toBe(b);
    expect(huella('api', 'Otro error', '/reservas')).not.toBe(a);
  });
});

describe('Web Vitals', () => {
  it('califica con los umbrales de Google', () => {
    expect(calificar('LCP', 2400)).toBe('good');
    expect(calificar('LCP', 3000)).toBe('needs-improvement');
    expect(calificar('LCP', 4500)).toBe('poor');
    expect(calificar('CLS', 0.05)).toBe('good');
    expect(calificar('INP', 600)).toBe('poor');
  });
});
