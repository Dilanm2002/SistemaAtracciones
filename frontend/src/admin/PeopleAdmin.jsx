import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, EyeOff, Mail, MailOpen, MessageSquareText, Plus, Reply, Search, Star, Trash2, UserCog, Users } from 'lucide-react';
import { Mensajes, Operadores, Reportes, Resenas, Usuarios } from '../api/client';
import { Alert, EmptyState, ErrorState, Field, Modal, RequiredLegend, Spinner, Stars, Switch, useAsync, useConfirm, useDebounce } from '../components/ui';
import { ROL_LABEL, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDateTime, fmtMoney, fmtRelative, initials } from '../utils/format';
import { correo, LIMITES, limpiar, nombrePersona, password, soloDigitos, soloNombre, telefono } from '../utils/validation';
import { useAdmin } from './AdminLayout';
import { exportXlsx } from './excel';

// ── Clientes ─────────────────────────────────────────────────────────────
export function ClientesAdmin() {
  const { data, loading, error, reload } = useAsync(() => Reportes.clientes(), []);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 200).toLowerCase();
  const rows = useMemo(() => (data ?? []).filter((c) => !dq || c.name?.toLowerCase().includes(dq) || c.email?.toLowerCase().includes(dq)), [data, dq]);

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Clientes</h2><p>Viajeros con reservas, ordenados por monto gastado.</p></div>
        <button className="btn" disabled={!rows.length} onClick={() => exportXlsx('clientes.xlsx', [{ name: 'Clientes', rows: rows.map((c) => ({ Nombre: c.name, Email: c.email, Teléfono: c.phone, Reservas: c.reservations, 'Total gastado USD': c.total_spent, 'Última reserva': new Date(c.last_reservation_at).toLocaleDateString('es-EC') })) }])}>
          <Download size={16} /> Exportar Excel
        </button>
      </div>
      <div className="adm-toolbar">
        <div className="input-icon"><Search size={18} aria-hidden="true" /><input className="input" type="search" maxLength={LIMITES.busqueda} placeholder="Nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" data-shortcut-search /></div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : rows.length === 0 ? <EmptyState icon={Users} title="Sin clientes que coincidan" /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Clientes y su historial de compras</caption>
            <thead><tr><th scope="col">Cliente</th><th scope="col">Contacto</th><th scope="col" className="num">Reservas</th><th scope="col" className="num">Total gastado</th><th scope="col">Última reserva</th><th scope="col" className="num">Acciones</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.user_id}>
                  <td><div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}><span className="avatar" style={{ width: 32, height: 32, fontSize: '0.8rem' }}>{initials(c.name)}</span><strong>{c.name}</strong></div></td>
                  <td className="small">{c.email}<br /><span className="muted">{c.phone ?? '—'}</span></td>
                  <td className="num">{c.reservations}</td>
                  <td className="num"><strong>{fmtMoney(c.total_spent)}</strong></td>
                  <td className="small">{fmtRelative(c.last_reservation_at)}</td>
                  <td><div className="actions"><Link className="btn btn-sm" to={`/admin/reservas`} state={{ q: c.email }}>Ver reservas</Link></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Usuarios y roles ─────────────────────────────────────────────────────
function UsuarioModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(
    item
      ? { nombre: item.nombres ?? item.nombre, apellido: item.apellidos ?? '', email: item.email, telefono: item.telefono ?? '', rol: item.rol, password: '', operadorCodigo: item.operadorCodigo ?? '' }
      : { nombre: '', apellido: '', email: '', telefono: '', rol: 'OPERADOR', password: '', operadorCodigo: '' },
  );
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  // Un OPERADOR pertenece a una empresa: solo ve y gestiona las reservas de sus atracciones
  const [operadores, setOperadores] = useState([]);
  useEffect(() => { Operadores.list(true).then(setOperadores).catch(() => setOperadores([])); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const errs = limpiar({
      nombre: nombrePersona(f.nombre, { que: 'Los nombres' }),
      apellido: nombrePersona(f.apellido, { que: 'Los apellidos' }),
      email: correo(f.email),
      password: !item || f.password ? password(f.password) : null,
      telefono: telefono(f.telefono),
      operadorCodigo: f.rol === 'OPERADOR' && !f.operadorCodigo ? 'Elige la empresa operadora' : null,
    });
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = {
      nombre: f.nombre.trim(),
      apellido: f.apellido.trim(),
      email: f.email.trim().toLowerCase(),
      rol: f.rol,
      operadorCodigo: f.rol === 'OPERADOR' ? Number(f.operadorCodigo) : null,
      // Al editar se envía siempre: vacío quita el teléfono. Al crear, solo si se llenó
      ...(item || f.telefono ? { telefono: f.telefono } : {}),
      ...(f.password ? { password: f.password } : {}),
    };
    try {
      const u = item ? await Usuarios.update(item.id, body) : await Usuarios.create(body);
      toast(item ? 'Usuario actualizado' : `Usuario ${u.email} creado`, 'success');
      onSaved(u);
    } catch (e2) { setErr({ ...e2.fieldErrors, api: e2.message }); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar usuario' : 'Nuevo usuario'} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="usr-form" disabled={saving}>{saving && <Spinner />} Guardar</button></>}>
      <form id="usr-form" onSubmit={save} className="stack" noValidate>
        <RequiredLegend />
        {err.api && <Alert tone="danger">{err.api}</Alert>}
        <div className="form-grid">
          <Field label="Nombres" required error={err.nombre}>{(p) => <input {...p} className="input" maxLength={LIMITES.nombrePersona} value={f.nombre} onChange={(e) => setF({ ...f, nombre: soloNombre(e.target.value) })} />}</Field>
          <Field label="Apellidos" required error={err.apellido}>{(p) => <input {...p} className="input" maxLength={LIMITES.nombrePersona} value={f.apellido} onChange={(e) => setF({ ...f, apellido: soloNombre(e.target.value) })} />}</Field>
        </div>
        <Field label="Correo" required error={err.email}>{(p) => <input {...p} className="input" type="email" maxLength={LIMITES.correo} value={f.email} onChange={set('email')} />}</Field>
        <Field label="Teléfono" error={err.telefono} hint="Celular 09XXXXXXXX (10 dígitos) o fijo 0[2-7]XXXXXXX (9 dígitos)">{(p) => <input {...p} className="input" type="tel" inputMode="numeric" placeholder="0991234567" maxLength={LIMITES.telefono} value={f.telefono} onChange={(e) => setF({ ...f, telefono: soloDigitos(e.target.value) })} />}</Field>
        <Field label="Rol" required hint={f.rol === 'ADMIN' ? 'Acceso total al panel' : f.rol === 'OPERADOR' ? 'Solo Dashboard, Reservas y Disponibilidad' : 'Solo puede reservar en el sitio'}>
          {(p) => <select {...p} className="select" value={f.rol} onChange={set('rol')}>{Object.entries(ROL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        </Field>
        {f.rol === 'OPERADOR' && (
          <Field label="Empresa operadora" required error={err.operadorCodigo} hint="Solo verá y gestionará las reservas de las atracciones de esta empresa">
            {(p) => (
              <select {...p} className="select" value={f.operadorCodigo} onChange={set('operadorCodigo')}>
                <option value="">Selecciona…</option>
                {operadores.map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre} (código {o.codigo})</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label={item ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} required={!item} error={err.password} hint="Compártela de forma segura; el usuario podrá cambiarla">
          {(p) => <input {...p} className="input" type="text" autoComplete="new-password" maxLength={LIMITES.password} value={f.password} onChange={set('password')} />}
        </Field>
      </form>
    </Modal>
  );
}

export function UsuariosAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [rol, setRol] = useState('');
  const { data, loading, error, reload, setData } = useAsync(() => Usuarios.list(rol ? { rol } : {}), [rol]);
  const [editing, setEditing] = useState(null);

  const toggleActive = async (u) => {
    if (u.activo && !(await confirm({ title: 'Desactivar usuario', message: <><strong>{u.nombre}</strong> no podrá iniciar sesión hasta que lo reactives.</>, confirmText: 'Desactivar', danger: true }))) return;
    try {
      const r = await Usuarios.update(u.id, { activo: !u.activo });
      setData((d) => d.map((x) => (x.id === u.id ? r : x)));
      toast(r.activo ? 'Usuario reactivado' : 'Usuario desactivado', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Usuarios y roles</h2><p>Los roles determinan los scopes OAuth2 del token (attractions:read / book / write…).</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> Nuevo usuario</button>
      </div>
      <div className="adm-toolbar">
        <div className="segmented" role="group" aria-label="Filtrar por rol">
          {[['', 'Todos'], ['ADMIN', 'Administradores'], ['OPERADOR', 'Operadores'], ['CLIENTE', 'Viajeros']].map(([k, l]) => <button key={k} aria-pressed={rol === k} onClick={() => setRol(k)}>{l}</button>)}
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.length === 0 ? <EmptyState icon={UserCog} title="Sin usuarios" /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Usuarios del sistema</caption>
            <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Último acceso</th><th scope="col">Activo</th><th scope="col" className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.nombre}</strong>{u.id === user.sub || u.email === user.email ? <span className="badge" style={{ marginLeft: 6 }}>Tú</span> : null}<div className="muted tiny">{u.email}</div></td>
                  <td><span className={`badge ${u.rol === 'ADMIN' ? 'badge-cta' : u.rol === 'OPERADOR' ? 'badge-info' : ''}`}>{ROL_LABEL[u.rol]}</span></td>
                  <td className="small">{u.ultimoAcceso ? fmtDateTime(u.ultimoAcceso) : 'Nunca'}</td>
                  <td><Switch checked={u.activo} onChange={() => toggleActive(u)} disabled={u.email === user.email} ariaLabel={`Usuario ${u.nombre} activo`} /></td>
                  <td><div className="actions"><button className="btn btn-sm" onClick={() => setEditing(u)}>Editar</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UsuarioModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

// ── Reseñas (moderación) ─────────────────────────────────────────────────
export function ResenasAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState('all');
  const [rating, setRating] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload, setData } = useAsync(() => Resenas.list({ status, page, limit: 12, ...(rating ? { rating } : {}) }), [status, rating, page]);

  const moderate = async (r) => {
    try {
      const u = await Resenas.moderate(r.id, !r.visible);
      setData((d) => ({ ...d, data: d.data.map((x) => (x.id === r.id ? u : x)) }));
      toast(u.visible ? 'Reseña visible de nuevo' : 'Reseña ocultada: ya no cuenta en la calificación', 'success', { action: { label: 'Deshacer', onClick: () => moderate(u) } });
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (r) => {
    if (!(await confirm({ title: 'Eliminar reseña', message: 'Se eliminará definitivamente. Si solo es inapropiada, considera ocultarla.', confirmText: 'Eliminar', danger: true }))) return;
    try { await Resenas.remove(r.id); reload(); toast('Reseña eliminada', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="adm-module-head"><div><h2>Reseñas</h2><p>Oculta opiniones inapropiadas; las ocultas no afectan la calificación.</p></div></div>
      <div className="adm-toolbar">
        <div className="segmented" role="group" aria-label="Estado">
          {[['all', 'Todas'], ['visible', 'Visibles'], ['hidden', 'Ocultas']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>)}
        </div>
        <select className="select" value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }} aria-label="Estrellas">
          <option value="">Todas las estrellas</option>
          {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s} estrellas</option>)}
        </select>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.data.length === 0 ? <EmptyState icon={Star} title="Sin reseñas con estos filtros" /> : (
        <>
          <div className="card">
            {data.data.map((r) => (
              <div key={r.id} className={`msg ${r.visible ? '' : 'msg-hidden'}`}>
                <div className="msg-head">
                  <Stars value={r.rating} size={15} />
                  <strong>{r.author}</strong>
                  <span className="muted small">sobre <Link to={`/atraccion/${r.attraction?.id}`} target="_blank" rel="noopener noreferrer">{r.attraction?.name}</Link></span>
                  <span className="muted tiny" style={{ marginLeft: 'auto' }}>{fmtRelative(r.created_at)}</span>
                  {!r.visible && <span className="badge badge-warning"><EyeOff size={12} aria-hidden="true" /> Oculta</span>}
                </div>
                <p className="msg-body">{r.comment}</p>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => moderate(r)}>{r.visible ? <><EyeOff size={15} /> Ocultar</> : <><Eye size={15} /> Mostrar</>}</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => remove(r)}><Trash2 size={15} /> Eliminar</button>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="small muted">Página {data.meta.currentPage} de {data.meta.totalPages}</span>
            <button className="btn btn-sm" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
        </>
      )}
    </>
  );
}

// ── Mensajes de contacto ─────────────────────────────────────────────────
const ASUNTO = { RESERVA: ['Reserva', 'badge-info'], CANCELACION: ['Cancelación', 'badge-warning'], PROVEEDOR: ['Proveedor', 'badge-primary'], SUGERENCIA: ['Sugerencia', 'badge-success'], OTRO: ['Otro', ''] };

export function MensajesAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshCounts } = useAdmin();
  const [status, setStatus] = useState('all');
  const { data, loading, error, reload, setData } = useAsync(() => Mensajes.list(status), [status]);
  const [open, setOpen] = useState(null);

  const mark = async (m, leido) => {
    try {
      const u = await Mensajes.mark(m.id, leido);
      setData((d) => d.map((x) => (x.id === m.id ? u : x)));
      refreshCounts();
    } catch (e) { toast(e.message, 'error'); }
  };
  const expand = (m) => {
    setOpen(open === m.id ? null : m.id);
    if (!m.leido) mark(m, true);
  };
  const remove = async (m) => {
    if (!(await confirm({ title: 'Eliminar mensaje', message: `¿Eliminar el mensaje de ${m.nombre}?`, confirmText: 'Eliminar', danger: true }))) return;
    try { await Mensajes.remove(m.id); setData((d) => d.filter((x) => x.id !== m.id)); refreshCounts(); toast('Mensaje eliminado', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="adm-module-head"><div><h2>Mensajes de contacto</h2><p>Consultas enviadas desde el formulario del sitio.</p></div></div>
      <div className="adm-toolbar">
        <div className="segmented" role="group" aria-label="Estado">
          {[['all', 'Todos'], ['unread', 'Sin leer'], ['read', 'Leídos']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.length === 0 ? <EmptyState icon={MessageSquareText} title="Bandeja vacía">No hay mensajes {status === 'unread' ? 'sin leer' : ''}.</EmptyState> : (
        <div className="card">
          {data.map((m) => (
            <div key={m.id} className={`msg ${m.leido ? '' : 'unread'}`}>
              <button className="msg-head" onClick={() => expand(m)} aria-expanded={open === m.id} style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left' }}>
                {m.leido ? <MailOpen size={18} color="var(--muted)" aria-hidden="true" /> : <Mail size={18} color="var(--cta-hover)" aria-hidden="true" />}
                <strong>{m.nombre}</strong>
                <span className={`badge ${ASUNTO[m.asunto]?.[1]}`}>{ASUNTO[m.asunto]?.[0]}</span>
                <span className="muted small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{open === m.id ? '' : m.mensaje}</span>
                <span className="muted tiny">{fmtRelative(m.createdAt)}</span>
                {!m.leido && <span className="sr-only">(sin leer)</span>}
              </button>
              {open === m.id && (
                <>
                  <p className="msg-body">{m.mensaje}</p>
                  <div className="row" style={{ gap: 8 }}>
                    <a className="btn btn-sm btn-primary" href={`mailto:${m.email}?subject=${encodeURIComponent('Re: tu consulta en Descubre EC')}`}><Reply size={15} /> Responder a {m.email}</a>
                    <button className="btn btn-sm" onClick={() => mark(m, false)}><Mail size={15} /> Marcar como no leído</button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => remove(m)}><Trash2 size={15} /> Eliminar</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
