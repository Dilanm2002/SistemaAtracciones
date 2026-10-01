import { NestExpressApplication } from '@nestjs/platform-express';
import { bearer, createTestApp, db, describeDb, http, login, nombreUnico, nuevaAtraccion, USERS } from './helpers';

/** RUC ecuatoriano válido y único: provincia 17, tercer dígito 9 (sociedad) y establecimiento 001. */
let rucSeq = Date.now() % 1_000_000;
const rucNuevo = () => `179${String(rucSeq++).padStart(7, '0')}001`;

/** Marketplace: una empresa solicita vender, el administrador aprueba y la empresa sube sus tours. */
describeDb('Empresas proveedoras (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let operador: string;
  let cityId: number;

  /** Crea una cuenta de cliente nueva y devuelve su token (toda solicitud exige cuenta). */
  const cuentaNueva = async () => {
    const email = `${nombreUnico('empresa').replace(/\s+/g, '.')}@correo.com`;
    const r = await http(app).post('/auth/register').send({ nombre: 'Rosa', apellido: 'Shiguango', email, password: 'Selva2026' });
    expect(r.status).toBe(201);
    return { email, token: r.body.access_token as string };
  };
  const solicitud = (extra: Record<string, unknown> = {}) => ({
    empresa: nombreUnico('Kawsay Tours'),
    ruc: rucNuevo(),
    provincia_id: 15,
    correo: 'reservas@kawsaytours.ec',
    telefono: '0991234567',
    direccion: 'Av. Quince de Noviembre, Tena',
    descripcion: 'Rafting en el río Jatunyacu y visitas a comunidades kichwa con guías locales.',
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp();
    [admin, operador] = await Promise.all([login(app, USERS.admin), login(app, USERS.operador)]);
    cityId = (await http(app).get('/destinos')).body[0].id;
  });
  afterAll(() => app?.close());

  it('sin cuenta no se puede solicitar (401)', async () => {
    expect((await http(app).post('/proveedores/solicitudes').send(solicitud())).status).toBe(401);
  });

  it('valida los datos de la empresa (RUC, teléfono ecuatoriano, descripción)', async () => {
    const { token } = await cuentaNueva();
    for (const malo of [{ ruc: '9992345678001' }, { telefono: '+14155550123' }, { descripcion: 'Tours' }, { empresa: '12345678' }]) {
      expect((await http(app).post('/proveedores/solicitudes').set(bearer(token)).send(solicitud(malo))).status).toBe(400);
    }
  });

  it('flujo completo: solicitar → aprobar → la persona pasa a OPERADOR y sube un tour en revisión', async () => {
    const { token } = await cuentaNueva();
    const datos = solicitud();
    const s = await http(app).post('/proveedores/solicitudes').set(bearer(token)).send(datos);
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ estado: 'PENDIENTE', empresa: datos.empresa, ruc: datos.ruc });
    // Una sola pendiente por persona
    expect((await http(app).post('/proveedores/solicitudes').set(bearer(token)).send(solicitud())).status).toBe(409);
    expect((await http(app).get('/proveedores/solicitudes/mia').set(bearer(token))).body.solicitud.estado).toBe('PENDIENTE');
    // Antes de aprobar sigue siendo cliente: no puede crear experiencias
    expect((await http(app).post('/atracciones').set(bearer(token)).send(nuevaAtraccion(cityId))).status).toBe(403);
    // Solo el administrador revisa
    expect((await http(app).post(`/proveedores/solicitudes/${s.body.id}/aprobar`).set(bearer(operador))).status).toBe(403);
    expect((await http(app).get('/proveedores/solicitudes?estado=PENDIENTE').set(bearer(admin))).body.rows.some((x: { id: string }) => x.id === s.body.id)).toBe(true);

    const ok = await http(app).post(`/proveedores/solicitudes/${s.body.id}/aprobar`).set(bearer(admin));
    expect(ok.status).toBe(200);
    expect(ok.body.estado).toBe('APROBADA');
    expect(ok.body.operador_codigo).toBeGreaterThan(100);
    expect((await http(app).post(`/proveedores/solicitudes/${s.body.id}/aprobar`).set(bearer(admin))).status).toBe(409);

    // El mismo token ya tiene el rol (los permisos se recalculan desde la base en cada petición)
    // Sin caché de sesión (V2-CON-01): el rol nuevo vale desde la siguiente petición
    const me = await http(app).get('/auth/me').set(bearer(token));
    expect(me.body.rol).toBe('OPERADOR');
    const tour = await http(app).post('/atracciones').set(bearer(token)).send(nuevaAtraccion(cityId, { operator: { id: ok.body.operador_codigo, name: datos.empresa } }));
    expect(tour.status).toBe(201);
    expect(tour.body).toMatchObject({ status: 'EN_REVISION', operator: { id: ok.body.operador_codigo } });
    // Su empresa existe con los datos de la solicitud
    const empresa = await db(app).query('SELECT ope_nombre, ope_ruc FROM operador WHERE ope_codigo = $1', [ok.body.operador_codigo]);
    expect(empresa[0]).toEqual({ ope_nombre: datos.empresa, ope_ruc: datos.ruc });
    // Ese RUC ya no puede volver a solicitarse
    const otra = await cuentaNueva();
    expect((await http(app).post('/proveedores/solicitudes').set(bearer(otra.token)).send(solicitud({ ruc: datos.ruc }))).status).toBe(409);
  });

  it('rechazo con motivo obligatorio; luego la persona puede volver a solicitar', async () => {
    const { token } = await cuentaNueva();
    const s = await http(app).post('/proveedores/solicitudes').set(bearer(token)).send(solicitud());
    expect((await http(app).post(`/proveedores/solicitudes/${s.body.id}/rechazar`).set(bearer(admin)).send({})).status).toBe(400);
    const no = await http(app).post(`/proveedores/solicitudes/${s.body.id}/rechazar`).set(bearer(admin)).send({ motivo: 'Adjunta el registro de turismo del Ministerio.' });
    expect(no.body).toMatchObject({ estado: 'RECHAZADA', motivo_rechazo: 'Adjunta el registro de turismo del Ministerio.' });
    expect((await http(app).get('/proveedores/solicitudes/mia').set(bearer(token))).body.solicitud.motivo_rechazo).toContain('Ministerio');
    expect((await http(app).post('/proveedores/solicitudes').set(bearer(token)).send(solicitud())).status).toBe(201);
  });

  it('quien ya es operador o administrador no puede solicitar', async () => {
    expect((await http(app).post('/proveedores/solicitudes').set(bearer(operador)).send(solicitud())).status).toBe(409);
    expect((await http(app).post('/proveedores/solicitudes').set(bearer(admin)).send(solicitud())).status).toBe(409);
  });
});
