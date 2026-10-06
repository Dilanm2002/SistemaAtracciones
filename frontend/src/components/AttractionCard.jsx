import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Heart, MapPin } from 'lucide-react';
import { useFavorites } from '../context/FavoritesContext';
import { BADGE, badgeCls, fmtDuration, fmtMoney, insigniasTarjeta } from '../utils/format';
import { RatingInline } from './ui';
import { fotoProps, SIZES } from '../utils/fotos';

export const FALLBACK_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect fill='%23ebe4d8' width='4' height='3'/%3E%3Cpath d='M0 3 1.5 1.3 2.4 2.2 3 1.7 4 3z' fill='%23d3c8b6'/%3E%3C/svg%3E";

/**
 * Si una foto falla: primero se reintenta con la original (sin srcset, por si falta una variante)
 * y, si también falla, se muestra el marcador gris.
 */
export const onImgError = (e) => {
  const img = e.currentTarget;
  if (img.hasAttribute('srcset')) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    return;
  }
  img.onerror = null;
  img.src = FALLBACK_IMG;
};

export default function AttractionCard({ a, query = '' }) {
  const fav = useFavorites();
  const saved = fav.has(a.id);
  const destination = a.destination?.name ?? '';

  return (
    <article className="a-card">
      <div className="a-card-img">
        <img {...fotoProps(a.photos?.[0]?.url ?? FALLBACK_IMG, SIZES.tarjeta)} alt="" loading="lazy" decoding="async" width="400" height="300" onError={onImgError} />
        <div className="a-card-badges">
          {insigniasTarjeta(a.badges).map((b) => (
            <span key={b} className={`badge ${badgeCls(b, b === 'likely_to_sell_out' ? 'badge-dark' : 'badge-cta')}`}>{BADGE[b] ?? b}</span>
          ))}
        </div>
      </div>
      <button
        className="fav-btn"
        aria-pressed={saved}
        aria-label={saved ? `Quitar ${a.name} de favoritos` : `Guardar ${a.name} en favoritos`}
        onClick={() => fav.toggle(a.id, a.name)}
      >
        <Heart size={20} />
      </button>
      <div className="a-card-body">
        <span className="a-card-loc"><MapPin size={13} aria-hidden="true" /> {destination}</span>
        <h3 className="a-card-title">
          <Link to={`/atraccion/${a.id}${query}`} className="a-card-link" aria-label={a.name} />
          {a.name}
        </h3>
        <div className="a-card-meta">
          <span><Clock size={14} aria-hidden="true" /> {fmtDuration(a.duration_hours)}</span>
          {a.free_cancellation && <span className="ok"><CheckCircle2 size={14} aria-hidden="true" /> Cancelación gratis</span>}
        </div>
        <div className="a-card-foot">
          <RatingInline ratings={a.ratings} />
          <div style={{ textAlign: 'right' }}>
            <div className="price-from">Desde</div>
            <div className="price">{fmtMoney(a.price.total, { compact: true })} <small>/ persona</small></div>
          </div>
        </div>
      </div>
    </article>
  );
}
