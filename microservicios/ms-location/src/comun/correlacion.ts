import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * X-Correlation-Id (contrato con Booking): se respeta el que llega o se crea uno, se devuelve en la
 * respuesta y se reenvía en las llamadas a otros servicios. Una línea de log por petición.
 */
export function correlacion(servicio: string) {
  return (req: Request & { correlationId?: string }, res: Response, next: NextFunction) => {
    const entrante = (req.header('x-correlation-id') ?? req.header('x-request-id') ?? '').trim();
    const id = /^[\w.:-]{1,100}$/.test(entrante) ? entrante : randomUUID();
    req.correlationId = id;
    res.setHeader('X-Correlation-Id', id);
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'test') return;
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      console.log(JSON.stringify({ servicio, metodo: req.method, ruta: req.originalUrl, status: res.statusCode, ms: Math.round(ms), correlation_id: id }));
    });
    next();
  };
}
