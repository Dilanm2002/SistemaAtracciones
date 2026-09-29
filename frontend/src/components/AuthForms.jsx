import { useState } from 'react';
import { Check, Eye, EyeOff, Lock, Mail, Phone, User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Alert, Field, RequiredLegend, Spinner } from './ui';
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

const DEMO = [
  ['Cliente', 'cliente@descubre-ec.com', 'Cliente123'],
  ['Administrador', 'admin@descubre-ec.com', 'Admin123'],
  ['Operador', 'operador@descubre-ec.com', 'Operador123'],
];

export function LoginForm({ onSuccess, showDemo = true }) {
  const { login } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

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
    <form onSubmit={submit} className="stack" noValidate>
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
            <button key={email} type="button" onClick={() => setForm({ email, password: pw })}>
              <strong>{rol}:</strong> {email} · {pw}
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
