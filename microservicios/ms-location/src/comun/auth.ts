import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/** Claims del JWT que emite Identity (hoy, la tienda): HS256 firmado con JWT_SECRET. */
export interface Usuario {
  sub: string;
  email?: string;
  nombre?: string;
  rol: 'ADMIN' | 'OPERADOR' | 'CLIENTE';
  roles?: string[];
  /** ope_codigo de la empresa operadora del usuario */
  operador?: number | null;
  exp?: number;
}

export const ROLES = 'roles_permitidos';
/** Roles que pueden usar el endpoint (cualquiera de ellos). */
export const Roles = (...roles: Usuario['rol'][]) => SetMetadata(ROLES, roles);

const b64 = (s: string) => Buffer.from(s, 'base64url');

/** Verifica un JWT HS256 (firma en tiempo constante y vencimiento). Devuelve null si no es válido. */
export function verificarJwt(token: string, secreto: string): Usuario | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const cabecera = JSON.parse(b64(partes[0]).toString('utf8')) as { alg?: string };
    if (cabecera.alg !== 'HS256') return null;
    const esperada = createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest();
    const firma = b64(partes[2]);
    if (firma.length !== esperada.length || !timingSafeEqual(firma, esperada)) return null;
    const u = JSON.parse(b64(partes[1]).toString('utf8')) as Usuario;
    if (!u.sub || !u.rol || (u.exp && u.exp * 1000 < Date.now())) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Exige `Authorization: Bearer <JWT>` válido. Con @Roles(...) exige además uno de esos roles.
 * El token lo emite Identity (ms_identity); mientras no exista, el de la tienda (mismo JWT_SECRET).
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { usuario?: Usuario }>();
    const [tipo, token] = (req.header('authorization') ?? '').split(' ');
    const secreto = process.env.JWT_SECRET;
    const u = secreto && token && /^(Bearer|DPoP)$/i.test(tipo) ? verificarJwt(token, secreto) : null;
    if (!u) throw new UnauthorizedException({ message: 'Se requiere un token JWT válido (Authorization: Bearer).', code: 'UNAUTHORIZED' });
    const roles = this.reflector.getAllAndOverride<Usuario['rol'][]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    const tiene = [u.rol, ...(u.roles ?? [])];
    if (roles?.length && !roles.some((r) => tiene.includes(r))) {
      throw new ForbiddenException({ message: 'No tienes permisos para esta acción.', code: 'FORBIDDEN' });
    }
    req.usuario = u;
    return true;
  }
}

/**
 * Llamadas entre servicios (eventos, uso interno): cabecera X-Servicio-Token con el secreto compartido
 * SERVICIOS_TOKEN. Sin la variable configurada no se acepta ninguna.
 */
@Injectable()
export class ServicioGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const esperado = process.env.SERVICIOS_TOKEN ?? '';
    const enviado = req.header('x-servicio-token') ?? '';
    const ok = esperado.length >= 16 && enviado.length === esperado.length && timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado));
    if (!ok) throw new UnauthorizedException({ message: 'Llamada interna sin X-Servicio-Token válido.', code: 'UNAUTHORIZED' });
    return true;
  }
}
