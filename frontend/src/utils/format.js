const money = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtMoney = (n, { compact = false } = {}) =>
  compact && Number.isInteger(Number(n)) ? money0.format(Number(n)) : money.format(Number(n ?? 0));

export const fmtNumber = (n) => new Intl.NumberFormat('es-EC').format(Number(n ?? 0));

/** "2026-10-10" → Date a mediodía local (evita saltos de día por zona horaria). */
export const parseDate = (s) => new Date(`${s.slice(0, 10)}T12:00:00`);

export const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  s ? parseDate(s).toLocaleDateString('es-EC', opts) : '';

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const fmtDateLong = (s) =>
  s ? cap(parseDate(s).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) : '';

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const fmtRelative = (iso) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
};

/** Fecha de hoy en Ecuador (AAAA-MM-DD). */
export const todayEc = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });

export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};

export const fmtDuration = (h) => {
  const hours = Number(h ?? 0);
  if (hours >= 24) {
    const d = Math.round(hours / 24);
    return `${d} ${d === 1 ? 'día' : 'días'}`;
  }
  // Redondeo a minutos totales antes de separar: 1.999 h → "2 h" (no "1 h 60 min")
  const total = Math.round(hours * 60);
  const whole = Math.floor(total / 60);
  const min = total % 60;
  return `${whole ? `${whole} h` : ''}${whole && min ? ' ' : ''}${min ? `${min} min` : ''}` || '—';
};

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

export const LANG = { es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', pt: 'Portugués', qu: 'Kichwa' };
export const fmtLangs = (arr = []) => arr.map((l) => LANG[l] ?? l.toUpperCase()).join(', ');

export const PRODUCT_TYPE = { GUIDED_TOUR: 'Tour guiado', SINGLE_TICKET: 'Entrada / ticket', PACKAGE: 'Paquete' };
export const REGION = { SIERRA: 'Sierra', COSTA: 'Costa', AMAZONIA: 'Amazonía', GALAPAGOS: 'Galápagos' };
export const PAYMENT = { TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', EN_SITIO: 'Pago en sitio' };
export const BADGE = { best_seller: 'Más vendido', likely_to_sell_out: 'Se agota pronto', new: 'Nuevo' };

export const STATUS = {
  CONFIRMED: { label: 'Confirmada', tone: 'success' },
  PENDING: { label: 'Pendiente de pago', tone: 'warning' },
  CANCELLED: { label: 'Cancelada', tone: 'danger' },
};

export const pluralize = (n, one, many) => `${fmtNumber(n)} ${n === 1 ? one : many}`;

/** "septiembre de 2026" → "Septiembre de 2026" (solo la primera letra en mayúscula). */
export const fmtMonth = (y, m) => {
  const t = new Date(y, m - 1, 1).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
