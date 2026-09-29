import { escapeLike } from './sql';

describe('escapeLike (API-009)', () => {
  it('escapa los comodines de LIKE', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('no modifica texto normal', () => {
    expect(escapeLike('Cotopaxi')).toBe('Cotopaxi');
  });
});
