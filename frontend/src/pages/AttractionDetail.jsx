import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Building, CalendarX2, Check, ChevronLeft, ChevronRight, Clock, Heart, Languages, Lightbulb, MapPin, Share2, Ticket, X,
} from 'lucide-react';
import { Atracciones } from '../api/client';
import AttractionCard, { FALLBACK_IMG, onImgError } from '../components/AttractionCard';
import BookingWidget from '../components/BookingWidget';
import Reviews from '../components/Reviews';
import { Breadcrumbs, EmptyState, ErrorState, RatingInline, usePageTitle } from '../components/ui';
import { recentStore, useFavorites } from '../context/FavoritesContext';
import { useToast } from '../context/ToastContext';
import { BADGE, fmtDuration, fmtLangs, fmtMoney, PRODUCT_TYPE } from '../utils/format';

function Lightbox({ photos, index, onClose, onIndex }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [index, photos.length, onClose, onIndex]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Galería de fotos" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <img src={photos[index].url} alt={`Foto ${index + 1} de ${photos.length}`} loading="eager" decoding="async" /* foto abierta en el visor: visible de inmediato (WEB-006) */ />
      <button className="icon-btn lb-close" onClick={onClose} aria-label="Cerrar galería" autoFocus><X size={24} /></button>
      {photos.length > 1 && (
        <>
          <button className="icon-btn lb-prev" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Foto anterior"><ChevronLeft size={28} /></button>
          <button className="icon-btn lb-next" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Foto siguiente"><ChevronRight size={28} /></button>
        </>
      )}
      <span className="lb-count">{index + 1} / {photos.length}</span>
    </div>
  );
}

/**
 * Galería del detalle: una foto grande a la vez, con flechas FUERA de la foto para pasar a la
 * anterior/siguiente, contador y miniaturas. También con teclado (← →) y deslizando en el celular.
 * Clic en la foto la abre a pantalla completa.
 */
function Carrusel({ photos, nombre, onAbrir }) {
  const [i, setI] = useState(0);
  const toque = useRef(null);
  const n = photos.length;
  const ir = (k) => setI(((k % n) + n) % n);
  // Precarga la siguiente para que el cambio sea inmediato
  useEffect(() => {
    if (n > 1) new Image().src = photos[(i + 1) % n].url;
  }, [i, n, photos]);

  return (
    <section
      className={`carrusel${n > 1 ? '' : ' unica'}`}
      aria-roledescription="carrusel"
      aria-label={`Fotos de ${nombre}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(i + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(i - 1); }
      }}
    >
      {n > 1 && (
        <button type="button" className="car-flecha" onClick={() => ir(i - 1)} aria-label="Foto anterior">
          <ChevronLeft size={26} aria-hidden="true" />
        </button>
      )}
      <div
        className="car-escenario"
        onTouchStart={(e) => { toque.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (toque.current == null) return;
          const dx = e.changedTouches[0].clientX - toque.current;
          if (Math.abs(dx) > 40) ir(dx < 0 ? i + 1 : i - 1);
          toque.current = null;
        }}
      >
        <button type="button" className="car-foto" onClick={() => onAbrir(i)} aria-label={`Ver la foto ${i + 1} de ${n} a pantalla completa`}>
          <img key={photos[i].url} src={photos[i].url} alt={i === 0 ? nombre : `${nombre}, foto ${i + 1}`} loading="eager" decoding="async" {...(i === 0 ? { fetchpriority: 'high' } : {})} onError={onImgError} />
        </button>
        {n > 1 && <span className="car-contador" aria-live="polite">{i + 1} / {n}</span>}
      </div>
      {n > 1 && (
        <button type="button" className="car-flecha" onClick={() => ir(i + 1)} aria-label="Foto siguiente">
          <ChevronRight size={26} aria-hidden="true" />
        </button>
      )}
      {n > 1 && (
        <div className="car-miniaturas" role="group" aria-label="Elegir foto">
          {photos.map((p, k) => (
            <button key={p.url} type="button" aria-current={k === i ? 'true' : undefined} aria-label={`Foto ${k + 1}`} onClick={() => setI(k)}>
              <img src={p.url} alt="" loading="lazy" decoding="async" onError={onImgError} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AttractionDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const fav = useFavorites();
  const toast = useToast();

  const load = () => {
    setError(null);
    Atracciones.get(id)
      .then((r) => {
        setA(r);
        recentStore.push(r.id);
        Atracciones.search({ rows: 5, filters: { categories: r.categories.slice(0, 1) }, sort: { by: 'rating' } })
          .then((s) => setSimilar(s.data.filter((x) => x.id !== r.id).slice(0, 4)))
          .catch(() => {});
      })
      .catch(setError);
  };
  useEffect(() => { setA(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  usePageTitle(a?.name);
  useEffect(() => {
    document.body.classList.add('has-book-bar');
    return () => document.body.classList.remove('has-book-bar');
  }, []);

  if (error) {
    return (
      <div className="container">
        {error.status === 404 ? (
          <EmptyState icon={CalendarX2} title="Esta experiencia ya no está disponible" action={<Link to="/explorar" className="btn btn-primary">Ver otras experiencias</Link>}>
            Puede que el operador la haya retirado. Te mostramos alternativas parecidas.
          </EmptyState>
        ) : (
          <ErrorState error={error} onRetry={load} />
        )}
      </div>
    );
  }
  if (!a) {
    return (
      <div className="container" aria-busy="true" style={{ paddingTop: 24 }}>
        <div className="skeleton" style={{ height: 18, width: 260 }} />
        <div className="skeleton" style={{ height: 38, width: '60%', margin: '18px 0' }} />
        <div className="skeleton" style={{ height: 440, borderRadius: 18 }} />
      </div>
    );
  }

  const photos = a.photos?.length ? a.photos : [{ url: FALLBACK_IMG }];
  const saved = fav.has(a.id);
  const loc = a.locations?.[0];

  const share = async () => {
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) await navigator.share({ title: a.name, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado al portapapeles', 'success'); }
    } catch { /* cancelado por el usuario */ }
  };

  return (
    <>
      <div className="container">
        <div className="detail-head">
          <Breadcrumbs
            items={[
              { label: 'Inicio', to: '/' },
              { label: 'Explorar', to: '/explorar' },
              { label: a.destination?.name, to: `/explorar?destino=${a.destination?.code}` },
              { label: a.name },
            ]}
          />
          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            {a.badges?.map((b) => <span key={b} className="badge badge-cta">{BADGE[b] ?? b}</span>)}
            <span className="badge">{PRODUCT_TYPE[a.product_type]}</span>
          </div>
          <h1>{a.name}</h1>
          <div className="row-between">
            <div className="detail-meta">
              <a href="#resenas"><RatingInline ratings={a.ratings} /></a>
              <span className="row" style={{ gap: 4 }}><MapPin size={16} aria-hidden="true" /> {a.destination?.name}, {a.destination?.province}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={share}><Share2 size={16} /> Compartir</button>
              <button className="btn btn-sm" aria-pressed={saved} onClick={() => fav.toggle(a.id, a.name)}>
                <Heart size={16} fill={saved ? 'var(--danger)' : 'none'} color={saved ? 'var(--danger)' : 'currentColor'} /> {saved ? 'Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>

        <Carrusel photos={photos} nombre={a.name} onAbrir={setLightbox} />

        <div className="detail-layout">
          <div>
            <div className="facts" style={{ marginTop: 0 }}>
              <div className="fact"><Clock size={22} aria-hidden="true" /><div><strong>{fmtDuration(a.duration_hours)}</strong><span>Duración</span></div></div>
              <div className="fact"><Languages size={22} aria-hidden="true" /><div><strong>{fmtLangs(a.supported_languages)}</strong><span>Idiomas del guía</span></div></div>
              <div className="fact"><Ticket size={22} aria-hidden="true" /><div><strong>{a.times?.join(' · ')}</strong><span>Horarios de salida</span></div></div>
              <div className="fact">
                {a.free_cancellation ? <Check size={22} aria-hidden="true" /> : <CalendarX2 size={22} aria-hidden="true" />}
                <div><strong>{a.free_cancellation ? 'Cancelación gratuita' : 'Sin reembolso'}</strong><span>{a.free_cancellation ? `Hasta ${a.cancellation_hours} h antes` : 'Revisa la política'}</span></div>
              </div>
            </div>

            <section className="detail-section prose" aria-labelledby="desc-title">
              <h2 id="desc-title">Lo que vivirás</h2>
              <p style={{ fontWeight: 600, color: 'var(--text)' }}>{a.short_description}</p>
              <p>{a.long_description}</p>
            </section>

            <section className="detail-section" aria-labelledby="inc-title">
              <h2 id="inc-title" className="sr-only">Qué incluye</h2>
              <div className="two-col">
                <div>
                  <h3>Incluye</h3>
                  <ul className="list-icons">
                    {a.includes.map((x) => <li key={x} className="yes"><Check size={18} aria-hidden="true" /> {x}</li>)}
                  </ul>
                </div>
                {a.not_includes?.length > 0 && (
                  <div>
                    <h3>No incluye</h3>
                    <ul className="list-icons">
                      {a.not_includes.map((x) => <li key={x} className="no"><X size={18} aria-hidden="true" /> {x}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            {a.recommendations?.length > 0 && (
              <section className="detail-section" aria-labelledby="rec-title">
                <h2 id="rec-title">Antes de ir</h2>
                <ul className="list-icons">
                  {a.recommendations.map((x) => <li key={x}><Lightbulb size={18} color="var(--cta-hover)" aria-hidden="true" /> {x}</li>)}
                </ul>
              </section>
            )}

            <section className="detail-section" aria-labelledby="map-title">
              <h2 id="map-title">Punto de encuentro</h2>
              <p className="row" style={{ gap: 8, alignItems: 'flex-start' }}><MapPin size={18} color="var(--primary)" style={{ marginTop: 3, flexShrink: 0 }} aria-hidden="true" /> <span><strong>{a.meeting_point ?? loc?.address}</strong><br /><span className="muted small">Actividad en: {loc?.address}</span></span></p>
              {loc && (
                <iframe
                  className="map-frame"
                  title={`Mapa de ${a.name}`}
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${loc.coordinates.longitude - 0.03}%2C${loc.coordinates.latitude - 0.02}%2C${loc.coordinates.longitude + 0.03}%2C${loc.coordinates.latitude + 0.02}&layer=mapnik&marker=${loc.coordinates.latitude}%2C${loc.coordinates.longitude}`}
                />
              )}
              {a.operator && (
                <p className="muted small row" style={{ marginTop: 12, gap: 6 }}><Building size={16} aria-hidden="true" /> Operado por <strong style={{ color: 'var(--text)' }}>{a.operator.name}</strong></p>
              )}
            </section>

            <Reviews attraction={a} onChanged={load} />
          </div>

          <BookingWidget a={a} initialDate={params.get('fecha')} initialPeople={params.get('personas')} />
        </div>

        {similar.length > 0 && (
          <section className="section" aria-labelledby="sim-title">
            <div className="section-head"><h2 id="sim-title">También te puede gustar</h2></div>
            <div className="grid-cards">{similar.map((s) => <AttractionCard key={s.id} a={s} />)}</div>
          </section>
        )}
      </div>

      <div className="mobile-book-bar">
        <div>
          <div className="price-from">Desde</div>
          <div className="price">{fmtMoney(a.price.total)} <small>/ adulto</small></div>
        </div>
        <a href="#reservar" className="btn btn-cta">Ver disponibilidad</a>
      </div>

      {lightbox !== null && <Lightbox photos={photos} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
