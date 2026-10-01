import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Building2, CheckCircle2, Clock, Mountain, Send, UserPlus } from 'lucide-react';
import { Geo, Proveedores } from '../api/client';
import { LoginForm, RegisterForm } from '../components/AuthForms';
import { Alert, Breadcrumbs, Field, RequiredLegend, Spinner, usePageTitle } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDateTime } from '../utils/format';
import { correo, LIMITES, limpiar, ruc, soloDigitos, telefono, texto } from '../utils/validation';

const PASOS = [
  [UserPlus, 'Crea tu cuenta', 'O inicia sesión con la que ya tienes.'],
  [Send, 'Envía la solicitud', 'Datos de tu empresa: RUC, provincia y qué ofreces.'],
  [BadgeCheck, 'Te aprobamos', 'El equipo de Descubre EC revisa tu empresa y te habilita el panel.'],
  [Mountain, 'Sube tus experiencias', 'Cada tour o paquete pasa por revisión y luego se publica.'],
];

const VACIO = { empresa: '', ruc: '', provincia_id: '', correo: '', telefono: '', direccion: '', descripcion: '' };

/** Marketplace: una agencia u operador turístico solicita vender sus tours y paquetes. */
export default function Empresas() {
  usePageTitle('Publica tus tours');
  const { user, isAuth, isStaff, refresh } = useAuth();
  const [sol, setSol] = useState(undefined); // undefined = cargando; null = nunca solicitó
  const [authTab, setAuthTab] = useState('register');

  useEffect(() => {
    if (!isAuth || isStaff) return;
    Proveedores.mia()
      .then((r) => {
        setSol(r.solicitud);
        // Si ya la aprobaron, los permisos nuevos llegan al recargar el usuario
        if (r.solicitud?.estado === 'APROBADA') refresh().catch(() => {});
      })
      .catch(() => setSol(null));
  }, [isAuth, isStaff]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container">
      <div className="page-head">
        <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Para empresas' }]} />
        <h1>Vende tus tours y paquetes en Descubre EC</h1>
        <p>¿Tienes una agencia u operadora turística en Ecuador? Publica tus experiencias y recibe reservas con pago en línea, control de cupos y tu propio panel.</p>
      </div>

      <ol className="steps-grid" aria-label="Cómo funciona">
        {PASOS.map(([Icon, t, d], i) => (
          <li key={t} className="card card-pad">
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <Icon size={22} aria-hidden="true" />
            <h2 style={{ fontSize: '1.02rem', margin: '8px 0 4px' }}>{t}</h2>
            <p className="muted small" style={{ margin: 0 }}>{d}</p>
          </li>
        ))}
      </ol>

      <div className="card card-pad" style={{ maxWidth: 760, margin: '28px auto 0' }}>
        {!isAuth ? (
          <>
            <h2 style={{ fontSize: '1.2rem' }}>Primero, tu cuenta</h2>
            <p className="muted small">La solicitud queda a nombre de la persona responsable de la empresa. Necesitas una cuenta para enviarla y para gestionar después tus experiencias.</p>
            <div className="tabs" role="group" aria-label="Cómo quieres continuar" style={{ marginBottom: 18 }}>
              <button type="button" className="tab" aria-pressed={authTab === 'register'} onClick={() => setAuthTab('register')}>Soy nuevo</button>
              <button type="button" className="tab" aria-pressed={authTab === 'login'} onClick={() => setAuthTab('login')}>Ya tengo cuenta</button>
            </div>
            {authTab === 'login' ? <LoginForm showDemo={false} /> : <RegisterForm />}
          </>
        ) : isStaff ? (
          <div className="stack">
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}><CheckCircle2 size={20} color="var(--success)" style={{ verticalAlign: '-3px' }} /> Tu empresa ya vende en Descubre EC</h2>
            <p className="muted">Gestiona tus tours y paquetes, la disponibilidad y las reservas desde el panel.</p>
            <div><Link className="btn btn-primary" to="/admin/atracciones">Ir a mis experiencias</Link></div>
          </div>
        ) : sol === undefined ? (
          <Spinner label="Consultando tu solicitud…" />
        ) : sol?.estado === 'PENDIENTE' ? (
          <div className="stack">
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}><Clock size={20} style={{ verticalAlign: '-3px' }} /> Tu solicitud está en revisión</h2>
            <p className="muted">Enviaste <strong>{sol.empresa}</strong> (RUC {sol.ruc}) el {fmtDateTime(sol.creado_en)}. El equipo de Descubre EC la revisará y aquí verás el resultado.</p>
          </div>
        ) : sol?.estado === 'APROBADA' ? (
          <div className="stack">
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}><CheckCircle2 size={20} color="var(--success)" style={{ verticalAlign: '-3px' }} /> ¡{sol.empresa} fue aprobada!</h2>
            <p className="muted">Ya puedes subir tus tours y paquetes. Cada uno pasa por una revisión rápida antes de publicarse.</p>
            <div><Link className="btn btn-primary" to="/admin/atracciones?nueva=1" onClick={() => refresh().catch(() => {})}>Subir mi primera experiencia</Link></div>
          </div>
        ) : (
          <SolicitudForm user={user} anterior={sol} onEnviada={setSol} />
        )}
      </div>
    </div>
  );
}

function SolicitudForm({ user, anterior, onEnviada }) {
  const toast = useToast();
  const [provincias, setProvincias] = useState([]);
  const [f, setF] = useState(() =>
    anterior
      ? { empresa: anterior.empresa, ruc: anterior.ruc, provincia_id: String(anterior.provincia_id), correo: anterior.correo, telefono: anterior.telefono, direccion: anterior.direccion ?? '', descripcion: anterior.descripcion }
      : { ...VACIO, correo: user?.email ?? '' },
  );
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { Geo.provincias().then(setProvincias).catch(() => {}); }, []);

  const enviar = async (e) => {
    e.preventDefault();
    const errs = limpiar({
      empresa: texto(f.empresa, { min: 2, max: 150, que: 'El nombre comercial', maxDigitos: 4 }),
      ruc: ruc(f.ruc, { requerido: true }),
      provincia_id: f.provincia_id ? null : 'Elige la provincia de la sede',
      correo: correo(f.correo),
      telefono: telefono(f.telefono, { requerido: true }),
      direccion: texto(f.direccion, { min: 5, max: LIMITES.direccion, requerido: false, que: 'La dirección', maxDigitos: 5 }),
      descripcion: texto(f.descripcion, { min: 30, max: 1000, que: 'La descripción' }),
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      const body = { ...f, provincia_id: Number(f.provincia_id), direccion: f.direccion.trim() || undefined };
      const s = await Proveedores.solicitar(body);
      toast('Solicitud enviada. Te avisaremos aquí cuando la revisemos.', 'success');
      onEnviada(s);
    } catch (err) {
      setErrors((x) => ({ ...x, ...(err.fieldErrors ?? {}), api: err.message }));
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="stack">
      <h2 style={{ fontSize: '1.2rem', margin: 0 }}><Building2 size={20} style={{ verticalAlign: '-3px' }} /> Datos de tu empresa</h2>
      {anterior?.estado === 'RECHAZADA' && (
        <Alert tone="warning" title="Tu solicitud anterior no fue aprobada">
          {anterior.motivo_rechazo} Corrige lo indicado y vuelve a enviarla.
        </Alert>
      )}
      {errors.api && <Alert tone="danger">{errors.api}</Alert>}
      <RequiredLegend />
      <div className="form-grid">
        <Field label="Nombre comercial" required error={errors.empresa} className="span-2">
          {(p) => <input {...p} className="input" maxLength={150} value={f.empresa} onChange={set('empresa')} placeholder="Ej. Kawsay Tours" />}
        </Field>
        <Field label="RUC" required error={errors.ruc} hint="13 dígitos, termina en 001">
          {(p) => <input {...p} className="input" inputMode="numeric" maxLength={13} value={f.ruc} onChange={(e) => setF({ ...f, ruc: soloDigitos(e.target.value) })} />}
        </Field>
        <Field label="Provincia de la sede" required error={errors.provincia_id}>
          {(p) => (
            <select {...p} className="select" value={f.provincia_id} onChange={set('provincia_id')}>
              <option value="">Selecciona…</option>
              {provincias.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
            </select>
          )}
        </Field>
        <Field label="Correo de reservas" required error={errors.correo}>
          {(p) => <input {...p} className="input" type="email" maxLength={LIMITES.correo} value={f.correo} onChange={set('correo')} />}
        </Field>
        <Field label="Teléfono" required error={errors.telefono} hint="Celular 09XXXXXXXX o fijo 0[2-7]XXXXXXX">
          {(p) => <input {...p} className="input" type="tel" inputMode="numeric" maxLength={LIMITES.telefono} value={f.telefono} onChange={(e) => setF({ ...f, telefono: soloDigitos(e.target.value) })} placeholder="0991234567" />}
        </Field>
        <Field label="Dirección" error={errors.direccion} className="span-2">
          {(p) => <input {...p} className="input" maxLength={LIMITES.direccion} value={f.direccion} onChange={set('direccion')} placeholder="Ej. Av. 15 de Noviembre y Rocafuerte, Tena" />}
        </Field>
        <Field label="¿Qué tours o paquetes ofreces?" required error={errors.descripcion} className="span-2" hint={`Entre 30 y 1000 caracteres · ${f.descripcion.length}/1000`}>
          {(p) => <textarea {...p} className="textarea" maxLength={1000} value={f.descripcion} onChange={set('descripcion')} style={{ minHeight: 110 }} placeholder="Ej. Rafting en el río Jatunyacu, visitas a comunidades kichwa y paquetes de 3 días en la selva." />}
        </Field>
      </div>
      <button className="btn btn-primary btn-lg" disabled={sending}>{sending && <Spinner />} Enviar solicitud</button>
    </form>
  );
}
