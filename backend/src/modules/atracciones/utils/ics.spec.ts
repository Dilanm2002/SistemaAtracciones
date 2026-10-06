import { escaparIcs, icsReserva, plegarIcs } from './ics';

describe('Evento de calendario de una reserva (MOV-014)', () => {
  const evento = {
    id: '6f1c2d3e-0000-4000-8000-000000000001', codigo: 'DEC-ABC123', nombre: 'Cotopaxi, día completo; con guía',
    fecha: '2026-10-20', hora: '08:30', duracionHoras: 8, lugar: 'Plaza Grande, Quito', personas: 2,
  };

  it('usa la hora de Ecuador (UTC−5) y la duración de la experiencia', () => {
    const ics = icsReserva(evento, new Date('2026-10-05T12:00:00Z'));
    expect(ics).toContain('DTSTART:20261020T133000Z'); // 08:30 en Quito
    expect(ics).toContain('DTEND:20261020T213000Z'); // + 8 h
    expect(ics).toContain('UID:6f1c2d3e-0000-4000-8000-000000000001@descubre-ec');
  });

  it('escapa los caracteres especiales del texto (RFC 5545)', () => {
    expect(escaparIcs('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
    expect(icsReserva(evento)).toContain('SUMMARY:Cotopaxi\\, día completo\\; con guía (DEC-ABC123)');
  });

  it('líneas con CRLF y plegadas a 75 octetos como máximo', () => {
    const ics = icsReserva({ ...evento, lugar: 'Á'.repeat(120) });
    expect(ics.endsWith('\r\n')).toBe(true);
    for (const l of ics.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(plegarIcs('x'.repeat(80)).split('\r\n')[1]).toBe(' xxxxx');
  });
});
