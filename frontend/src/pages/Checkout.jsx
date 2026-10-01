import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CalendarDays, Clock, CreditCard, Landmark, Lock, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Atracciones, newIdempotencyKey, Reservas } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { LoginForm, RegisterForm } from '../components/AuthForms';
import { Alert, Breadcrumbs, ErrorState, Field, RequiredLegend, Spinner, usePageTitle } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDateLong, fmtMoney } from '../utils/format';
import { correo, documento as validarDocumento, enDias, fecha as validarFecha, hora as validarHora, hoyEc, LIMITES, limpiar, nombrePersona, RE_NOMBRE_PERSONA, soloDigitos, telefono, texto } from '../utils/validation';

const luhn = (num) => {
  const d = num.replace(/\D/g, '');
  if (d.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
};
/** Marca por el prefijo (IIN); solo se envía la marca y los 4 últimos dígitos. */
const marcaTarjeta = (n) => {
  const d = n.replace(/\D/g, '');
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'MASTERCARD';
  if (/^3[47]/.test(d)) return 'AMEX';
  if (/^3(0[0-5]|[68])/.test(d)) return 'DINERS';
  return 'OTRA';
};

const fmtCard = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtExp = (v) => v.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2');

export default function Checkout() {
  usePageTitle('Completa tu reserva');
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuth } = useAuth();
  const toast = useToast();

  const fecha = params.get('fecha');
  const hora = params.get('hora');
  // Los parámetros de la URL se pueden editar a mano: se acotan a los límites de la API (máx. 30 por reserva)
  const entero = (v, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(v)) || min));
  const adultos = entero(params.get('adultos'), 1, 30);
  const ninos = entero(params.get('ninos'), 0, 30 - adultos);

  const [a, setA] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [slot, setSlot] = useState(null);
  const [step, setStep] = useState(1);
  const [authTab, setAuthTab] = useState('login');
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '', documento: '', notas: '' });
  const [pay, setPay] = useState({ metodo: 'TARJETA', numero: '', exp: '', cvv: '', titular: '', terms: false });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [sending, setSending] = useState(false);
  // Una sola clave por intento de compra: reintentos o doble clic no crean dos reservas
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => {
    Atracciones.get(id).then(setA).catch(setLoadError);
    if (fecha) Atracciones.availability(id, fecha).then((r) => setSlot(r.slots?.find((s) => s.time === hora) ?? null)).catch(() => {});
  }, [id, fecha, hora]);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, nombre: f.nombre || user.nombre, email: f.email || user.email, telefono: f.telefono || user.telefono || '', documento: f.documento || user.documento || '' }));
  }, [user]);

  // Fecha y hora también vienen de la URL: deben tener formato válido y la fecha no puede ser pasada
  const fechaHoraInvalida = !fecha || !hora || validarFecha(fecha, { min: hoyEc(), max: enDias(365) }) || validarHora(hora);
  if (fechaHoraInvalida) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <Alert tone="warning" title="Falta elegir una fecha y un horario válidos">
          <p>Vuelve a la experiencia y selecciona fecha, horario y participantes. <Link to={`/atraccion/${id}`}>Elegir fecha</Link></p>
        </Alert>
      </div>
    );
  }
  if (loadError) return <div className="container"><ErrorState error={loadError} onRetry={() => window.location.reload()} /></div>;
  if (!a) return <div className="container" style={{ paddingTop: 40 }}><Spinner label="Preparando tu reserva…" /></div>;

  const childPrice = a.child_price?.total ?? a.price.total;
  const total = adultos * a.price.total + ninos * childPrice;
  const pax = adultos + ninos;
  const sinCupo = slot && slot.available < pax;
  const back = `/atraccion/${id}?fecha=${fecha}&personas=${adultos}`;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setP = (k, fmt) => (e) => setPay({ ...pay, [k]: e.target.type === 'checkbox' ? e.target.checked : fmt ? fmt(e.target.value) : e.target.value });

  const validateStep1 = () => {
    const errs = {};
    Object.assign(errs, limpiar({
      nombre: nombrePersona(form.nombre, { que: 'El nombre del titular' }) ?? (form.nombre.trim().split(/\s+/).length < 2 ? 'Escribe nombre y apellido del titular' : null),
      email: correo(form.email),
      telefono: telefono(form.telefono, { requerido: true }),
      documento: validarDocumento(form.documento),
      notas: texto(form.notas, { max: LIMITES.notas, requerido: false, que: 'Las notas' }),
    }));
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const validateStep2 = () => {
    const errs = {};
    if (pay.metodo === 'TARJETA') {
      const digitos = pay.numero.replace(/\D/g, '');
      if (digitos.length < 13 || digitos.length > 19 || !luhn(pay.numero)) errs.numero = 'El número de tarjeta no es válido. Revisa los dígitos.';
      const [mm, yy] = pay.exp.split('/').map(Number);
      const now = new Date();
      if (!mm || mm > 12 || !yy || new Date(2000 + yy, mm) <= now) errs.exp = 'Fecha inválida o tarjeta vencida (MM/AA)';
      else if (2000 + yy > now.getFullYear() + 20) errs.exp = 'El año de vencimiento no es válido';
      if (!/^\d{3,4}$/.test(pay.cvv)) errs.cvv = '3 o 4 dígitos al reverso';
      if (pay.titular.trim().length < 3 || !RE_NOMBRE_PERSONA.test(pay.titular.trim())) errs.titular = 'Nombre como aparece en la tarjeta (solo letras)';
    }
    if (!pay.terms) errs.terms = 'Acepta la política de cancelación para continuar';
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const next = (e) => {
    e.preventDefault();
    if (validateStep1()) { setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateStep2() || sending) return;
    setSending(true);
    setSubmitError(null);
    try {
      const r = await Reservas.create(
        a.id,
        {
          date: fecha,
          time: hora,
          ticket_count: pax,
          children: ninos,
          customer_name: form.nombre.trim(),
          customer_email: form.email.trim(),
          customer_phone: form.telefono.replace(/\s/g, ''),
          ...(form.documento.trim() ? { customer_document: form.documento.trim().toUpperCase() } : {}),
          ...(form.notas.trim() ? { notes: form.notas.trim() } : {}),
          payment_method: pay.metodo,
          // Nunca se envía el número completo ni el CVV (PCI-DSS): solo lo que se guarda en pago_tarjeta
          ...(pay.metodo === 'TARJETA'
            ? {
                card: {
                  brand: marcaTarjeta(pay.numero),
                  last4: pay.numero.replace(/\D/g, '').slice(-4),
                  holder: pay.titular.trim(),
                  exp_month: Number(pay.exp.split('/')[0]),
                  exp_year: 2000 + Number(pay.exp.split('/')[1]),
                },
              }
            : {}),
        },
        idemKey.current,
      );
      toast('¡Reserva creada con éxito!', 'success');
      navigate(`/reserva/${r.reservation_id}/confirmada`, { replace: true, state: { reservation: r } });
    } catch (err) {
      setSubmitError(err);
      // Si falló por cupos o datos, el siguiente intento es una operación distinta
      if (err.status && err.status < 500) idemKey.current = newIdempotencyKey();
    } finally {
      setSending(false);
    }
  };

  // Política de cancelación que tendrá ESTA reserva (misma lógica que la API: plazo + 1 h de arrepentimiento)
  const ultimoMomento = a.free_cancellation && Date.now() > new Date(`${fecha}T${hora}:00-05:00`).getTime() - a.cancellation_hours * 3600000;
  const politica = !a.free_cancellation
    ? 'Sin cancelación gratuita: tendrás 1 hora después de reservar para arrepentirte con reembolso total; luego puedes cancelar, pero sin reembolso.'
    : ultimoMomento
      ? `Reserva de último momento: el plazo de cancelación gratuita (${a.cancellation_hours} h antes) ya pasó. Tendrás 1 hora después de reservar para cancelar con reembolso total; luego, solo sin reembolso.`
      : `Cancelación gratis hasta ${a.cancellation_hours} h antes de la salida; después, sin reembolso.`;

  const Summary = (
    <aside className="order-summary card" aria-label="Resumen de tu reserva">
      <div className="os-img"><img src={a.photos?.[0]?.url} alt="" loading="lazy" decoding="async" onError={onImgError} /></div>
      <div className="os-body">
        <h2 style={{ fontSize: '1.08rem' }}>{a.name}</h2>
        <div className="os-row"><CalendarDays size={16} aria-hidden="true" /> <span>{fmtDateLong(fecha)}</span></div>
        <div className="os-row"><Clock size={16} aria-hidden="true" /> Salida {hora}</div>
        <div className="os-row"><Users size={16} aria-hidden="true" /> {adultos} adulto{adultos > 1 ? 's' : ''}{ninos ? `, ${ninos} niño${ninos > 1 ? 's' : ''}` : ''}</div>
        <div className="os-row"><MapPin size={16} aria-hidden="true" /> {a.meeting_point}</div>
        <Link to={back} className="small">Cambiar fecha u horario</Link>
        <div className="summary-lines">
          <div><span>{adultos} × Adulto</span><span>{fmtMoney(adultos * a.price.total)}</span></div>
          {ninos > 0 && <div><span>{ninos} × Niño</span><span>{fmtMoney(ninos * childPrice)}</span></div>}
        </div>
        <div className="summary-total"><span>Total a pagar</span><span className="price">{fmtMoney(total)}</span></div>
        <p className="small" style={{ color: a.free_cancellation && !ultimoMomento ? 'var(--success)' : 'var(--warning)', margin: 0, display: 'flex', gap: 6 }}>
          <ShieldCheck size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} /> {politica} Si pagas por transferencia o en sitio, puedes cancelar sin costo hasta 1 hora antes de la salida.
        </p>
      </div>
    </aside>
  );

  return (
    <div className="container" style={{ paddingTop: 24 }}>
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: a.name, to: back }, { label: 'Reserva' }]} />
      <div className="page-head" style={{ paddingTop: 14 }}>
        <Link to={back} className="btn btn-ghost btn-sm" style={{ marginLeft: -12 }}><ArrowLeft size={16} /> Volver a la experiencia</Link>
        <h1>Completa tu reserva</h1>
      </div>

      <ol className="steps" aria-label="Pasos de la reserva">
        <li className={step > 1 ? 'done' : 'current'} aria-current={step === 1 ? 'step' : undefined}><span>Tus datos</span></li>
        <li className={step === 2 ? 'current' : ''} aria-current={step === 2 ? 'step' : undefined}><span>Pago</span></li>
        <li><span>Confirmación</span></li>
      </ol>

      <div className="checkout">
        <div>
          {sinCupo && (
            <Alert tone="warning" title="Los cupos cambiaron">
              <p>Ahora quedan {slot.available} cupos a las {hora}. <Link to={back}>Elige otro horario o ajusta participantes</Link>.</p>
            </Alert>
          )}

          {!isAuth ? (
            <div className="card card-pad" style={{ marginTop: sinCupo ? 16 : 0 }}>
              <h2 style={{ fontSize: '1.2rem' }}>Inicia sesión para continuar</h2>
              <p className="muted small">Así guardamos tu reserva en tu cuenta y podrás gestionarla o cancelarla cuando quieras. Tu selección se mantiene.</p>
              <div className="tabs" role="group" aria-label="Cómo quieres continuar" style={{ marginBottom: 18 }}>
                <button type="button" className="tab" aria-pressed={authTab === 'login'} onClick={() => setAuthTab('login')}>Ya tengo cuenta</button>
                <button type="button" className="tab" aria-pressed={authTab === 'register'} onClick={() => setAuthTab('register')}>Soy nuevo</button>
              </div>
              {authTab === 'login' ? <LoginForm showDemo /> : <RegisterForm />}
            </div>
          ) : step === 1 ? (
            <form className="card card-pad" onSubmit={next} noValidate style={{ marginTop: sinCupo ? 16 : 0 }}>
        <RequiredLegend />
              <h2 style={{ fontSize: '1.2rem' }}>Datos del titular</h2>
              <p className="muted small">Presenta un documento con este nombre en el punto de encuentro.</p>
              <div className="form-grid">
                <Field label="Nombre completo" required error={errors.nombre} className="span-2">
                  {(p) => <input {...p} className="input" autoComplete="name" maxLength={LIMITES.nombrePersona} value={form.nombre} onChange={set('nombre')} />}
                </Field>
                <Field label="Correo electrónico" required error={errors.email} hint="Te enviaremos aquí el código de reserva">
                  {(p) => <input {...p} className="input" type="email" autoComplete="email" maxLength={LIMITES.correo} value={form.email} onChange={set('email')} />}
                </Field>
                <Field label="Teléfono / WhatsApp" required error={errors.telefono} hint="Celular 09XXXXXXXX (10 dígitos) o fijo 0[2-7]XXXXXXX (9 dígitos)">
                  {(p) => <input {...p} className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="0991234567" maxLength={LIMITES.telefono} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: soloDigitos(e.target.value) })} />}
                </Field>
                <Field label="Cédula" hint="Opcional. Cédula ecuatoriana de 10 dígitos, ej. 1710034065; agiliza el ingreso a parques nacionales" error={errors.documento}>
                  {(p) => <input {...p} className="input" inputMode="numeric" placeholder="1710034065" value={form.documento} onChange={(e) => setForm({ ...form, documento: soloDigitos(e.target.value) })} maxLength={LIMITES.documento} />}
                </Field>
                <Field label="Notas para el operador" hint="Alergias, movilidad reducida, hotel de recogida…" className="span-2">
                  {(p) => <textarea {...p} className="textarea" value={form.notas} onChange={set('notas')} maxLength={LIMITES.notas} style={{ minHeight: 80 }} />}
                </Field>
              </div>
              <div className="row-between" style={{ marginTop: 20 }}>
                <Link to={back} className="btn btn-ghost">Cancelar</Link>
                <button className="btn btn-primary btn-lg">Continuar al pago</button>
              </div>
            </form>
          ) : (
            <form className="card card-pad" onSubmit={submit} noValidate style={{ marginTop: sinCupo ? 16 : 0 }}>
        <RequiredLegend />
              <h2 style={{ fontSize: '1.2rem' }}>Método de pago</h2>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sr-only">Elige cómo pagar</legend>
                <div className="pay-options">
                  <label className="pay-option">
                    <input type="radio" name="metodo" checked={pay.metodo === 'TARJETA'} onChange={() => setPay({ ...pay, metodo: 'TARJETA' })} />
                    <div><strong>Tarjeta de crédito o débito</strong><span>Confirmación inmediata</span></div>
                    <CreditCard className="pay-icon" size={22} aria-hidden="true" />
                  </label>
                  <label className="pay-option">
                    <input type="radio" name="metodo" checked={pay.metodo === 'TRANSFERENCIA'} onChange={() => setPay({ ...pay, metodo: 'TRANSFERENCIA' })} />
                    <div><strong>Transferencia bancaria</strong><span>Tu reserva queda pendiente hasta verificar el pago (máx. 24 h)</span></div>
                    <Landmark className="pay-icon" size={22} aria-hidden="true" />
                  </label>
                  <label className="pay-option">
                    <input type="radio" name="metodo" checked={pay.metodo === 'EN_SITIO'} onChange={() => setPay({ ...pay, metodo: 'EN_SITIO' })} />
                    <div><strong>Pago en el punto de encuentro</strong><span>Efectivo el día del tour. Reserva pendiente de confirmación del operador</span></div>
                    <Banknote className="pay-icon" size={22} aria-hidden="true" />
                  </label>
                </div>
              </fieldset>

              {pay.metodo === 'TARJETA' && (
                <>
                  <div className="card-fields">
                    <Field label="Número de tarjeta" required error={errors.numero} className="span-2">
                      {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" placeholder="4111 1111 1111 1111" maxLength={23} value={pay.numero} onChange={setP('numero', fmtCard)} />}
                    </Field>
                    <Field label="Vencimiento" required error={errors.exp}>
                      {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" placeholder="MM/AA" maxLength={5} value={pay.exp} onChange={setP('exp', fmtExp)} />}
                    </Field>
                    <Field label="CVV" required error={errors.cvv}>
                      {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" placeholder="123" maxLength={4} value={pay.cvv} onChange={setP('cvv', (v) => v.replace(/\D/g, ''))} />}
                    </Field>
                    <Field label="Titular de la tarjeta" required error={errors.titular} className="span-2">
                      {(p) => <input {...p} className="input" autoComplete="off" maxLength={LIMITES.nombrePersona} value={pay.titular} onChange={setP('titular')} />}
                    </Field>
                  </div>
                  <p className="tiny muted" style={{ marginTop: 10 }}><Lock size={12} aria-hidden="true" /> Pago simulado para el prototipo: no se realizan cargos reales. Prueba con 4111 1111 1111 1111.</p>
                </>
              )}
              {pay.metodo === 'TRANSFERENCIA' && (
                <Alert tone="info" title="Datos para la transferencia">
                  <p>Banco Pichincha · Cuenta corriente 2201234567 · Descubre EC S.A. · RUC 1799999999001.<br />Envía el comprobante a pagos@descubre-ec.com con tu código de reserva.</p>
                </Alert>
              )}

              <div style={{ marginTop: 18 }}>
                <label className="check">
                  <input type="checkbox" checked={pay.terms} onChange={setP('terms')} aria-invalid={!!errors.terms} />
                  <span>
                    Acepto la política de cancelación ({politica.charAt(0).toLowerCase() + politica.slice(1, -1)}) y los términos del servicio.
                  </span>
                </label>
                {errors.terms && <span className="error-text" role="alert">{errors.terms}</span>}
              </div>

              {submitError && (
                <div style={{ marginTop: 16 }}>
                  <Alert tone="danger" title={submitError.status === 409 ? 'No pudimos reservar ese horario' : 'No se pudo completar la reserva'}>
                    <p>{submitError.message}</p>
                    {submitError.status === 409 && <p style={{ marginTop: 6 }}><Link to={back}>Elegir otro horario</Link></p>}
                  </Alert>
                </div>
              )}

              <div className="row-between" style={{ marginTop: 20 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={sending}><ArrowLeft size={16} /> Volver a tus datos</button>
                <button className="btn btn-cta btn-lg" disabled={sending || sinCupo}>
                  {sending ? <><Spinner /> Procesando…</> : pay.metodo === 'TARJETA' ? `Pagar ${fmtMoney(total)}` : 'Confirmar reserva'}
                </button>
              </div>
            </form>
          )}
        </div>
        {Summary}
      </div>
    </div>
  );
}
