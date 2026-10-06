import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { Crosshair, Move, Search } from 'lucide-react';
import { Spinner } from '../components/ui';
import { ECUADOR } from '../utils/validation';

/** Íconos del marcador servidos desde el propio sitio (Vite los empaqueta). */
const PIN = L.icon({ iconUrl, iconRetinaUrl, shadowUrl, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
const CENTRO_EC = [-1.6, -78.5];
const LIMITES_EC = L.latLngBounds([ECUADOR.latMin, ECUADOR.lngMin], [ECUADOR.latMax, ECUADOR.lngMax]);
const NOMINATIM = 'https://nominatim.openstreetmap.org';
/** MOV-015: en pantallas táctiles el mapa no captura el arrastre de un dedo (si no, el formulario no se puede desplazar). */
const TACTIL = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const redondear = (n) => Math.round(n * 1e6) / 1e6;
const dentro = (lat, lng) => lat >= ECUADOR.latMin && lat <= ECUADOR.latMax && lng >= ECUADOR.lngMin && lng <= ECUADOR.lngMax;

/**
 * Selector de ubicación intuitivo: la empresa busca el lugar por nombre o hace clic en el mapa
 * (y puede arrastrar el marcador); la latitud y longitud se completan solas. Si la dirección
 * está vacía, se sugiere a partir del punto elegido. Mapa de OpenStreetMap con Leaflet.
 */
export default function MapaUbicacion({ lat, lng, onChange, ciudad, onDireccion, error }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcador = useRef(null);
  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [resultados, setResultados] = useState([]); // varias coincidencias: la persona elige
  const hayPunto = lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

  // Mantiene la última función recibida sin re-crear el mapa
  const cambio = useRef(onChange);
  const sugerir = useRef(onDireccion);
  cambio.current = onChange;
  sugerir.current = onDireccion;

  const elegir = async (la, ln, { centrar = false, direccion = true } = {}) => {
    if (!dentro(la, ln)) {
      setAviso('Ese punto está fuera del Ecuador. Elige un lugar dentro del país.');
      return;
    }
    setAviso(null);
    cambio.current(redondear(la), redondear(ln));
    if (centrar) mapa.current?.setView([la, ln], Math.max(mapa.current.getZoom(), 14));
    if (direccion && sugerir.current) {
      try {
        const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=17&accept-language=es&lat=${la}&lon=${ln}`);
        const d = await r.json();
        if (d?.display_name) sugerir.current(d.display_name.split(',').slice(0, 3).join(',').trim());
      } catch {
        /* sin sugerencia de dirección: no es obligatorio */
      }
    }
  };

  const [moverMapa, setMoverMapa] = useState(!TACTIL);
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (moverMapa) m.dragging.enable();
    else m.dragging.disable();
  }, [moverMapa]);

  // Crear el mapa una sola vez
  useEffect(() => {
    const m = L.map(contenedor.current, { maxBounds: LIMITES_EC.pad(0.2), minZoom: 5, dragging: !TACTIL }).setView(hayPunto ? [Number(lat), Number(lng)] : CENTRO_EC, hayPunto ? 14 : 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    m.on('click', (e) => elegir(e.latlng.lat, e.latlng.lng));
    mapa.current = m;
    // El modal termina de medirse después de montar: recalcula el tamaño del mapa
    setTimeout(() => m.invalidateSize(), 250);
    return () => m.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcador sincronizado con lat/lng (también si se editan a mano)
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (!hayPunto) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    const pos = [Number(lat), Number(lng)];
    if (!marcador.current) {
      marcador.current = L.marker(pos, { icon: PIN, draggable: true, keyboard: true, title: 'Ubicación de la actividad (arrástrala para ajustar)' }).addTo(m);
      marcador.current.on('dragend', (e) => {
        const p = e.target.getLatLng();
        elegir(p.lat, p.lng);
      });
    } else {
      marcador.current.setLatLng(pos);
    }
  }, [lat, lng, hayPunto]);

  // Al elegir el destino sin punto marcado, el mapa se acerca a esa ciudad
  useEffect(() => {
    if (!ciudad || hayPunto || !mapa.current) return;
    let vivo = true;
    fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&countrycodes=ec&accept-language=es&q=${encodeURIComponent(ciudad)}`)
      .then((r) => r.json())
      .then((d) => { if (vivo && d?.[0]) mapa.current?.setView([Number(d[0].lat), Number(d[0].lon)], 12); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [ciudad]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Busca en Ecuador (primero cerca del destino elegido). Con varias coincidencias, se listan para elegir. */
  const buscar = async (e) => {
    e?.preventDefault();
    const texto = q.trim();
    if (texto.length < 3) { setAviso('Escribe al menos 3 letras del lugar que buscas.'); return; }
    setBuscando(true);
    setAviso(null);
    setResultados([]);
    const consultar = async (consulta) =>
      (await fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&countrycodes=ec&accept-language=es&q=${encodeURIComponent(consulta)}`)).json();
    try {
      let d = ciudad ? await consultar(`${texto}, ${ciudad}`) : [];
      if (!d?.length) d = await consultar(texto);
      if (!d?.length) { setAviso('No encontramos ese lugar. Prueba con otro nombre o haz clic en el mapa.'); return; }
      if (d.length === 1) await elegir(Number(d[0].lat), Number(d[0].lon), { centrar: true });
      else setResultados(d.map((x) => ({ lat: Number(x.lat), lon: Number(x.lon), nombre: x.display_name })));
    } catch {
      setAviso('No pudimos buscar en este momento. Haz clic directamente en el mapa.');
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="mapa-ubicacion">
      <div className="mapa-buscar" role="search">
        <div className="input-icon" style={{ flex: 1 }}>
          <Search size={18} aria-hidden="true" />
          <input
            className="input"
            type="search"
            maxLength={120}
            placeholder="Busca el lugar: ej. Mitad del Mundo, Laguna Quilotoa…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar(e); }}
            aria-label="Buscar el lugar en el mapa"
          />
        </div>
        <button type="button" className="btn" onClick={buscar} disabled={buscando}>{buscando ? <Spinner /> : <Search size={16} />} Buscar</button>
      </div>
      {resultados.length > 0 && (
        <ul className="mapa-resultados" aria-label="Resultados de la búsqueda: elige el lugar correcto">
          {resultados.map((x) => (
            <li key={`${x.lat},${x.lon}`}>
              <button type="button" onClick={() => { setResultados([]); elegir(x.lat, x.lon, { centrar: true }); }}>
                {x.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mapa-marco">
        <div ref={contenedor} className={`mapa-lienzo${error ? ' is-invalid' : ''}`} aria-label="Mapa: haz clic para marcar la ubicación de la actividad" />
        {TACTIL && (
          <button type="button" className={`btn btn-sm mapa-mover${moverMapa ? ' activo' : ''}`} aria-pressed={moverMapa} onClick={() => setMoverMapa((v) => !v)}>
            <Move size={16} aria-hidden="true" /> {moverMapa ? 'Listo' : 'Mover el mapa'}
          </button>
        )}
      </div>
      {TACTIL && !moverMapa && <p className="hint" style={{ margin: '6px 0 0' }}>Desliza fuera del mapa para seguir con el formulario. Toca el mapa para marcar el lugar o pellizca para acercar.</p>}
      <p className="hint" style={{ margin: '6px 0 0', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Crosshair size={14} aria-hidden="true" />
        {hayPunto ? `Ubicación marcada (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}). Arrastra el marcador para ajustarla.` : 'Haz clic en el mapa o busca el lugar para marcar dónde se realiza la actividad.'}
      </p>
      {(aviso || error) && <span className="error-text" role="alert">{aviso ?? error}</span>}
    </div>
  );
}
