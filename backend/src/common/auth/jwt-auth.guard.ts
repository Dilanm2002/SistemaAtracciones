import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { SCOPES_KEY } from './auth.decorators';
import { AuthUser, Scope } from './scopes';

function extractToken(req: Request): string | undefined {
  const [type, token] = req.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

/**
 * Valida el Bearer token y, si la ruta declara @Scopes(...), verifica que el
 * token los contenga (401 si no hay token válido, 403 si faltan scopes).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Debes iniciar sesión para realizar esta acción.');

    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    const required = this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, [context.getHandler(), context.getClass()]);
    if (required?.length) {
      const granted = new Set(req.user.scope ?? []);
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
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractToken(req);
    if (token) {
      try {
        req.user = await this.jwt.verifyAsync<AuthUser>(token);
      } catch {
        req.user = undefined;
      }
    }
    return true;
  }
}
