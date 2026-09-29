import { useEffect, useState } from 'react';
import { MessageSquarePlus, Star } from 'lucide-react';
import { Atracciones } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtRelative, initials } from '../utils/format';
import { EmptyState, Field, Modal, Spinner, Stars } from './ui';

export function ReviewModal({ open, onClose, attraction, onDone }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Muy buena', 'Excelente'];

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!rating) errs.rating = 'Selecciona de 1 a 5 estrellas.';
    if (comment.trim().length < 10) errs.comment = 'Cuéntanos un poco más (mínimo 10 caracteres).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      await Atracciones.createReview(attraction.id, rating, comment.trim());
      toast('¡Gracias! Tu reseña ya está publicada.', 'success');
      onDone?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escribe tu reseña"
      description={attraction?.name}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" form="review-form" type="submit" disabled={sending}>
            {sending ? <Spinner /> : null} Publicar reseña
          </button>
        </>
      }
    >
      <form id="review-form" onSubmit={submit} className="stack" noValidate>
        <div className="field">
          <span className="label" id="rv-stars">Tu calificación</span>
          <div className="row">
            {/* radiogroup con tabindex rotatorio y flechas (ACC-009) */}
            <div
              className="star-picker"
              role="radiogroup"
              aria-labelledby="rv-stars"
              aria-required="true"
              aria-invalid={errors.rating ? true : undefined}
              aria-describedby={errors.rating ? 'rv-stars-err' : undefined}
              onMouseLeave={() => setHover(0)}
              onKeyDown={(e) => {
                const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
                const target = e.key === 'Home' ? 1 : e.key === 'End' ? 5 : delta ? Math.min(5, Math.max(1, (rating || 0) + delta)) : 0;
                if (!target) return;
                e.preventDefault();
                setRating(target);
                e.currentTarget.querySelectorAll('[role="radio"]')[target - 1]?.focus();
              }}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={rating === i}
                  tabIndex={rating === i || (!rating && i === 1) ? 0 : -1}
                  aria-label={`${i} estrella${i > 1 ? 's' : ''}: ${LABELS[i]}`}
                  className={(hover || rating) >= i ? 'on' : ''}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setRating(i)}
                >
                  <Star size={30} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </button>
              ))}
            </div>
            <strong aria-hidden="true">{LABELS[hover || rating]}</strong>
          </div>
          {errors.rating && <span id="rv-stars-err" className="error-text" role="alert">{errors.rating}</span>}
        </div>
        <Field label="Tu experiencia" required error={errors.comment} hint={`${comment.length}/1000 caracteres`}>
          {(p) => (
            <textarea {...p} className="textarea" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="¿Qué fue lo que más te gustó? ¿Qué recomendarías a otros viajeros?" />
          )}
        </Field>
      </form>
    </Modal>
  );
}

export default function Reviews({ attraction, onChanged }) {
  const { isAuth } = useAuth();
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [elig, setElig] = useState(null);
  const [open, setOpen] = useState(false);

  const load = (p = 1, rating = filter) => {
    setLoading(true);
    Atracciones.reviews(attraction.id, { page: p, limit: 5, ...(rating ? { rating } : {}) })
      .then((r) => {
        setData(r);
        setItems((prev) => (p === 1 ? r.data : [...prev, ...r.data]));
        setPage(p);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(1, filter); }, [attraction.id, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isAuth) Atracciones.reviewEligibility(attraction.id).then(setElig).catch(() => setElig(null));
  }, [attraction.id, isAuth]);

  const total = attraction.ratings?.number_of_reviews ?? 0;
  const dist = data?.distribution ?? {};
  const max = Math.max(1, ...Object.values(dist));

  return (
    <section className="detail-section" id="resenas" aria-labelledby="rev-title">
      <div className="row-between" style={{ marginBottom: 16 }}>
        <h2 id="rev-title" style={{ margin: 0 }}>Opiniones de viajeros</h2>
        {elig?.can_review && (
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
            <MessageSquarePlus size={16} /> Escribir reseña
          </button>
        )}
      </div>
      {elig && !elig.can_review && <p className="muted small">{elig.reason}</p>}

      {total === 0 ? (
        <EmptyState icon={Star} title="Aún no hay reseñas">Sé de los primeros en vivir esta experiencia y contar cómo te fue.</EmptyState>
      ) : (
        <>
          <div className="review-summary">
            <div className="review-score">
              <div className="big">{Number(attraction.ratings.score).toFixed(1)}</div>
              <Stars value={attraction.ratings.score} size={18} />
              <div className="muted small">{total} reseña{total > 1 ? 's' : ''}</div>
            </div>
            <div role="group" aria-label="Filtrar reseñas por estrellas">
              {[5, 4, 3, 2, 1].map((s) => (
                <button key={s} type="button" className="dist-row" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)} disabled={!dist[s]}>
                  <span>{s} estrellas</span>
                  <span className="dist-bar"><span style={{ width: `${((dist[s] ?? 0) / max) * 100}%` }} /></span>
                  <span className="muted">{dist[s] ?? 0}</span>
                </button>
              ))}
              {filter && <button className="btn btn-ghost btn-sm" onClick={() => setFilter(null)}>Ver todas las reseñas</button>}
            </div>
          </div>
          {items.map((r) => (
            <article key={r.id} className="review">
              <div className="review-head">
                <span className="avatar" aria-hidden="true">{initials(r.author)}</span>
                <div>
                  <strong>{r.author}</strong>
                  <div className="row" style={{ gap: 8 }}>
                    <Stars value={r.rating} size={14} />
                    <span className="muted tiny">{fmtRelative(r.created_at)}</span>
                  </div>
                </div>
              </div>
              <p>{r.comment}</p>
            </article>
          ))}
          {data && page < data.meta.totalPages && (
            <button className="btn" onClick={() => load(page + 1)} disabled={loading}>
              {loading ? <Spinner /> : null} Ver más reseñas ({data.meta.totalItems - items.length})
            </button>
          )}
        </>
      )}
      <ReviewModal
        open={open}
        onClose={() => setOpen(false)}
        attraction={attraction}
        onDone={() => { setElig({ can_review: false, reason: 'Ya dejaste una reseña para esta experiencia.' }); load(1, null); onChanged?.(); }}
      />
    </section>
  );
}
