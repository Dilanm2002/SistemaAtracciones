import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, MapPin, Search, Users } from 'lucide-react';
import { todayEc } from '../utils/format';
import { Qty } from './ui';

/** Buscador principal: destino/texto, fecha y personas. */
export default function SearchBar({ destinos = [] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [fecha, setFecha] = useState('');
  const [personas, setPersonas] = useState(2);

  const submit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const destino = destinos.find((d) => d.nombre.toLowerCase() === q.trim().toLowerCase());
    if (destino) params.set('destino', destino.codigo);
    else if (q.trim()) params.set('q', q.trim());
    if (fecha) params.set('fecha', fecha);
    params.set('personas', personas);
    navigate(`/explorar?${params}`);
  };

  return (
    <form className="searchbar" onSubmit={submit} role="search" aria-label="Buscar experiencias">
      <div className="sb-field">
        <label htmlFor="sb-q"><MapPin size={14} aria-hidden="true" /> ¿A dónde quieres ir?</label>
        <input
          id="sb-q"
          className="sb-input"
          list="sb-destinos"
          placeholder="Galápagos, Baños, volcán…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <datalist id="sb-destinos">
          {destinos.map((d) => <option key={d.id} value={d.nombre}>{d.provincia}</option>)}
        </datalist>
      </div>
      <div className="sb-field">
        <label htmlFor="sb-fecha"><CalendarDays size={14} aria-hidden="true" /> Fecha</label>
        <input id="sb-fecha" type="date" className="sb-input" min={todayEc()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <div className="sb-field">
        <span className="label" id="sb-pers" style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Users size={14} aria-hidden="true" /> Personas
        </span>
        <div className="sb-people" aria-labelledby="sb-pers">
          <Qty value={personas} onChange={setPersonas} min={1} max={20} label="personas" />
        </div>
      </div>
      <button className="btn btn-cta btn-lg" type="submit">
        <Search size={20} aria-hidden="true" /> Buscar
      </button>
    </form>
  );
}
