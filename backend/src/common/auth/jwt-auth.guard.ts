import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { SCOPES_KEY } from './auth.decorators';
import { AuthUser, Scope } from './scopes';
import { verificarPruebaDpop } from './dpop';
import { SessionService } from './session.service';

type AuthRequest = Request & { user?: AuthUser };

function extractToken(req: Request): string | undefined {
  const [type, token] = req.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' || type === 'DPoP' ? token : undefined;
}

/**
 * WEB-008: si el token está ligado a una llave (cnf.jkt), la petición debe traer el esquema DPoP
 * y una prueba firmada con ESA llave para este método y ruta. Un token robado no sirve sin ella.
 */
function exigirPosesion(req: Request, token: string, payload: AuthUser) {
  if (!payload.cnf?.jkt) return;
  const prueba = req.header('dpop');
  if (!req.headers.authorization?.startsWith('DPoP ') || !prueba) {
    throw new UnauthorizedException('Esta sesión está ligada a tu navegador: falta la prueba DPoP.');
  }
  const { jkt } = verificarPruebaDpop(prueba, req.method, req.originalUrl.split('?')[0], { token });
  if (jkt !== payload.cnf.jkt) throw new UnauthorizedException('La sesión pertenece a otro navegador.');
}

/**
 * Valida el Bearer token, confirma en la base que el usuario siga activo
 * (rol y permisos se toman de la base, no del token) y, si la ruta declara
 * @Scopes(...), verifica que los tenga (401 sin sesión válida, 403 sin permisos).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Debes iniciar sesión para realizar esta acción.');

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    exigirPosesion(req, token, payload);
    const user = await this.sessions.resolver(payload);
    if (!user) throw new UnauthorizedException('Tu cuenta ya no está activa. Contacta al administrador.');
    req.user = user;

    const required = this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, [context.getHandler(), context.getClass()]);
    if (required?.length) {
      const granted = new Set(user.scope);
      const missing = required.filter((s) => !granted.has(s));
      if (missing.length) {
        throw new ForbiddenException(`No tienes permisos suficientes (requiere: ${missing.join(', ')}).`);
      }
    }
    return true;
  }
}

/** Igual que JwtAuthGuard pero deja pasar peticiones anónimas (req.user queda undefined). */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractToken(req);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AuthUser>(token);
        exigirPosesion(req, token, payload);
        req.user = (await this.sessions.resolver(payload)) ?? undefined;
      } catch {
        req.user = undefined;
      }
    }
    return true;
  }
}
