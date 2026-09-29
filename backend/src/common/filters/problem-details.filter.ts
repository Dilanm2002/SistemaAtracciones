import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Convierte cualquier error en una respuesta RFC 7807 (application/problem+json),
 * tal como lo exigen los contratos OpenAPI de la plantilla.
 *
 * Los errores de validación de class-validator se devuelven además en `errors`
 * para que el frontend pueda mostrar el mensaje junto al campo que falló.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  private static readonly TITLES: Record<number, string> = {
    400: 'Solicitud inválida',
    401: 'No autenticado',
    403: 'Acceso denegado',
    404: 'Recurso no encontrado',
    409: 'Conflicto',
    413: 'Archivo demasiado grande',
    422: 'No se pudo procesar la solicitud',
    500: 'Error interno del servidor',
  };

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, any> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'type' in payload && 'title' in payload) {
        // Ya viene en formato Problem Details (ej. IdempotencyKeyGuard)
        body = { ...(payload as object) };
      } else if (typeof payload === 'object' && payload !== null && Array.isArray((payload as any).message)) {
        // Errores de class-validator
        const messages: string[] = (payload as any).message;
        body = {
          type: 'https://api.descubre-ec.com/errors/validation',
          title: 'Datos de entrada inválidos',
          detail: messages[0],
          code: 'VALIDATION_FAILED',
          errors: messages.map((m) => ({ field: m.split(' ')[0], message: m })),
        };
      } else {
        const message = typeof payload === 'string' ? payload : (payload as any)?.message;
        body = {
          type: `https://api.descubre-ec.com/errors/${status}`,
          title: ProblemDetailsFilter.TITLES[status] ?? 'Error',
          detail: message,
          ...(typeof payload === 'object' && (payload as any)?.code ? { code: (payload as any).code } : {}),
        };
      }
    } else if (exception instanceof QueryFailedError && (exception as any).driverError?.code === '23505') {
      status = HttpStatus.CONFLICT;
      body = {
        type: 'https://api.descubre-ec.com/errors/duplicate',
        title: 'Registro duplicado',
        detail: 'Ya existe un registro con esos datos únicos.',
        code: 'DUPLICATE',
      };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      body = {
        type: 'https://api.descubre-ec.com/errors/internal',
        title: ProblemDetailsFilter.TITLES[500],
        detail: 'Ocurrió un error inesperado. Intenta nuevamente en unos minutos.',
      };
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ ...body, status, instance: req.originalUrl });
  }
}
