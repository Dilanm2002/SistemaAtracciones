import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Alias en español del contrato v2 final («Alias canónico en español para…»). Si el campo principal
 * no llega, toma el valor del alias ANTES de la validación (class-transformer no ejecuta @Transform
 * sobre claves ausentes, por eso se hace aquí). Si llegan los dos, manda el principal.
 * El alias de la consulta (`fecha` → `date`) se resuelve en el controlador: en Express 5 `req.query` no se puede modificar.
 */
const CUERPO: Record<string, string> = {
  cantidad_adultos: 'adult_count',
  cantidad_ninos: 'child_count',
  cantidad_seniors: 'senior_count',
  cantidad_estudiantes: 'student_count',
  cantidad_infantes: 'infant_count',
  metodo_pago: 'payment_method',
  observaciones: 'special_requirements',
  time_24h: 'hora',
};
const CLIENTE: Record<string, string> = {
  nombre_completo: 'full_name',
  correo: 'email',
  telefono: 'phone',
  tipo_documento: 'document_type',
  numero_documento: 'document_id',
};

function copiar(obj: Record<string, unknown> | undefined, mapa: Record<string, string>) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [alias, principal] of Object.entries(mapa)) {
    if (obj[principal] === undefined && obj[alias] !== undefined) obj[principal] = obj[alias];
  }
}

@Injectable()
export class AliasV2Middleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const body = req.body as Record<string, unknown> | undefined;
    copiar(body, CUERPO);
    copiar(body?.customer as Record<string, unknown> | undefined, CLIENTE);
    next();
  }
}
