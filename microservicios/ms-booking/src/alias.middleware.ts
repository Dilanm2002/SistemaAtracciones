import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Alias del contrato con Booking. Si el campo principal no llega, toma el valor del alias ANTES de la
 * validación (class-transformer no ejecuta @Transform sobre claves ausentes, por eso se hace aquí).
 * Si llegan los dos, manda el principal. Cubre:
 * - v2 final: alias en español («Alias canónico en español para…»).
 * - v3 (atracciones-openapi-v3.yaml): nombres canónicos en inglés (`attraction_id`, `date`, `time`) y
 *   `payment_method` como objeto `{ method: CREDIT_CARD | DEBIT_CARD | PAYPAL | TRANSFER }`.
 * - Guía de integración de socios (GUIA_INTEGRACION_SOCIOS.md §5.1): `customer.name`, sin
 *   `document_type` ni `payment_method` (Booking ya cobró), `booking_reservation_id`; check-in con `guia_asignado`.
 * El alias de la consulta (`fecha` → `date`) se resuelve en el controlador: en Express 5 `req.query` no se puede modificar.
 */
const CUERPO: Record<string, string> = {
  attraction_id: 'atraccion_id',
  date: 'fecha',
  cantidad_adultos: 'adult_count',
  cantidad_ninos: 'child_count',
  cantidad_seniors: 'senior_count',
  cantidad_estudiantes: 'student_count',
  cantidad_infantes: 'infant_count',
  metodo_pago: 'payment_method',
  observaciones: 'special_requirements',
  time_24h: 'hora',
  time: 'hora',
  booking_reservation_id: 'saga_id',
  guia_asignado: 'guia_codigo',
};
const CLIENTE: Record<string, string> = {
  nombre_completo: 'full_name',
  name: 'full_name',
  correo: 'email',
  telefono: 'phone',
  tipo_documento: 'document_type',
  numero_documento: 'document_id',
};

/** `payment_method.method` de v3 → método del contrato v2. PayPal lo cobra Booking. */
const METODO_V3: Record<string, string> = {
  CREDIT_CARD: 'TARJETA_CREDITO',
  DEBIT_CARD: 'TARJETA_CREDITO',
  PAYPAL: 'SOA_BOOKING_GATEWAY',
  TRANSFER: 'TRANSFERENCIA',
};

function copiar(obj: Record<string, unknown> | undefined, mapa: Record<string, string>) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [alias, principal] of Object.entries(mapa)) {
    if (obj[principal] === undefined && obj[alias] !== undefined) obj[principal] = obj[alias];
  }
}

/** Solo en el cuerpo de una reserva (tiene `customer`): método de pago y tipo de documento. */
function normalizarReserva(body: Record<string, unknown>) {
  const pm = body.payment_method;
  const metodo = pm && typeof pm === 'object' && !Array.isArray(pm) ? (pm as Record<string, unknown>).method : pm;
  if (typeof metodo === 'string') body.payment_method = METODO_V3[metodo.trim().toUpperCase()] ?? metodo;
  // La guía no envía método: la compra ya la cobró Booking en su pasarela
  else if (metodo === undefined) body.payment_method = 'SOA_BOOKING_GATEWAY';

  const c = body.customer as Record<string, unknown>;
  if (c && typeof c === 'object' && c.document_type === undefined && typeof c.document_id === 'string') {
    const doc = c.document_id.trim();
    c.document_type = /^\d{10}$/.test(doc) ? 'CEDULA' : /^\d{13}$/.test(doc) ? 'RUC' : 'PASAPORTE';
  }
}

@Injectable()
export class AliasV2Middleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const body = req.body as Record<string, unknown> | undefined;
    copiar(body?.customer as Record<string, unknown> | undefined, CLIENTE);
    if (body && typeof body === 'object' && !Array.isArray(body) && body.customer !== undefined) normalizarReserva(body);
    copiar(body, CUERPO);
    next();
  }
}
