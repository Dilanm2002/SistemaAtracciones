import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { SessionService } from '../../common/auth/session.service';
import { AuthUser, Rol, rolPrincipal, scopesDe } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { CatalogosService } from '../../common/db/catalogos.service';
import { DbService, Params, Sql } from '../../common/db/db.service';
import { escapeLike } from '../../common/utils/sql';
import { RE_NOMBRE_PERSONA } from '../../common/utils/validators';
import { CambiarPasswordDto, CreateUsuarioDto, LoginDto, RegisterDto, UpdatePerfilDto, UpdateUsuarioDto, UsuariosQueryDto } from './dto/auth.dto';

/** Vista pública de un usuario: lista explícita de columnas, nunca el hash (SEG-024). */
export interface UsuarioPublico {
  id: string;
  nombre: string;
  nombres: string;
  apellidos: string;
  email: string;
  telefono: string | null;
  documento: string | null;
  rol: Rol;
  roles: Rol[];
  operadorCodigo: number | null;
  activo: boolean;
  ultimoAcceso: Date | null;
  createdAt: Date;
  scope: string[];
}

interface FilaUsuario {
  id: string;
  nombres: string;
  apellidos: string;
  email: string;
  telefono: string | null;
  documento: string | null;
  activo: boolean;
  ultimoAcceso: Date | null;
  createdAt: Date;
  roles: Rol[];
  operadorCodigo: number | null;
}

const SELECT_USUARIO = `
  SELECT u.usu_id::text AS id, u.usu_nombre AS nombres, u.usu_apellido AS apellidos, u.usu_correo AS email,
         u.usu_telefono AS telefono, u.usu_documento AS documento, u.usu_activo AS activo,
         u.usu_ultimo_acceso AS "ultimoAcceso", u.usu_creado_en AS "createdAt",
         COALESCE((SELECT array_agg(r.rol_nombre ORDER BY r.rol_id) FROM usuario_rol ur JOIN rol r ON r.rol_id = ur.rol_id
                    WHERE ur.usu_id = u.usu_id AND r.rol_activo), '{}') AS roles,
         (SELECT o.ope_codigo FROM operador_usuario ou JOIN operador o ON o.ope_id = ou.ope_id
           WHERE ou.usu_id = u.usu_id AND ou.opeu_activo ORDER BY o.ope_codigo LIMIT 1) AS "operadorCodigo"
    FROM usuario u`;

const BCRYPT_ROUNDS = 10;

/** Lo que devuelve Supabase Auth en GET /auth/v1/user (solo los campos que se usan). */
interface CuentaSupabase {
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: { full_name?: string; name?: string; given_name?: string; family_name?: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly catalogos: CatalogosService,
    private readonly bitacora: BitacoraService,
    private readonly config: ConfigService,
  ) {}

  toPublic(u: FilaUsuario): UsuarioPublico {
    const roles = u.roles ?? [];
    return {
      id: u.id,
      nombre: `${u.nombres} ${u.apellidos}`.trim(),
      nombres: u.nombres,
      apellidos: u.apellidos,
      email: u.email,
      telefono: u.telefono,
      documento: u.documento,
      rol: rolPrincipal(roles),
      roles,
      operadorCodigo: u.operadorCodigo,
      activo: u.activo,
      ultimoAcceso: u.ultimoAcceso,
      createdAt: u.createdAt,
      scope: scopesDe(roles),
    };
  }

  private async fila(id: string, sql: Sql = this.db): Promise<FilaUsuario | null> {
    return sql.one<FilaUsuario>(`${SELECT_USUARIO} WHERE u.usu_id = $1`, [id]);
  }

  private async emitirToken(u: FilaUsuario, ctx: { ip?: string; userAgent?: string; jkt?: string }) {
    const pub = this.toPublic(u);
    const jti = randomUUID();
    const payload: AuthUser = {
      sub: u.id,
      email: u.email,
      nombre: pub.nombre,
      rol: pub.rol,
      scope: scopesDe(pub.roles),
      operador: u.operadorCodigo,
      jti,
      // WEB-008: ligado a la llave del navegador si el login trajo prueba DPoP
      ...(ctx.jkt ? { cnf: { jkt: ctx.jkt } } : {}),
    };
    const token = await this.jwt.signAsync(payload);
    const { exp } = this.jwt.decode(token) as { exp: number };
    await this.sessions.crear(jti, u.id, token, new Date(exp * 1000), ctx.ip, ctx.userAgent);
    return { access_token: token, token_type: ctx.jkt ? 'DPoP' : 'Bearer', expires_at: new Date(exp * 1000).toISOString(), scope: payload.scope.join(' '), user: pub };
  }

  private async correoLibre(email: string, excepto?: string, sql: Sql = this.db) {
    const r = await sql.one('SELECT 1 FROM usuario WHERE lower(usu_correo) = lower($1) AND usu_id IS DISTINCT FROM $2', [email, excepto ?? null]);
    return !r;
  }

  /** Reemplaza los roles del usuario por uno solo y ajusta su empresa operadora. */
  private async asignarRol(sql: Sql, usuId: string, rol: Rol, operadorCodigo: number | null | undefined, actorId: string | null) {
    await sql.query('DELETE FROM usuario_rol WHERE usu_id = $1', [usuId]);
    await sql.query('INSERT INTO usuario_rol (usu_id, rol_id, usr_asignado_por) VALUES ($1, $2, $3)', [usuId, await this.catalogos.rol(rol), actorId]);
    if (rol !== Rol.OPERADOR) {
      await sql.query('DELETE FROM operador_usuario WHERE usu_id = $1', [usuId]);
      return;
    }
    if (operadorCodigo == null) {
      const actual = await sql.one('SELECT 1 FROM operador_usuario WHERE usu_id = $1', [usuId]);
      if (!actual) throw new BadRequestException('Un usuario OPERADOR debe pertenecer a una empresa operadora (operadorCodigo).');
      return;
    }
    const op = await sql.one<{ ope_id: string }>('SELECT ope_id FROM operador WHERE ope_codigo = $1', [operadorCodigo]);
    if (!op) throw new BadRequestException(`La empresa operadora ${operadorCodigo} no existe.`);
    await sql.query('DELETE FROM operador_usuario WHERE usu_id = $1', [usuId]);
    await sql.query(`INSERT INTO operador_usuario (ope_id, usu_id, opeu_cargo) VALUES ($1, $2, 'OPERACIONES')`, [op.ope_id, usuId]);
  }

  // ── Cuenta propia ─────────────────────────────────────────────────────
  async register(dto: RegisterDto, ctx: { ip?: string; userAgent?: string; jkt?: string }) {
    await this.catalogos.precargar();
    const id = await this.db.tx(async (tx) => {
      if (!(await this.correoLibre(dto.email, undefined, tx))) {
        throw new ConflictException('Ya existe una cuenta con ese correo. ¿Quieres iniciar sesión?');
      }
      const u = await tx.one<{ id: string }>(
        `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_telefono)
         VALUES ($1, $2, $3, $4, $5) RETURNING usu_id::text AS id`,
        [dto.email, await bcrypt.hash(dto.password, BCRYPT_ROUNDS), dto.nombre, dto.apellido, dto.telefono ?? null],
      );
      await this.asignarRol(tx, u!.id, Rol.CLIENTE, null, null);
      return u!.id;
    });
    await this.bitacora.registrar(id, 'REGISTRO', 'usuario', id);
    return this.emitirToken((await this.fila(id))!, ctx);
  }

  async login(dto: LoginDto, ctx: { ip?: string; userAgent?: string; jkt?: string }) {
    const cred = await this.db.one<{ id: string; hash: string; activo: boolean }>(
      'SELECT usu_id::text AS id, usu_password AS hash, usu_activo AS activo FROM usuario WHERE lower(usu_correo) = lower($1)',
      [dto.email],
    );
    // Mismo mensaje si el correo no existe o la contraseña es incorrecta (no se enumeran cuentas)
    if (!cred || !(await bcrypt.compare(dto.password, cred.hash))) throw new UnauthorizedException('Correo o contraseña incorrectos.');
    if (!cred.activo) throw new ForbiddenException('Tu cuenta está desactivada. Contacta al administrador.');
    await this.db.query('UPDATE usuario SET usu_ultimo_acceso = now() WHERE usu_id = $1', [cred.id]);
    return this.emitirToken((await this.fila(cred.id))!, ctx);
  }

  /**
   * Inicio de sesión con Google (como en Sal y Canela): Supabase Auth hace el OAuth con Google y
   * devuelve un access_token al navegador. Aquí ese token se valida CONTRA Supabase (no se confía en
   * lo que diga el cliente), se busca o crea el usuario CLIENTE con ese correo y se emite la sesión
   * propia del sistema (ligada con DPoP si el navegador envió la prueba). Google ya verificó el correo.
   */
  /** ¿Está activado Google en Supabase Auth? El botón lo consulta antes de salir del sitio. */
  async googleHabilitado(): Promise<{ habilitado: boolean }> {
    const url = this.config.get<string>('SUPABASE_URL')?.replace(/\/$/, '');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return { habilitado: false };
    const ajustes = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ external?: { google?: boolean } }>) : null))
      .catch(() => null);
    return { habilitado: ajustes?.external?.google === true };
  }

  async loginGoogle(accessToken: string, ctx: { ip?: string; userAgent?: string; jkt?: string }) {
    const url = this.config.get<string>('SUPABASE_URL')?.replace(/\/$/, '');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new BadRequestException('El inicio de sesión con Google no está configurado.');
    const cab = { apikey: key, Authorization: `Bearer ${accessToken}` };
    const g = await fetch(`${url}/auth/v1/user`, { headers: cab, signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<CuentaSupabase>) : null))
      .catch(() => null);
    const proveedores = g?.app_metadata?.providers ?? [g?.app_metadata?.provider];
    const email = g?.email?.trim().toLowerCase();
    if (!g || !email || !g.email_confirmed_at || !proveedores.includes('google')) {
      throw new UnauthorizedException('No se pudo validar tu cuenta de Google. Intenta de nuevo.');
    }
    // La sesión de Supabase ya no hace falta: el sistema usa su propio token
    void fetch(`${url}/auth/v1/logout`, { method: 'POST', headers: cab, signal: AbortSignal.timeout(5000) }).catch(() => undefined);

    const existente = await this.db.one<{ id: string; activo: boolean }>(
      'SELECT usu_id::text AS id, usu_activo AS activo FROM usuario WHERE lower(usu_correo) = $1',
      [email],
    );
    let id: string;
    if (existente) {
      if (!existente.activo) throw new ForbiddenException('Tu cuenta está desactivada. Contacta al administrador.');
      await this.db.query('UPDATE usuario SET usu_ultimo_acceso = now(), usu_verificado = TRUE WHERE usu_id = $1', [existente.id]);
      id = existente.id;
    } else {
      await this.catalogos.precargar();
      const m = g.user_metadata ?? {};
      const limpio = (v?: string) => (v ?? '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const valido = (v: string, porDefecto: string) => (RE_NOMBRE_PERSONA.test(v) ? v : porDefecto);
      const partes = limpio(m.full_name ?? m.name).split(' ');
      const nombre = valido(limpio(m.given_name) || partes[0], 'Cliente');
      const apellido = valido(limpio(m.family_name) || partes.slice(1).join(' '), 'Google');
      // Contraseña aleatoria que nadie conoce: la cuenta entra con Google
      const hash = await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);
      id = await this.db.tx(async (tx) => {
        const u = await tx.one<{ id: string }>(
          `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_verificado)
           VALUES ($1, $2, $3, $4, TRUE) RETURNING usu_id::text AS id`,
          [email, hash, nombre, apellido],
        );
        await this.asignarRol(tx, u!.id, Rol.CLIENTE, null, null);
        return u!.id;
      });
      await this.bitacora.registrar(id, 'REGISTRO_GOOGLE', 'usuario', id);
    }
    return this.emitirToken((await this.fila(id))!, ctx);
  }

  async logout(user: AuthUser) {
    if (user.jti) await this.sessions.revocar(user.jti);
  }

  async me(id: string) {
    const u = await this.fila(id);
    if (!u || !u.activo) throw new UnauthorizedException('Tu sesión ya no es válida.');
    return this.toPublic(u);
  }

  async updatePerfil(id: string, dto: UpdatePerfilDto) {
    const p = new Params();
    const sets: string[] = [];
    if (dto.nombre !== undefined) sets.push(`usu_nombre = ${p.add(dto.nombre)}`);
    if (dto.apellido !== undefined) sets.push(`usu_apellido = ${p.add(dto.apellido)}`);
    if (dto.telefono !== undefined) sets.push(`usu_telefono = ${p.add(dto.telefono || null)}`);
    if (dto.documento !== undefined) {
      if (dto.documento && (await this.db.one('SELECT 1 FROM usuario WHERE usu_documento = $1 AND usu_id <> $2', [dto.documento, id]))) {
        throw new ConflictException('Ese documento ya está registrado en otra cuenta.');
      }
      sets.push(`usu_documento = ${p.add(dto.documento || null)}`);
    }
    if (sets.length) await this.db.query(`UPDATE usuario SET ${sets.join(', ')} WHERE usu_id = ${p.add(id)}`, p.values);
    return this.me(id);
  }

  async cambiarPassword(user: AuthUser, dto: CambiarPasswordDto) {
    const r = await this.db.one<{ hash: string }>('SELECT usu_password AS hash FROM usuario WHERE usu_id = $1', [user.sub]);
    if (!r || !(await bcrypt.compare(dto.actual, r.hash))) throw new BadRequestException('La contraseña actual no es correcta.');
    await this.db.query('UPDATE usuario SET usu_password = $1 WHERE usu_id = $2', [await bcrypt.hash(dto.nueva, BCRYPT_ROUNDS), user.sub]);
    // Cierra las demás sesiones abiertas con la contraseña anterior
    await this.sessions.revocarTodas(user.sub, user.jti);
    await this.bitacora.registrar(user.sub, 'CAMBIO_PASSWORD', 'usuario', user.sub);
  }

  // ── Administración de usuarios ──────────────────────────────────────────
  async list(query: UsuariosQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const p = new Params();
    const where: string[] = [];
    if (query.rol) {
      where.push(`EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.rol_id = ur.rol_id WHERE ur.usu_id = u.usu_id AND r.rol_nombre = ${p.add(query.rol)})`);
    }
    if (query.q?.trim()) {
      const t = p.add(`%${escapeLike(query.q.trim())}%`);
      where.push(`(u.usu_nombre ILIKE ${t} ESCAPE '\\' OR u.usu_apellido ILIKE ${t} ESCAPE '\\' OR u.usu_correo ILIKE ${t} ESCAPE '\\')`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM usuario u ${w}`, p.values);
    const rows = await this.db.query<FilaUsuario>(
      `${SELECT_USUARIO} ${w} ORDER BY u.usu_creado_en DESC LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    return { rows: rows.map((u) => this.toPublic(u)), total };
  }

  async create(dto: CreateUsuarioDto, actorId: string) {
    await this.catalogos.precargar();
    const id = await this.db.tx(async (tx) => {
      if (!(await this.correoLibre(dto.email, undefined, tx))) throw new ConflictException('Ya existe un usuario con ese correo.');
      const u = await tx.one<{ id: string }>(
        `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_telefono, usu_verificado)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING usu_id::text AS id`,
        [dto.email, await bcrypt.hash(dto.password, BCRYPT_ROUNDS), dto.nombre, dto.apellido, dto.telefono ?? null],
      );
      await this.asignarRol(tx, u!.id, dto.rol, dto.operadorCodigo, actorId);
      return u!.id;
    });
    await this.bitacora.registrar(actorId, 'CREAR', 'usuario', id, { rol: dto.rol, operador: dto.operadorCodigo ?? null });
    return this.toPublic((await this.fila(id))!);
  }

  private async otrosAdminsActivos(id: string, sql: Sql) {
    const r = await sql.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM usuario u JOIN usuario_rol ur ON ur.usu_id = u.usu_id JOIN rol r ON r.rol_id = ur.rol_id
        WHERE r.rol_nombre = 'ADMIN' AND u.usu_activo AND u.usu_id <> $1`,
      [id],
    );
    return r?.n ?? 0;
  }

  async update(id: string, dto: UpdateUsuarioDto, actorId: string) {
    if (id === actorId && (dto.activo === false || (dto.rol && dto.rol !== Rol.ADMIN))) {
      throw new BadRequestException('No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
    }
    await this.catalogos.precargar();
    await this.db.tx(async (tx) => {
      // Bloquea la fila para serializar cambios concurrentes sobre el mismo usuario
      const actual = await tx.one<{ activo: boolean }>('SELECT usu_activo AS activo FROM usuario WHERE usu_id = $1 FOR UPDATE', [id]);
      if (!actual) throw new NotFoundException('Usuario no encontrado.');
      const u = (await this.fila(id, tx))!;
      const esAdminHoy = u.roles.includes(Rol.ADMIN) && u.activo;
      const pierdeAdmin = esAdminHoy && (dto.activo === false || (dto.rol !== undefined && dto.rol !== Rol.ADMIN));
      if (pierdeAdmin && (await this.otrosAdminsActivos(id, tx)) === 0) {
        throw new ConflictException('Debe quedar al menos un administrador activo en el sistema.');
      }

      const p = new Params();
      const sets: string[] = [];
      if (dto.email !== undefined && dto.email.toLowerCase() !== u.email.toLowerCase()) {
        if (!(await this.correoLibre(dto.email, id, tx))) throw new ConflictException('Ya existe otro usuario con ese correo.');
        sets.push(`usu_correo = ${p.add(dto.email)}`);
      }
      if (dto.nombre !== undefined) sets.push(`usu_nombre = ${p.add(dto.nombre)}`);
      if (dto.apellido !== undefined) sets.push(`usu_apellido = ${p.add(dto.apellido)}`);
      if (dto.telefono !== undefined) sets.push(`usu_telefono = ${p.add(dto.telefono || null)}`);
      if (dto.activo !== undefined) sets.push(`usu_activo = ${p.add(dto.activo)}`);
      if (dto.password) sets.push(`usu_password = ${p.add(await bcrypt.hash(dto.password, BCRYPT_ROUNDS))}`);
      if (sets.length) await tx.query(`UPDATE usuario SET ${sets.join(', ')} WHERE usu_id = ${p.add(id)}`, p.values);

      const rolFinal = dto.rol ?? rolPrincipal(u.roles);
      if (dto.rol !== undefined || dto.operadorCodigo !== undefined) {
        await this.asignarRol(tx, id, rolFinal, dto.operadorCodigo ?? u.operadorCodigo, actorId);
      }
    });

    // Desactivar o cambiar la contraseña cierra sus sesiones; el cambio de rol aplica de inmediato
    if (dto.activo === false || dto.password) await this.sessions.revocarTodas(id);
    this.sessions.invalidar(id);
    const cambios = Object.fromEntries(Object.entries(dto).filter(([k]) => k !== 'password'));
    await this.bitacora.registrar(actorId, 'ACTUALIZAR', 'usuario', id, { ...cambios, ...(dto.password ? { password: '(cambiada)' } : {}) });
    return this.toPublic((await this.fila(id))!);
  }
}
