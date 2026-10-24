import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';

/** Largo mínimo de BOOKING_API_KEY: una clave corta se podría adivinar. */
const MIN_CLAVE = 24;

const huella = (v: string) => createHash('sha256').update(v).digest();

/**
 * Seguridad del contrato v2 (`security: [BearerAuth, ApiKeyAuth]`): basta con UNA de las dos.
 * - `X-API-Key`: clave máquina a máquina precompartida con Booking Prototipo (variable BOOKING_API_KEY).
 *   Se compara en tiempo constante. Si la variable no está configurada, ninguna clave es válida.
 * - `Authorization: Bearer|DPoP <JWT>`: un administrador de Descubre EC (admin:full), p. ej. desde el panel.
 * Sin ninguna → 401; con un JWT válido pero sin permisos de administrador → 403.
 * Las operaciones públicas del contrato (`security: []`) no usan este guard.
 */
@Injectable()
export class SocioGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtAuthGuard,
  ) {}

  private claveValida(enviada: string): boolean {
    const esperada = this.config.get<string>('BOOKING_API_KEY')?.trim();
    if (!esperada || esperada.length < MIN_CLAVE) return false;
    // Huellas del mismo largo: timingSafeEqual no filtra ni el contenido ni el largo de la clave
    return timingSafeEqual(huella(enviada.trim()), huella(esperada));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; socio?: string }>();
    const clave = req.header('x-api-key');
    if (clave) {
      if (!this.claveValida(clave)) throw new UnauthorizedException({ message: 'La X-API-Key no es válida.', code: 'UNAUTHORIZED' });
      req.socio = 'booking-prototipo';
      return true;
    }
    if (!req.headers.authorization) {
      throw new UnauthorizedException({
        message: 'Esta operación requiere la cabecera X-API-Key (Booking Prototipo) o un token JWT de administrador.',
        code: 'UNAUTHORIZED',
      });
    }
    await this.jwt.canActivate(context); // 401 si el token no es válido
    if (!req.user?.scope.includes(SCOPES.ADMIN)) {
      throw new ForbiddenException({ message: 'No cuenta con el rol de administración ni con credenciales de socio para esta acción.', code: 'FORBIDDEN' });
    }
    return true;
  }
}
