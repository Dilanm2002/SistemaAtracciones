import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CalendarCheck, CreditCard, Headphones, History, ShieldCheck, Sparkles } from 'lucide-react';
import { Atracciones, Categorias, Destinos } from '../api/client';
import AttractionCard, { onImgError } from '../components/AttractionCard';
import SearchBar from '../components/SearchBar';
import { CardSkeleton, ErrorState, usePageTitle } from '../components/ui';
import { recentStore } from '../context/FavoritesContext';
import { CategoryIcon } from '../utils/icons';

const REGIONES = [
  { key: 'GALAPAGOS', name: 'Galápagos', text: 'Fauna única en el mundo', img: 'galapagos-tortugas.jpg' },
  { key: 'SIERRA', name: 'Andes', text: 'Volcanes, lagunas y ciudades coloniales', img: 'quilotoa.jpg' },
  { key: 'AMAZONIA', name: 'Amazonía', text: 'Selva, ríos y comunidades', img: 'cuyabeno-2.jpg' },
  { key: 'COSTA', name: 'Costa', text: 'Playas, ballenas y surf', img: 'montanita.jpg' },
];

export default function Home() {
  usePageTitle(null);
  const [destinos, setDestinos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [destacadas, setDestacadas] = useState({ loading: true, data: [], error: null });
  const [recientes, setRecientes] = useState([]);
  const imgBase = import.meta.env.VITE_API_URL?.replace(/\/api\/v1\/?$/, '') ?? 'http://localhost:3000';

  const loadDestacadas = () => {
    setDestacadas((s) => ({ ...s, loading: true, error: null }));
    Atracciones.list({ featured: 'true', limit: 8 })
      .then((r) => setDestacadas({ loading: false, data: r.data, error: null }))
      .catch((error) => setDestacadas({ loading: false, data: [], error }));
  };

  useEffect(() => {
    Destinos.list().then(setDestinos).catch(() => {});
    Categorias.list().then(setCategorias).catch(() => {});
    loadDestacadas();
    const ids = recentStore.list();
    if (ids.length) Atracciones.details(ids.slice(0, 4)).then((r) => setRecientes(r.data)).catch(() => {});
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-bg" style={{ backgroundImage: 'url(/img/hero-cotopaxi.jpg)' }} role="img" aria-label="Volcán Cotopaxi cubierto de nieve sobre el páramo andino" />
        <div className="container">
          <span className="hero-eyebrow"><Sparkles size={16} aria-hidden="true" /> +20 experiencias con guías locales</span>
          <h1 id="hero-title">Vive Ecuador, cuatro mundos en un solo país</h1>
          <p className="hero-sub">Reserva tours, entradas y aventuras en Galápagos, los Andes, la Amazonía y la Costa. Confirmación inmediata y cancelación gratuita en la mayoría de experiencias.</p>
          <SearchBar destinos={destinos} />
        </div>
        <span className="hero-credit">
          Foto: <a href="https://commons.wikimedia.org/wiki/File:Cotopaxi_01.jpg" target="_blank" rel="noopener noreferrer">Cotopaxi, Wikimedia Commons</a> (CC BY-SA 3.0)
        </span>
      </section>

      <div className="container">
        <div className="trust">
          {[
            { icon: CalendarCheck, t: 'Cancelación gratuita', s: 'Hasta 24 h antes en la mayoría' },
            { icon: ShieldCheck, t: 'Pago seguro', s: 'Tarjeta, transferencia o en sitio' },
            { icon: BadgeCheck, t: 'Operadores verificados', s: 'Guías locales certificados' },
            { icon: Headphones, t: 'Soporte en español', s: 'Te ayudamos antes y durante tu viaje' },
          ].map(({ icon: Icon, t, s }) => (
            <div key={t} className="trust-item">
              <span className="ti-icon"><Icon size={22} aria-hidden="true" /></span>
              <div><strong>{t}</strong><span>{s}</span></div>
            </div>
          ))}
        </div>

        {categorias.length > 0 && (
          <section className="section" aria-labelledby="cat-title">
            <div className="section-head">
              <div>
                <span className="eyebrow">Inspírate</span>
                <h2 id="cat-title">¿Qué te gustaría vivir?</h2>
              </div>
            </div>
            <div className="cat-scroller">
              {categorias.map((c) => (
                <Link key={c.id} to={`/explorar?categoria=${c.slug}`} className="cat-card">
                  <span className="ci"><CategoryIcon name={c.icono} size={24} /></span>
                  <span>{c.nombre}<br /><small>{c.total_atracciones} experiencias</small></span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {recientes.length > 0 && (
          <section className="section" aria-labelledby="rec-title">
            <div className="section-head">
              <div>
                <span className="eyebrow"><History size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Continúa donde te quedaste</span>
                <h2 id="rec-title">Vistos recientemente</h2>
              </div>
            </div>
            <div className="grid-cards">
              {recientes.map((a) => <AttractionCard key={a.id} a={a} />)}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="dest-title">
          <div className="section-head">
            <div>
              <span className="eyebrow">Lo más reservado</span>
              <h2 id="dest-title">Experiencias destacadas</h2>
              <p>Las favoritas de los viajeros este mes</p>
            </div>
            <Link to="/explorar" className="btn">Ver todas <ArrowRight size={18} /></Link>
          </div>
          {destacadas.error ? (
            <ErrorState error={destacadas.error} onRetry={loadDestacadas} />
          ) : (
            <div className="grid-cards" aria-busy={destacadas.loading}>
              {destacadas.loading
                ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)
                : destacadas.data.map((a) => <AttractionCard key={a.id} a={a} />)}
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="reg-title">
          <div className="section-head">
            <div>
              <span className="eyebrow">Cuatro mundos</span>
              <h2 id="reg-title">Explora por región</h2>
            </div>
          </div>
          <div className="region-grid">
            {REGIONES.map((r) => (
              <Link key={r.key} to={`/explorar?region=${r.key}`} className="region-card">
                <img src={`${imgBase}/img/${r.img}`} alt="" loading="lazy" decoding="async" width="400" height="300" onError={onImgError} />
                <div className="rc-body">
                  <h3>{r.name}</h3>
                  <p>{r.text}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {destinos.length > 0 && (
          <section className="section" aria-labelledby="dst-title">
            <div className="section-head">
              <div>
                <span className="eyebrow">Destinos</span>
                <h2 id="dst-title">Destinos populares</h2>
              </div>
              <Link to="/destinos" className="btn">Todos los destinos <ArrowRight size={18} /></Link>
            </div>
            <div className="dest-grid">
              {[...destinos].sort((a, b) => b.total_atracciones - a.total_atracciones).slice(0, 4).map((d) => (
                <Link key={d.id} to={`/explorar?destino=${d.codigo}`} className="dest-card">
                  <img src={d.imagen} alt="" loading="lazy" decoding="async" width="400" height="300" onError={onImgError} />
                  <div className="rc-body">
                    <h3>{d.nombre}</h3>
                    <p>{d.total_atracciones} experiencias · {d.provincia}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="how-title">
          <div className="section-head">
            <div>
              <span className="eyebrow">Fácil y seguro</span>
              <h2 id="how-title">Reserva en 3 pasos</h2>
            </div>
          </div>
          <div className="steps-how">
            {[
              ['Elige tu experiencia', 'Filtra por destino, precio, duración o tipo de actividad y compara opiniones reales.'],
              ['Reserva tu cupo', 'Selecciona fecha, horario y personas. Ves la disponibilidad en tiempo real.'],
              ['Vive el Ecuador', 'Recibe tu código de reserva al instante y preséntalo en el punto de encuentro.'],
            ].map(([t, d], i) => (
              <div key={t} className="how-card">
                <div className="num">{i + 1}</div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="cta-band">
            <div>
              <h2>¿Tienes dudas antes de reservar?</h2>
              <p>Revisa nuestra guía de reservas, pagos y cancelaciones o escríbenos.</p>
            </div>
            <div className="row">
              <Link to="/ayuda" className="btn btn-cta"><CreditCard size={18} /> Centro de ayuda</Link>
              <Link to="/contacto" className="btn btn-on-dark">Contáctanos</Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
