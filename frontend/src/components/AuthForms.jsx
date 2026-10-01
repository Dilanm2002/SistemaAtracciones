import { useRef, useState } from 'react';
import { Check, Eye, EyeOff, Lock, Mail, Phone, User, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Alert, Field, RequiredLegend, Spinner } from './ui';
import { iniciarConGoogle } from '../utils/google';
import { correo, LIMITES, limpiar, nombrePersona, password, soloDigitos, telefono } from '../utils/validation';


function PasswordInput({ value, onChange, autoComplete, ...p }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-icon">
      <Lock size={18} aria-hidden="true" />
      <input {...p} className="input" type={show ? 'text' : 'password'} maxLength={LIMITES.password} value={value} onChange={onChange} autoComplete={autoComplete} style={{ paddingRight: 48 }} />
      <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={show}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

/** «Continuar con Google» (como en Sal y Canela). Al volver, se regresa a la página actual. */
export function GoogleButton({ texto = 'Continuar con Google' }) {
  const { pathname, search, state } = useLocation();
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState(null);
  const volverA = pathname === '/ingresar' || pathname === '/registro' ? state?.from : `${pathname}${search}`;
  return (
    <>
      <button type="button" className="btn btn-google btn-lg btn-block" disabled={saliendo} onClick={() => {
        setSaliendo(true);
        setError(null);
        iniciarConGoogle(volverA).catch((e) => { setError(e.message); setSaliendo(false); });
      }}>
        {saliendo ? <Spinner /> : (
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
        )}
        {texto}
      </button>
      {error && <Alert tone="warning">{error}</Alert>}
      <div className="auth-sep" role="separator"><span>o con tu correo</span></div>
    </>
  );
}

/**
 * Cuentas de demostración para ingresar rápido. El cliente se completa entero; en
 * administrador y operador se llena solo el correo y el foco pasa a la contraseña,
 * que no se publica en el código (el repositorio es público; CAL-009 / SEG-014).
 */
const DEMO = [
  ['Cliente', 'cliente@descubre-ec.com', 'Cliente123'],
  ['Administrador', 'admin@descubre-ec.com', null],
  ['Operador', 'operador@descubre-ec.com', null],
];

export function LoginForm({ onSuccess, showDemo = true }) {
  const { login } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef(null);

  const usarDemo = (email, pw) => {
    setForm({ email, password: pw ?? '' });
    setErrors({});
    // Sin contraseña publicada: el cursor queda listo en el campo de contraseña
    if (!pw) setTimeout(() => formRef.current?.querySelector('input[autocomplete="current-password"]')?.focus(), 0);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    const eCorreo = correo(form.email);
    if (eCorreo) errs.email = eCorreo;
    if (!form.password) errs.password = 'Ingresa tu contraseña';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    setError(null);
    try {
      const u = await login(form.email.trim(), form.password);
      toast(`¡Hola, ${u.nombre.split(' ')[0]}!`, 'success');
      onSuccess?.(u);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="stack" noValidate>
      <GoogleButton />
        <RequiredLegend />
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Correo electrónico" required error={errors.email}>
        {(p) => (
          <div className="input-icon">
            <Mail size={18} aria-hidden="true" />
            <input {...p} className="input" type="email" autoComplete="email" maxLength={LIMITES.correo} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nombre@correo.com" />
          </div>
        )}
      </Field>
      <Field label="Contraseña" required error={errors.password}>
        {(p) => <PasswordInput {...p} autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
      </Field>
      <button className="btn btn-primary btn-lg btn-block" disabled={sending}>
        {sending && <Spinner />} Iniciar sesión
      </button>
      {showDemo && (
        <details className="demo-box">
          <summary>Cuentas de prueba (demo académica)</summary>
          {DEMO.map(([rol, email, pw]) => (
            <button key={email} type="button" onClick={() => usarDemo(email, pw)}>
              <strong>{rol}:</strong> {email} · {pw ?? <em>escribe la contraseña</em>}
            </button>
          ))}
        </details>
      )}
    </form>
  );
}

export function RegisterForm({ onSuccess }) {
  const { register } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ nombre: '', apellido: '', email: '', telefono: '', password: '', terms: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const rules = [
    [form.password.length >= 8, 'Al menos 8 caracteres'],
    [/[A-Za-z]/.test(form.password), 'Al menos una letra'],
    [/\d/.test(form.password), 'Al menos un número'],
  ];

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    Object.assign(errs, limpiar({
      nombre: nombrePersona(form.nombre, { que: 'Tus nombres' }),
      apellido: nombrePersona(form.apellido, { que: 'Tus apellidos' }),
      email: correo(form.email),
      telefono: telefono(form.telefono),
      password: rules.every(([ok]) => ok) ? password(form.password) : 'La contraseña no cumple los requisitos',
    }));
    if (!form.terms) errs.terms = 'Debes aceptar los términos para continuar';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    setError(null);
    try {
      const u = await register({
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(form.telefono ? { telefono: form.telefono.replace(/\s/g, '') } : {}),
      });
      toast(`¡Bienvenido/a a Descubre EC, ${u.nombre.split(' ')[0]}!`, 'success');
      onSuccess?.(u);
    } catch (err) {
      setError(err.message);
      if (err.fieldErrors) setErrors(err.fieldErrors);
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <GoogleButton texto="Registrarse con Google" />
        <RequiredLegend />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-grid">
        <Field label="Nombres" required error={errors.nombre}>
          {(p) => (
            <div className="input-icon"><User size={18} aria-hidden="true" />
              <input {...p} className="input" autoComplete="given-name" maxLength={LIMITES.nombrePersona} value={form.nombre} onChange={set('nombre')} placeholder="Como en tu documento" />
            </div>
          )}
        </Field>
        <Field label="Apellidos" required error={errors.apellido}>
          {(p) => <input {...p} className="input" autoComplete="family-name" maxLength={LIMITES.nombrePersona} value={form.apellido} onChange={set('apellido')} />}
        </Field>
      </div>
      <Field label="Correo electrónico" required error={errors.email} hint="Aquí te enviaremos la confirmación de tus reservas">
        {(p) => (
          <div className="input-icon"><Mail size={18} aria-hidden="true" />
            <input {...p} className="input" type="email" autoComplete="email" maxLength={LIMITES.correo} value={form.email} onChange={set('email')} placeholder="nombre@correo.com" />
          </div>
        )}
      </Field>
      <Field label="Teléfono (opcional)" error={errors.telefono} hint="Celular 09XXXXXXXX (10 dígitos) o fijo 0[2-7]XXXXXXX (9 dígitos)">
        {(p) => (
          <div className="input-icon"><Phone size={18} aria-hidden="true" />
            <input {...p} className="input" type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={LIMITES.telefono} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: soloDigitos(e.target.value) })} placeholder="0991234567" />
          </div>
        )}
      </Field>
      <Field label="Contraseña" required error={errors.password}>
        {(p) => (
          <>
            <PasswordInput {...p} autoComplete="new-password" value={form.password} onChange={set('password')} />
            <ul className="pw-rules" aria-label="Requisitos de la contraseña">
              {rules.map(([ok, t]) => (
                <li key={t} className={ok ? 'ok' : ''}>{ok ? <Check size={14} /> : <X size={14} />} {t}<span className="sr-only">{ok ? ' (cumplido)' : ' (pendiente)'}</span></li>
              ))}
            </ul>
          </>
        )}
      </Field>
      <div>
        <label className="check">
          <input type="checkbox" checked={form.terms} onChange={set('terms')} aria-invalid={!!errors.terms} />
          <span>Acepto los términos de uso y la política de privacidad de Descubre EC.</span>
        </label>
        {errors.terms && <span className="error-text" role="alert">{errors.terms}</span>}
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={sending}>
        {sending && <Spinner />} Crear cuenta
      </button>
    </form>
  );
}
