import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, ValidationError } from '@nestjs/common';
import { Request, Response } from 'express';

const TITULOS: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Acceso prohibido',
  404: 'Recurso no encontrado',
  409: 'Conflicto de estado',
  422: 'Entidad no procesable',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  503: 'Servicio no disponible',
};
const CODIGOS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'SEMANTIC_VALIDATION_FAILED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

interface ParametroInvalido {
  name: string;
  reason: string;
}

/** Errores de class-validator → invalid_params con la ruta completa del campo (customer.phone). */
export function parametrosInvalidos(errores: ValidationError[], prefijo = ''): ParametroInvalido[] {
  return errores.flatMap((e) => {
    const nombre = prefijo ? `${prefijo}.${e.property}` : e.property;
    const propios = Object.values(e.constraints ?? {}).map((reason) => ({ name: nombre, reason }));
    return [...propios, ...parametrosInvalidos(e.children ?? [], nombre)];
  });
}

/** Para el ValidationPipe: 400 con invalid_params. */
export const fabricaDeErroresDeValidacion = (errores: ValidationError[]) =>
  new BadRequestException({ message: 'La solicitud tiene campos inválidos.', code: 'VALIDATION_FAILED', invalid_params: parametrosInvalidos(errores) });

/** Errores en formato RFC 7807 (application/problem+json), como el contrato con Booking. */
@Catch()
export class ProblemasFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(ex: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    const res = ctx.getResponse<Response>();
    const status = ex instanceof HttpException ? ex.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const cuerpo = ex instanceof HttpException ? ex.getResponse() : null;
    const datos = (typeof cuerpo === 'object' && cuerpo ? cuerpo : {}) as Record<string, unknown>;
    const mensaje = Array.isArray(datos.message) ? (datos.message as string[]).join('; ') : (datos.message as string | undefined) ?? (typeof cuerpo === 'string' ? cuerpo : undefined);
    if (status >= 500) this.logger.error(ex instanceof Error ? ex.stack : String(ex));
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://descubre-ec.com/errores/${String((datos.code as string) ?? CODIGOS[status] ?? status).toLowerCase().replace(/_/g, '-')}`,
        title: TITULOS[status] ?? 'Error',
        status,
        detail: status >= 500 ? 'Ocurrió un error inesperado. Intenta de nuevo.' : mensaje ?? TITULOS[status] ?? 'Error',
        instance: req.originalUrl,
        code: (datos.code as string) ?? CODIGOS[status] ?? 'ERROR',
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        ...(datos.invalid_params ? { invalid_params: datos.invalid_params } : {}),
      });
  }
}
