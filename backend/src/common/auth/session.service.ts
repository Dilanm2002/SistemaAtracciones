import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { AuthUser, Rol, rolPrincipal, scopesDe } from './scopes';

interface EstadoSesion {
  activo: boolean;
  vigente: boolean;
  roles: Rol[];
  operador: number | null;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Cada JWT corresponde a una fila de `sesion` (su `jti` es ses_id). En cada petición
 * se comprueba que la sesión no esté revocada ni vencida y que el usuario siga activo,
 * y los permisos se recalculan desde usuario_rol (auditoría SEG-009 y SEG-011).
 * Cerrar sesión, cambiar la contraseña o desactivar al usuario revoca sus sesiones.
 *
 * Sin caché en memoria (V2-CON-01): en serverless cada instancia tendría la suya y otra
 * instancia podría seguir aceptando un token ya revocado. La API corre en la misma región que
 * la base (gru1 / sa-east-1), así que consultar en cada petición cuesta pocos milisegundos y
 * la revocación es inmediata en todas las instancias.
 */
@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  async resolver(payload: AuthUser): Promise<AuthUser | null> {
    if (!payload.jti || !/^\d+$/.test(payload.sub ?? '')) return null;
    const estado = await this.estado(payload.sub, payload.jti);
    if (!estado || !estado.activo || !estado.vigente || !estado.roles.length) return null;
    return { ...payload, rol: rolPrincipal(estado.roles), roles: estado.roles, scope: scopesDe(estado.roles), operador: estado.operador };
  }

  async crear(sesId: string, usuId: string, token: string, expiraEn: Date, ip?: string, userAgent?: string) {
    await this.db.query(
      `INSERT INTO sesion (ses_id, usu_id, ses_token_hash, ses_ip, ses_user_agent, ses_expira_en) VALUES ($1, $2, $3, $4, $5, $6)`,
      [sesId, usuId, hashToken(token), ip?.slice(0, 45) ?? null, userAgent?.slice(0, 255) ?? null, expiraEn],
    );
    if (Math.random() < 0.05) {
      await this.db.query(`DELETE FROM sesion WHERE ses_expira_en < now() - interval '7 days'`).catch(() => undefined);
    }
  }

  async revocar(sesId: string) {
    await this.db.query('UPDATE sesion SET ses_revocada = TRUE WHERE ses_id = $1', [sesId]);
  }

  /** Revoca todas las sesiones del usuario, salvo `excepto` (la actual al cambiar la contraseña). */
  async revocarTodas(usuId: string, excepto?: string) {
    await this.db.query('UPDATE sesion SET ses_revocada = TRUE WHERE usu_id = $1 AND ses_id IS DISTINCT FROM $2', [usuId, excepto ?? null]);
  }

  /** Compatibilidad: sin caché no hay nada que olvidar; los cambios de rol o estado se ven en la siguiente petición. */
  invalidar(_usuId: string) {
    return;
  }

  private async estado(usuId: string, sesId: string): Promise<EstadoSesion | null> {
    return this.db.one<EstadoSesion>(
      `SELECT u.usu_activo AS activo,
              (NOT s.ses_revocada AND s.ses_expira_en > now()) AS vigente,
              COALESCE((SELECT array_agg(r.rol_nombre ORDER BY r.rol_id)
                          FROM usuario_rol ur JOIN rol r ON r.rol_id = ur.rol_id
                         WHERE ur.usu_id = u.usu_id AND r.rol_activo), '{}') AS roles,
              (SELECT o.ope_codigo FROM operador_usuario ou JOIN operador o ON o.ope_id = ou.ope_id
                WHERE ou.usu_id = u.usu_id AND ou.opeu_activo AND o.ope_activo
                ORDER BY o.ope_codigo LIMIT 1) AS operador
         FROM usuario u
         JOIN sesion s ON s.usu_id = u.usu_id AND s.ses_id = $2
        WHERE u.usu_id = $1`,
      [usuId, sesId],
    );
  }
}
