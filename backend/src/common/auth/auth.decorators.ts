import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser, Scope } from './scopes';

export const SCOPES_KEY = 'required_scopes';

/** Exige que el token incluya TODOS los scopes indicados. */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);

/** Inyecta el usuario autenticado (o undefined si la ruta usa OptionalJwtGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined => ctx.switchToHttp().getRequest().user,
);
