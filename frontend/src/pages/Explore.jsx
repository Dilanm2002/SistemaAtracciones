import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Compass, Search, SlidersHorizontal, X } from 'lucide-react';
import { Atracciones, Categorias, Destinos } from '../api/client';
import AttractionCard from '../components/AttractionCard';
import { Breadcrumbs, CardSkeleton, EmptyState, ErrorState, useDebounce, useFocusTrap, usePageTitle } from '../components/ui';
import { fmtDate, fmtMoney, PRODUCT_TYPE, REGION } from '../utils/format';

const DURACIONES = {
  short: { label: 'Hasta 4 h', min: 0, max: 4 },
  half: { label: '4 a 8 h', min: 4, max: 8 },
  full: { label: 'Día completo (8–12 h)', min: 8, max: 12 },
  multi: { label: 'Varios días', min: 24, max: undefined },
};
const SORTS = {
  most_popular: 'Más populares',
  rating: 'Mejor calificadas',
  price_asc: 'Precio: menor a mayor',
  price_desc: 'Precio: mayor a menor',
  duration: 'Duración más corta',
  newest: 'Más recientes',
};
const PAGE = 12;

const list = (v) => (v ? v.split(',').filter(Boolean) : []);

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const [destinos, setDestinos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, next: null });
  const [status, setStatus] = useState({ loading: true, more: false, error: null });
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState(params.get('q') ?? '');
  const debounced = useDebounce(text, 400);
  const abort = useRef(null);
  const filtersRef = useRef(null);
  const gridRef = useRef(null);
  const focusFrom = useRef(null);
  // En móvil los filtros son un diálogo: foco atrapado, Esc cierra y vuelve al botón (ACC-004)
  useFocusTrap(filtersRef, drawer, () => setDrawer(false));

  // Estado de filtros derivado de la URL (compartible y funciona con "atrás")
  const f = {
    q: params.get('q') ?? '',
    destino: params.get('destino') ?? '',
    regions: list(params.get('region')),
    cats: list(params.get('categoria')),
    tipos: list(params.get('tipo')),
    dur: params.get('dur') ?? '',
    min: params.get('min') ?? '',
    max: params.get('max') ?? '',
    cancel: params.get('cancel') === '1',
    rating: params.get('rating') ?? '',
    sort: params.get('sort') ?? 'most_popular',
    fecha: params.get('fecha') ?? '',
    personas: params.get('personas') ?? '',
  };

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => {
      const val = Array.isArray(v) ? v.join(',') : v === true ? '1' : v;
      if (val === '' || val === false || val == null) next.delete(k);
      else next.set(k, val);
    });
    setParams(next, { replace: false });
  };
  const toggleIn = (key, arr, value) => update({ [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] });

  useEffect(() => {
    Destinos.list().then(setDestinos).catch(() => {});
    Categorias.list().then(setCategorias).catch(() => {});
  }, []);

  // Búsqueda por texto con retardo para no disparar una petición por tecla
  useEffect(() => {
    if (debounced !== f.q) update({ q: debounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => { setText(params.get('q') ?? ''); }, [params]);

  const body = useMemo(() => {
    const d = DURACIONES[f.dur];
    const filters = {
      ...(f.q ? { query: f.q } : {}),
      ...(f.cats.length ? { categories: f.cats } : {}),
      ...(f.regions.length ? { regions: f.regions } : {}),
      ...(f.tipos.length ? { product_types: f.tipos } : {}),
      ...(f.cancel ? { free_cancellation: true } : {}),
      ...(f.min || f.max ? { price: { ...(f.min ? { min: Number(f.min) } : {}), ...(f.max ? { max: Number(f.max) } : {}) } } : {}),
      ...(d ? { duration: { min_hours: d.min, ...(d.max ? { max_hours: d.max } : {}) } } : {}),
      ...(f.rating ? { rating: { minimum_review_score: Number(f.rating) } } : {}),
    };
    return {
      currency: 'USD',
      countries: ['ec'],
      rows: PAGE,
      sort: { by: f.sort },
      ...(f.destino ? { cities: [Number(f.destino)] } : {}),
      ...(f.fecha ? { dates: { start_date: f.fecha, end_date: f.fecha } } : {}),
      filters,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const run = (append = false) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus({ loading: !append, more: append, error: null });
    focusFrom.current = append ? items.length : null;
    Atracciones.search(append ? { ...body, next_page: meta.next } : body, ctrl.signal)
      .then((r) => {
        setItems((prev) => (append ? [...prev, ...r.data] : r.data));
        setMeta({ total: r.metadata.total_results, next: r.metadata.next_page ?? null });
        setStatus({ loading: false, more: false, error: null });
      })
      .catch((error) => error.name !== 'AbortError' && setStatus({ loading: false, more: false, error }));
  };

  useEffect(() => {
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // Tras "Cargar más", el foco pasa a la primera tarjeta nueva (ACC-017)
  useEffect(() => {
    if (focusFrom.current == null || status.more) return;
    gridRef.current?.querySelectorAll('.a-card-link')[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [items, status.more]);

  const destino = destinos.find((d) => String(d.codigo) === f.destino);
  const titulo = destino ? `Experiencias en ${destino.nombre}` : f.regions.length === 1 ? `Experiencias en ${REGION[f.regions[0]]}` : 'Todas las experiencias';
  usePageTitle(titulo);

  // Chips de filtros activos (visibilidad + control para deshacer cada uno)
  const chips = [
    f.q && { label: `"${f.q}"`, clear: () => { setText(''); update({ q: '' }); } },
    destino && { label: destino.nombre, clear: () => update({ destino: '' }) },
    ...f.regions.map((r) => ({ label: REGION[r], clear: () => toggleIn('region', f.regions, r) })),
    ...f.cats.map((c) => ({ label: categorias.find((x) => x.slug === c)?.nombre ?? c, clear: () => toggleIn('categoria', f.cats, c) })),
    ...f.tipos.map((t) => ({ label: PRODUCT_TYPE[t], clear: () => toggleIn('tipo', f.tipos, t) })),
    f.dur && { label: DURACIONES[f.dur]?.label, clear: () => update({ dur: '' }) },
    (f.min || f.max) && { label: `${f.min ? fmtMoney(f.min, { compact: true }) : '$0'} – ${f.max ? fmtMoney(f.max, { compact: true }) : 'más'}`, clear: () => update({ min: '', max: '' }) },
    f.cancel && { label: 'Cancelación gratis', clear: () => update({ cancel: '' }) },
    f.rating && { label: `${f.rating}+ estrellas`, clear: () => update({ rating: '' }) },
    f.fecha && { label: `Disponible el ${fmtDate(f.fecha, { day: 'numeric', month: 'short' })}`, clear: () => update({ fecha: '' }) },
  ].filter(Boolean);

  const clearAll = () => { setText(''); setParams(f.sort !== 'most_popular' ? { sort: f.sort } : {}); };
  const detailQuery = f.fecha || f.personas ? `?${new URLSearchParams({ ...(f.fecha && { fecha: f.fecha }), ...(f.personas && { personas: f.personas }) })}` : '';

  const Filters = (
    <aside
      ref={filtersRef}
      id="filtros"
      className={`filters ${drawer ? 'open' : ''}`}
      aria-label="Filtros"
      {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <div className="filters-drawer-head">
        <strong>Filtros</strong>
        <button className="icon-btn" onClick={() => setDrawer(false)} aria-label="Cerrar filtros"><X size={22} aria-hidden="true" /></button>
      </div>
      <div className="card">
        <div className="filter-group">
          <label className="label" htmlFor="f-text" style={{ display: 'block', marginBottom: 8 }}>Buscar</label>
          <div className="input-icon">
            <Search size={18} aria-hidden="true" />
            <input id="f-text" className="input" type="search" placeholder="Volcán, snorkel, museo…" value={text} onChange={(e) => setText(e.target.value)} data-shortcut-search />
          </div>
        </div>
        <div className="filter-group">
          <label className="label" htmlFor="f-dest" style={{ display: 'block', marginBottom: 8 }}>Destino</label>
          <select id="f-dest" className="select" value={f.destino} onChange={(e) => update({ destino: e.target.value })}>
            <option value="">Todo Ecuador</option>
            {Object.entries(REGION).map(([k, name]) => (
              <optgroup key={k} label={name}>
                {destinos.filter((d) => d.region === k).map((d) => (
                  <option key={d.id} value={d.codigo}>{d.nombre} ({d.total_atracciones})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Región</legend>
            <div className="chip-row">
              {Object.entries(REGION).map(([k, name]) => (
                <button key={k} type="button" className="chip" aria-pressed={f.regions.includes(k)} onClick={() => toggleIn('region', f.regions, k)}>{name}</button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Categoría</legend>
            <div className="filter-options">
              {categorias.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={f.cats.includes(c.slug)} onChange={() => toggleIn('categoria', f.cats, c.slug)} />
                  <span>{c.nombre}</span>
                  <span className="cnt">{c.total_atracciones}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Precio por persona (USD)</legend>
            <div className="price-inputs">
              <input className="input" type="number" min="0" inputMode="numeric" placeholder="Mín." aria-label="Precio mínimo" defaultValue={f.min} key={`min${f.min}`} onBlur={(e) => update({ min: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && update({ min: e.currentTarget.value })} />
              <span className="muted">–</span>
              <input className="input" type="number" min="0" inputMode="numeric" placeholder="Máx." aria-label="Precio máximo" defaultValue={f.max} key={`max${f.max}`} onBlur={(e) => update({ max: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && update({ max: e.currentTarget.value })} />
            </div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              {[['', '30', 'Hasta $30'], ['30', '80', '$30–80'], ['80', '', '+$80']].map(([mn, mx, l]) => (
                <button key={l} type="button" className="chip" aria-pressed={f.min === mn && f.max === mx} onClick={() => update({ min: mn, max: mx })}>{l}</button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Duración</legend>
            <div className="filter-options">
              {Object.entries(DURACIONES).map(([k, d]) => (
                <label key={k} className="check">
                  <input type="radio" name="dur" checked={f.dur === k} onChange={() => update({ dur: k })} onClick={() => f.dur === k && update({ dur: '' })} />
                  <span>{d.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Tipo de experiencia</legend>
            <div className="filter-options">
              {Object.entries(PRODUCT_TYPE).map(([k, l]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={f.tipos.includes(k)} onChange={() => toggleIn('tipo', f.tipos, k)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <fieldset>
            <legend>Calificación</legend>
            <div className="chip-row">
              {['4', '4.5'].map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={f.rating === r} onClick={() => update({ rating: f.rating === r ? '' : r })}>{r}+ ★</button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-group">
          <label className="check">
            <input type="checkbox" checked={f.cancel} onChange={(e) => update({ cancel: e.target.checked })} />
            <span>Solo con cancelación gratuita</span>
          </label>
        </div>
      </div>
      <div className="filters-drawer-foot">
        <button className="btn" onClick={clearAll}>Limpiar</button>
        <button className="btn btn-primary" onClick={() => setDrawer(false)}>Ver {meta.total} resultados</button>
      </div>
    </aside>
  );

  return (
    <div className="container" style={{ paddingTop: 24 }}>
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Explorar', to: '/explorar' }, ...(destino ? [{ label: destino.nombre }] : [])]} />
      <div className="explore" style={{ marginTop: 18 }}>
        {Filters}
        <section aria-labelledby="res-title">
          <div className="results-bar">
            <div>
              <h1 id="res-title">{titulo}</h1>
              <p className="muted small" style={{ margin: '4px 0 0' }} aria-live="polite">
                {status.loading ? 'Buscando…' : `${meta.total} ${meta.total === 1 ? 'experiencia encontrada' : 'experiencias encontradas'}`}
              </p>
            </div>
            <div className="row">
              <button className="btn filters-toggle" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="filtros" aria-haspopup="dialog">
                <SlidersHorizontal size={18} aria-hidden="true" /> Filtros {chips.length > 0 && <span className="badge badge-primary">{chips.length}</span>}
              </button>
              <label className="sr-only" htmlFor="sort">Ordenar por</label>
              <select id="sort" className="select sort-select" value={f.sort} onChange={(e) => update({ sort: e.target.value === 'most_popular' ? '' : e.target.value })}>
                {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="active-filters" aria-label="Filtros activos">
              {chips.map((c, i) => (
                <button key={i} className="chip chip-remove" onClick={c.clear} aria-label={`Quitar filtro ${c.label}`}>
                  {c.label} <X size={14} aria-hidden="true" />
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={clearAll}>Limpiar todo</button>
            </div>
          )}

          {status.error ? (
            <ErrorState error={status.error} onRetry={() => run(false)} />
          ) : status.loading ? (
            <div className="grid-cards" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}</div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No encontramos experiencias con esos filtros"
              action={<button className="btn btn-primary" onClick={clearAll}>Quitar todos los filtros</button>}
            >
              Prueba quitando algún filtro, ampliando el rango de precio o buscando en toda la región.
            </EmptyState>
          ) : (
            <>
              <div className="grid-cards" ref={gridRef}>
                {items.map((a) => <AttractionCard key={a.id} a={a} query={detailQuery} />)}
              </div>
              <div className="load-more">
                <span className="muted small" aria-live="polite">Mostrando {items.length} de {meta.total}</span>
                <div className="progress" aria-hidden="true"><span style={{ width: `${(items.length / meta.total) * 100}%` }} /></div>
                {meta.next && (
                  <button className="btn" onClick={() => run(true)} disabled={status.more}>
                    {status.more ? <><span className="spinner" aria-hidden="true" /> Cargando…</> : 'Cargar más experiencias'}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
