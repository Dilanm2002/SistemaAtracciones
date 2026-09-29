import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { addDays, fmtDate, fmtDuration, fmtLangs, fmtMoney, fmtMonth, fmtRelative, initials, parseDate, pluralize, todayEc } from '../src/utils/format.js';

// Intl usa espacios duros (U+00A0, U+202F): se normalizan para no depender de la versión de ICU
const n = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formato de dinero y números', () => {
  it('USD con 2 decimales; compacto solo para enteros', () => {
    assert.match(n(fmtMoney(40)), /40,00/);
    assert.match(n(fmtMoney(1234.5)), /1\.234,50/);
    assert.doesNotMatch(n(fmtMoney(40, { compact: true })), /,00/);
    assert.match(n(fmtMoney(40.5, { compact: true })), /40,50/);
  });
  it('valores nulos o vacíos se muestran como 0 (nunca "NaN")', () => {
    for (const v of [null, undefined]) assert.doesNotMatch(fmtMoney(v), /NaN/);
  });
  it('pluralize', () => {
    assert.equal(pluralize(1, 'reseña', 'reseñas'), '1 reseña');
    assert.equal(pluralize(3, 'reseña', 'reseñas'), '3 reseñas');
  });
});

describe('fechas', () => {
  it('parseDate usa mediodía local: la fecha no se corre un día por la zona horaria', () => {
    const d = parseDate('2026-10-10');
    assert.equal(d.getDate(), 10);
    assert.equal(d.getMonth(), 9);
    assert.equal(parseDate('2026-10-10T23:59:00Z').getDate(), 10); // ignora la hora
  });
  it('addDays cruza meses y años', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
  it('fmtDate vacío si no hay fecha; fmtMonth con mayúscula inicial', () => {
    assert.equal(fmtDate(''), '');
    assert.equal(fmtDate(null), '');
    assert.match(fmtMonth(2026, 9), /^Septiembre|^Setiembre/);
  });
  it('todayEc tiene formato AAAA-MM-DD', () => {
    assert.match(todayEc(), /^\d{4}-\d{2}-\d{2}$/);
  });
  it('fmtRelative: minutos, horas, días y meses', () => {
    const ahora = Date.parse('2026-09-29T12:00:00Z');
    mock.timers.enable({ apis: ['Date'], now: ahora });
    try {
      assert.match(fmtRelative('2026-09-29T11:50:00Z'), /10 minutos/);
      assert.match(fmtRelative('2026-09-29T09:00:00Z'), /3 horas/);
      assert.match(fmtRelative('2026-09-27T12:00:00Z'), /anteayer|2 días/);
      assert.match(fmtRelative('2026-01-15T12:00:00Z'), /enero/);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('duración, idiomas e iniciales', () => {
  it('fmtDuration', () => {
    assert.equal(fmtDuration(2), '2 h');
    assert.equal(fmtDuration(1.5), '1 h 30 min');
    assert.equal(fmtDuration(0.75), '45 min');
    assert.equal(fmtDuration(24), '1 día');
    assert.equal(fmtDuration(72), '3 días');
    assert.equal(fmtDuration(0), '—');
    assert.equal(fmtDuration(null), '—');
    assert.equal(fmtDuration(1.999), '2 h'); // nunca "1 h 60 min"
  });
  it('fmtLangs traduce códigos conocidos y respeta los demás', () => {
    assert.equal(fmtLangs(['es', 'en', 'qu']), 'Español, Inglés, Kichwa');
    assert.equal(fmtLangs(['it']), 'IT');
    assert.equal(fmtLangs(), '');
  });
  it('initials', () => {
    assert.equal(initials('maría  guamán lópez'), 'MG');
    assert.equal(initials(''), '?');
    assert.equal(initials(), '?');
  });
});
