import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Clock, Compass, Heart, Mail, MapPin, Phone, Send, User } from 'lucide-react';
import { Atracciones, Auth, Destinos, Mensajes } from '../api/client';
import AttractionCard, { onImgError } from '../components/AttractionCard';
import { LoginForm, RegisterForm } from '../components/AuthForms';
import { Alert, Breadcrumbs, CardSkeleton, EmptyState, ErrorState, Field, RequiredLegend, Spinner, useAsync, usePageTitle } from '../components/ui';
import { ROL_LABEL, useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { useToast } from '../context/ToastContext';
import { REGION } from '../utils/format';

// ── Favoritos ────────────────────────────────────────────────────────────
export function Favorites() {
  usePageTitle('Favoritos');
  const { ids } = useFavorites();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!ids.length) { setItems([]); return; }
    Atracciones.details(ids).then((r) => setItems(r.data)).catch(() => setItems([]));
  }, [ids]);

  return (
    <div className="container">
      <div className="page-head">
        <h1>Tus favoritos</h1>
        <p>Experiencias que guardaste para decidir después. Se guardan en este navegador.</p>
      </div>
      {items === null ? (
        <div className="grid-cards">{ids.map((id) => <CardSkeleton key={id} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Heart} title="Aún no guardas experiencias" action={<Link to="/explorar" className="btn btn-primary">Explorar experiencias</Link>}>
          Toca el corazón en cualquier experiencia para guardarla aquí y compararla luego.
        </EmptyState>
      ) : (
        <div className="grid-cards">{items.map((a) => <AttractionCard key={a.id} a={a} />)}</div>
      )}
    </div>
  );
}

// ── Destinos ─────────────────────────────────────────────────────────────
export function Destinations() {
  usePageTitle('Destinos');
  const { data, loading, error, reload } = useAsync(() => Destinos.list(), []);
  return (
    <div className="container">
      <div className="page-head">
        <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Destinos' }]} />
        <h1>Destinos en Ecuador</h1>
        <p>Cuatro regiones, un solo país. Elige tu próximo destino.</p>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="dest-grid">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: '4/3', borderRadius: 12 }} />)}</div> : (
        Object.entries(REGION).map(([k, name]) => {
          const list = data.filter((d) => d.region === k);
          if (!list.length) return null;
          return (
            <section key={k} className="section" style={{ paddingTop: 28 }} aria-labelledby={`reg-${k}`}>
              <div className="section-head">
                <h2 id={`reg-${k}`}>{name}</h2>
                <Link to={`/explorar?region=${k}`} className="btn btn-sm">Ver experiencias en {name}</Link>
              </div>
              <div className="dest-grid">
                {list.map((d) => (
                  <Link key={d.id} to={`/explorar?destino=${d.codigo}`} className="dest-card">
                    <img src={d.imagen} alt="" loading="lazy" onError={onImgError} />
                    <div className="rc-body">
                      <h3>{d.nombre}</h3>
                      <p>{d.total_atracciones} experiencia{d.total_atracciones === 1 ? '' : 's'} · {d.provincia}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

// ── Ayuda (documentación para el usuario) ───────────────────────────────
const FAQ = [
  ['reservar', 'Reservas', [
    ['¿Cómo hago una reserva?', 'Busca la experiencia, elige fecha en el calendario (verás en verde los días con cupo), selecciona horario y número de personas, y presiona "Reservar ahora". Completa tus datos, elige el método de pago y listo: recibirás un código tipo DEC-XXXXXX.'],
    ['¿Necesito una cuenta?', 'Sí. Te pedimos iniciar sesión o crear una cuenta en el último paso para que puedas ver, descargar y cancelar tus reservas cuando quieras. Tu selección no se pierde.'],
    ['¿Los niños pagan?', 'Los niños de 3 a 11 años tienen tarifa reducida (se muestra en cada experiencia). Menores de 3 años no pagan pero cuentan como cupo si ocupan asiento.'],
    ['¿Qué significa "Pocos cupos"?', 'Quedan menos del 20 % de lugares para ese día. Te recomendamos reservar pronto.'],
  ]],
  ['pagos', 'Pagos', [
    ['¿Qué métodos de pago aceptan?', 'Tarjeta de crédito o débito (confirmación inmediata), transferencia bancaria (confirmación en máx. 24 h) y pago en el punto de encuentro (el operador confirma tu cupo).'],
    ['¿Por qué mi reserva dice "Pendiente de pago"?', 'Elegiste transferencia o pago en sitio. Tu cupo está apartado; cuando verifiquemos el pago cambiará a "Confirmada".'],
    ['¿Me pueden cobrar dos veces si hago doble clic?', 'No. Cada intento de pago lleva una clave única (Idempotency-Key): si el botón se presiona dos veces o se corta la conexión, el sistema reconoce que es la misma operación.'],
  ]],
  ['cancelacion', 'Cancelaciones', [
    ['¿Puedo cancelar gratis?', 'La mayoría de experiencias permite cancelar sin costo hasta 24 h antes (algunas 48 o 72 h). El plazo exacto aparece en la ficha de la experiencia y en tu reserva.'],
    ['¿Cómo cancelo?', 'Entra a "Mis reservas", pestaña "Próximas", y presiona "Cancelar". Te pediremos un motivo y confirmaremos antes de hacerlo.'],
    ['¿Y si ya pasó el plazo?', 'El botón cambia a "Solicitar ayuda". Escríbenos y revisaremos tu caso con el operador.'],
  ]],
  ['viaje', 'Durante tu viaje', [
    ['¿Qué debo llevar?', 'Tu código de reserva y un documento de identidad. Cada experiencia tiene una sección "Antes de ir" con recomendaciones de ropa y equipo.'],
    ['¿Qué pasa si hay mal clima?', 'Si el operador cancela por seguridad o clima te ofrecemos otra fecha o el reembolso completo.'],
  ]],
];

export function Help() {
  usePageTitle('Centro de ayuda');
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [hash]);
  return (
    <div className="container">
      <div className="page-head">
        <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Ayuda' }]} />
        <h1>Centro de ayuda</h1>
        <p>Respuestas rápidas sobre reservas, pagos y cancelaciones.</p>
      </div>
      <div className="help-grid">
        <nav className="help-nav" aria-label="Temas de ayuda">
          {FAQ.map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
          <Link to="/contacto" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>¿No encuentras la respuesta?</Link>
        </nav>
        <div className="stack" style={{ gap: 28 }}>
          {FAQ.map(([id, title, qs]) => (
            <section key={id} id={id} aria-labelledby={`h-${id}`}>
              <h2 id={`h-${id}`} style={{ fontSize: '1.3rem' }}>{title}</h2>
              <div className="accordion">
                {qs.map(([q, a]) => (
                  <details key={q}>
                    <summary>{q} <ChevronDown size={20} aria-hidden="true" /></summary>
                    <div className="acc-body">{a}</div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Contacto ─────────────────────────────────────────────────────────────
const ASUNTOS = { RESERVA: 'Consulta sobre una reserva', CANCELACION: 'Cancelación o cambio', PROVEEDOR: 'Quiero publicar mis tours', SUGERENCIA: 'Sugerencia', OTRO: 'Otro' };

export function Contact() {
  usePageTitle('Contacto');
  const [params] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  const codigo = params.get('codigo');
  const [form, setForm] = useState({
    nombre: user?.nombre ?? '',
    email: user?.email ?? '',
    asunto: ASUNTOS[params.get('asunto')] ? params.get('asunto') : 'RESERVA',
    mensaje: codigo ? `Hola, necesito ayuda con mi reserva ${codigo}. ` : '',
    website: '',
  });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => { if (user) setForm((f) => ({ ...f, nombre: f.nombre || user.nombre, email: f.email || user.email })); }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.nombre.trim().length < 3) errs.nombre = 'Escribe tu nombre';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) errs.email = 'Necesitamos un correo válido para responderte';
    if (form.mensaje.trim().length < 10) errs.mensaje = 'Cuéntanos un poco más (mínimo 10 caracteres)';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      await Mensajes.send(form);
      setSent(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container">
      <div className="page-head">
        <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Contacto' }]} />
        <h1>Contáctanos</h1>
        <p>Respondemos en menos de 24 horas, de lunes a domingo.</p>
      </div>
      <div className="contact-layout">
        <div className="card card-pad">
          {sent ? (
            <EmptyState icon={Send} title="¡Mensaje enviado!" action={<Link to="/explorar" className="btn btn-primary">Seguir explorando</Link>}>
              Gracias, {form.nombre.split(' ')[0]}. Te responderemos a {form.email} lo antes posible.
            </EmptyState>
          ) : (
            <form onSubmit={submit} noValidate className="form-grid">
              <div className="span-2"><RequiredLegend /></div>
              <Field label="Nombre" required error={errors.nombre}>{(p) => <input {...p} className="input" autoComplete="name" value={form.nombre} onChange={set('nombre')} />}</Field>
              <Field label="Correo electrónico" required error={errors.email}>{(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />}</Field>
              <Field label="Asunto" className="span-2">
                {(p) => <select {...p} className="select" value={form.asunto} onChange={set('asunto')}>{Object.entries(ASUNTOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
              </Field>
              <Field label="Mensaje" required error={errors.mensaje} hint={`${form.mensaje.length}/2000`} className="span-2">
                {(p) => <textarea {...p} className="textarea" value={form.mensaje} onChange={set('mensaje')} maxLength={2000} placeholder={codigo ? '' : 'Si es sobre una reserva, incluye tu código DEC-XXXXXX'} />}
              </Field>
              {/* Campo trampa anti-spam: invisible para personas */}
              <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
              <div className="span-2">
                <button className="btn btn-primary btn-lg" disabled={sending}>{sending ? <Spinner /> : <Send size={18} />} Enviar mensaje</button>
              </div>
            </form>
          )}
        </div>
        <aside className="card card-pad">
          <h2 style={{ fontSize: '1.1rem' }}>Otras formas de contacto</h2>
          <ul className="info-list">
            <li><span className="ti-icon"><Phone size={20} aria-hidden="true" /></span><div><strong>WhatsApp</strong><br /><span className="muted small">+593 99 000 0000</span></div></li>
            <li><span className="ti-icon"><Mail size={20} aria-hidden="true" /></span><div><strong>Correo</strong><br /><span className="muted small">hola@descubre-ec.com</span></div></li>
            <li><span className="ti-icon"><MapPin size={20} aria-hidden="true" /></span><div><strong>Oficina</strong><br /><span className="muted small">Av. Amazonas y Naciones Unidas, Quito</span></div></li>
            <li><span className="ti-icon"><Clock size={20} aria-hidden="true" /></span><div><strong>Horario</strong><br /><span className="muted small">Todos los días, 08:00 – 20:00</span></div></li>
          </ul>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0' }} />
          <Link to="/ayuda">Revisa primero el centro de ayuda →</Link>
        </aside>
      </div>
    </div>
  );
}

// ── Ingresar / Registro ─────────────────────────────────────────────────
function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-visual" style={{ backgroundImage: 'url(/img/auth-bg.jpg)' }}>
        <div>
          <h2>Tu próxima aventura empieza aquí</h2>
          <p>Guarda tus reservas, cancela sin llamadas y recibe recomendaciones de viaje por todo el Ecuador.</p>
        </div>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
          <p className="center small" style={{ marginTop: 20 }}>{footer}</p>
        </div>
      </div>
    </div>
  );
}

const redirectFor = (u, from) => (from && from !== '/ingresar' && from !== '/registro' ? from : u.rol === 'CLIENTE' ? '/' : '/admin');

export function Login() {
  usePageTitle('Iniciar sesión');
  const navigate = useNavigate();
  const { state } = useLocation();
  return (
    <AuthLayout title="Bienvenido de nuevo" subtitle="Ingresa para ver y gestionar tus reservas." footer={<>¿No tienes cuenta? <Link to="/registro" state={state}>Crea una gratis</Link></>}>
      <LoginForm onSuccess={(u) => navigate(redirectFor(u, state?.from), { replace: true })} />
    </AuthLayout>
  );
}

export function Register() {
  usePageTitle('Crear cuenta');
  const navigate = useNavigate();
  const { state } = useLocation();
  return (
    <AuthLayout title="Crea tu cuenta" subtitle="Tarda menos de un minuto." footer={<>¿Ya tienes cuenta? <Link to="/ingresar" state={state}>Inicia sesión</Link></>}>
      <RegisterForm onSuccess={(u) => navigate(redirectFor(u, state?.from), { replace: true })} />
    </AuthLayout>
  );
}

// ── Perfil ───────────────────────────────────────────────────────────────
export function Profile() {
  usePageTitle('Mi perfil');
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ nombre: user.nombres ?? user.nombre, apellido: user.apellidos ?? '', telefono: user.telefono ?? '', documento: user.documento ?? '' });
  const [pw, setPw] = useState({ actual: '', nueva: '', repetir: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Vacío = quitar el dato (teléfono y documento son opcionales)
      await Auth.updateMe({ nombre: form.nombre.trim(), apellido: form.apellido.trim(), telefono: form.telefono.trim(), documento: form.documento.trim() });
      await refresh();
      toast('Perfil actualizado', 'success');
      setErrors({});
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.actual) errs.actual = 'Ingresa tu contraseña actual';
    if (pw.nueva.length < 8 || !/[A-Za-z]/.test(pw.nueva) || !/\d/.test(pw.nueva)) errs.nueva = 'Mínimo 8 caracteres con letras y números';
    if (pw.nueva !== pw.repetir) errs.repetir = 'Las contraseñas no coinciden';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await Auth.changePassword(pw.actual, pw.nueva);
      setPw({ actual: '', nueva: '', repetir: '' });
      toast('Contraseña actualizada', 'success');
    } catch (err) {
      setErrors({ actual: err.message });
    }
  };

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <h1>Mi perfil</h1>
        <p>{user.email} · {ROL_LABEL[user.rol]}</p>
      </div>
      <form className="card card-pad" onSubmit={save} noValidate style={{ marginBottom: 20 }}>
        <RequiredLegend />
        <h2 className="panel-title"><User size={20} aria-hidden="true" /> Datos personales</h2>
        <div className="form-grid">
          <Field label="Nombres" required error={errors.nombre}>{(p) => <input {...p} className="input" autoComplete="given-name" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />}</Field>
          <Field label="Apellidos" required error={errors.apellido}>{(p) => <input {...p} className="input" autoComplete="family-name" value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} />}</Field>
          <Field label="Teléfono" error={errors.telefono}>{(p) => <input {...p} className="input" type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />}</Field>
          <Field label="Cédula o pasaporte" hint="Cédula de 10 dígitos o pasaporte (ej. AB1234567). Se usa para autocompletar tus reservas" error={errors.documento}>{(p) => <input {...p} className="input" value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />}</Field>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 18 }} disabled={saving}>{saving && <Spinner />} Guardar cambios</button>
      </form>
      <form className="card card-pad" onSubmit={changePw} noValidate>
        <RequiredLegend />
        <h2 className="panel-title">Cambiar contraseña</h2>
        <div className="form-grid">
          <Field label="Contraseña actual" required error={errors.actual} className="span-2">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={pw.actual} onChange={(e) => setPw({ ...pw, actual: e.target.value })} />}</Field>
          <Field label="Nueva contraseña" required error={errors.nueva} hint="Mínimo 8 caracteres con letras y números">{(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.nueva} onChange={(e) => setPw({ ...pw, nueva: e.target.value })} />}</Field>
          <Field label="Repite la nueva contraseña" required error={errors.repetir}>{(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.repetir} onChange={(e) => setPw({ ...pw, repetir: e.target.value })} />}</Field>
        </div>
        <button className="btn" style={{ marginTop: 18 }}>Actualizar contraseña</button>
      </form>
    </div>
  );
}

// ── 404 ──────────────────────────────────────────────────────────────────
export function NotFound() {
  usePageTitle('Página no encontrada');
  return (
    <div className="container not-found">
      <div className="big" aria-hidden="true">404</div>
      <h1 style={{ fontSize: '1.8rem' }}>Esta ruta no está en el mapa</h1>
      <p className="muted">La página que buscas no existe o fue movida.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/" className="btn btn-primary">Ir al inicio</Link>
        <Link to="/explorar" className="btn"><Compass size={18} /> Explorar experiencias</Link>
      </div>
    </div>
  );
}

export function RequireAuth({ children, staff = false }) {
  const { isAuth, isStaff, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !isAuth) navigate('/ingresar', { replace: true, state: { from: location.pathname + location.search } });
  }, [loading, isAuth, navigate, location]);
  if (loading || !isAuth) return <div className="container" style={{ padding: 60 }}><Spinner label="Verificando tu sesión…" /></div>;
  if (staff && !isStaff) {
    return (
      <div className="container" style={{ padding: 40 }}>
        <Alert tone="warning" title="Acceso restringido">
          <p>Esta sección es solo para el personal de Descubre EC. <Link to="/">Volver al inicio</Link></p>
        </Alert>
      </div>
    );
  }
  return children;
}
