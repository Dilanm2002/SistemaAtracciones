import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Agent, ClientRequest } from 'http';
import { esSalud, rutear, urlDe } from './rutas';

type Peticion = Request & { destino?: string; rutaDestino?: string; correlationId?: string };

/** Respuesta RFC 7807 cuando el servicio de destino no responde (o todavía no está conectado). */
function problema(res: Response, status: number, detalle: string, req: Peticion, code = 'UPSTREAM_UNAVAILABLE') {
  if (res.headersSent) return res.end();
  res.status(status).type('application/problem+json').json({
    type: `https://descubre-ec.com/errores/${code.toLowerCase().replace(/_/g, '-')}`,
    title: 'Servicio no disponible',
    status,
    detail: detalle,
    instance: req.originalUrl,
    code,
    correlation_id: req.correlationId,
    timestamp: new Date().toISOString(),
  });
}

/** Decide el destino, fija X-Correlation-Id y deja una línea de log por petición. */
export function preparar(req: Peticion, res: Response, next: NextFunction) {
  const r = rutear(req.method, req.originalUrl);
  req.destino = r.destino ?? undefined;
  req.rutaDestino = r.ruta;
  const entrante = (req.header('x-correlation-id') ?? '').trim();
  req.correlationId = /^[\w.:-]{1,100}$/.test(entrante) ? entrante : randomUUID();
  req.headers['x-correlation-id'] = req.correlationId;
  res.setHeader('X-Correlation-Id', req.correlationId);
  res.setHeader('X-Atendido-Por', r.destino ?? 'gateway');
  const inicio = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    console.log(JSON.stringify({ servicio: 'gateway', metodo: req.method, ruta: req.originalUrl, destino: r.destino, status: res.statusCode, ms: Date.now() - inicio, correlation_id: req.correlationId }));
  });
  if (!r.destino && !esSalud(req.originalUrl)) {
    res.setHeader('X-Atendido-Por', 'gateway');
    return problema(res, 404, `La ruta ${req.method} ${req.originalUrl.split('?')[0]} no es parte del contrato de este nodo.`, req, 'NOT_FOUND');
  }
  next();
}

/** Reenvía la petición tal cual (cuerpo, X-API-Key, Idempotency-Key…) al destino elegido. */
export const reenviar = createProxyMiddleware<Peticion, Response>({
  router: (req) => urlDe(req.destino as never),
  pathRewrite: (_path, req) => req.rutaDestino ?? req.originalUrl,
  // Con Connection: close, la entrada interna de Azure deja colgadas las respuestas de más de ~64 KB
  agent: new Agent({ keepAlive: true, maxSockets: 64, timeout: 60_000 }),
  changeOrigin: true,
  xfwd: true,
  // Booking corta a los 4 s (circuit breaker): mejor responder un 504 claro antes
  proxyTimeout: Number(process.env.GATEWAY_TIMEOUT_MS ?? 3800),
  on: {
    proxyReq: (proxyReq: ClientRequest, req) => {
      proxyReq.setHeader('x-correlation-id', req.correlationId ?? '');
    },
    error: (err, req, res) => {
      const r = res as Response;
      const timeout = /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test((err as NodeJS.ErrnoException).code ?? err.message);
      problema(r, timeout ? 504 : 503, `${(req as Peticion).destino} no respondió (${(err as NodeJS.ErrnoException).code ?? err.message}).`, req as Peticion);
    },
  },
});
