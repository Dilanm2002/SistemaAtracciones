import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/** Error de `http-errors` (lo lanzan body-parser y otros middlewares) con estado 4xx pensado para el cliente. */
const esErrorHttpCliente = (e: unknown): e is Error & { status: number } => {
  const { expose, status } = e as { expose?: unknown; status?: unknown };
  return e instanceof Error && expose === true && typeof status === 'number' && status >= 400 && status < 500;
};

const pgCode = (e: QueryFailedError) => (e as QueryFailedError & { driverError?: { code?: string } }).driverError?.code ?? '';

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
    429: 'Demasiadas solicitudes',
    422: 'No se pudo procesar la solicitud',
    500: 'Error interno del servidor',
  };

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'type' in payload && 'title' in payload) {
        // Ya viene en formato Problem Details (ej. IdempotencyKeyGuard)
        body = { ...(payload as object) };
      } else if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { message?: unknown }).message)) {
        // Errores de class-validator
        const messages = (payload as { message: string[] }).message;
        body = {
          type: 'https://api.descubre-ec.com/errors/validation',
          title: 'Datos de entrada inválidos',
          detail: messages[0],
          code: 'VALIDATION_FAILED',
          errors: messages.map((m) => ({ field: m.split(' ')[0], message: m })),
        };
      } else {
        const obj = typeof payload === 'object' && payload !== null ? (payload as { message?: string; code?: string }) : {};
        const message = typeof payload === 'string' ? payload : obj.message;
        body = {
          type: `https://api.descubre-ec.com/errors/${status}`,
          title: ProblemDetailsFilter.TITLES[status] ?? 'Error',
          detail: message,
          ...(obj.code ? { code: obj.code } : {}),
        };
      }
    } else if (exception instanceof QueryFailedError && ['22P02', '22007', '22008'].includes(pgCode(exception))) {
      // Valor con formato inválido para la columna (p. ej. un UUID mal formado): es un 400, no un 500
      status = HttpStatus.BAD_REQUEST;
      body = {
        type: 'https://api.descubre-ec.com/errors/invalid-value',
        title: 'Solicitud inválida',
        detail: 'Uno de los valores enviados no tiene el formato esperado.',
        code: 'VALIDATION_FAILED',
      };
    } else if (exception instanceof QueryFailedError && ['23514', '23502', '22001', '22003'].includes(pgCode(exception))) {
      // Restricción CHECK o dominio (dom_correo, dom_ruc, dom_documento…), NOT NULL o valor fuera de rango
      status = HttpStatus.BAD_REQUEST;
      body = {
        type: 'https://api.descubre-ec.com/errors/constraint',
        title: 'Solicitud inválida',
        detail: 'Alguno de los datos no cumple las reglas del sistema (formato de correo, RUC, documento, teléfono o un valor fuera de rango).',
        code: 'CONSTRAINT_VIOLATION',
        constraint: (exception as QueryFailedError & { driverError?: { constraint?: string } }).driverError?.constraint,
      };
    } else if (exception instanceof QueryFailedError && pgCode(exception) === '23503') {
      status = HttpStatus.CONFLICT;
      body = {
        type: 'https://api.descubre-ec.com/errors/in-use',
        title: 'Conflicto',
        detail: 'La operación no es posible porque el registro está relacionado con otros datos.',
        code: 'FOREIGN_KEY',
      };
    } else if (exception instanceof QueryFailedError && pgCode(exception) === '23505') {
      status = HttpStatus.CONFLICT;
      body = {
        type: 'https://api.descubre-ec.com/errors/duplicate',
        title: 'Registro duplicado',
        detail: 'Ya existe un registro con esos datos únicos.',
        code: 'DUPLICATE',
      };
    } else if (esErrorHttpCliente(exception)) {
      // Errores 4xx de los middlewares de Express (body-parser: cuerpo > 100 kB, charset no soportado…)
      status = exception.status;
      body = {
        type: `https://api.descubre-ec.com/errors/${status}`,
        title: ProblemDetailsFilter.TITLES[status] ?? 'Solicitud inválida',
        detail: status === HttpStatus.PAYLOAD_TOO_LARGE ? 'El cuerpo de la solicitud supera el tamaño máximo permitido (100 kB).' : exception.message,
      };
    } else {
      this.logger.error(`[${(req as Request & { id?: string }).id ?? '-'}] ${exception instanceof Error ? exception.stack : String(exception)}`);
      body = {
        type: 'https://api.descubre-ec.com/errors/internal',
        title: ProblemDetailsFilter.TITLES[500],
        detail: 'Ocurrió un error inesperado. Intenta nuevamente en unos minutos.',
      };
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      body.detail = 'Hiciste demasiadas solicitudes seguidas. Espera un momento e intenta de nuevo.';
      body.code = 'RATE_LIMITED';
    }
    const requestId = (req as Request & { id?: string }).id;
    res
      .status(status)
      .type('application/problem+json')
      .json({ ...body, status, instance: req.originalUrl, ...(requestId ? { request_id: requestId } : {}) });
  }
}
