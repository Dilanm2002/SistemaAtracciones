import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { conCorrelacion, correlacionActual } from './correlacion';

/**
 * gRPC entre microservicios (pricing, inventory, order y booking, según el script del equipo).
 * - Autenticación: metadata `x-servicio-token` (SERVICIOS_TOKEN), igual que las rutas REST internas.
 * - `x-correlation-id` viaja en la metadata y se restaura en el servidor.
 * - Los errores de negocio viajan como JSON en `details` ({ status, code, message }) para que el
 *   cliente los convierta otra vez en el mismo error HTTP del contrato (p. ej. 409 OUT_OF_STOCK).
 */
const PROTO_DIRS = [join(__dirname, '..', '..', '..', 'proto'), join(process.cwd(), 'proto'), join(process.cwd(), '..', 'proto')];

function cargar(archivo: string) {
  const dir = PROTO_DIRS.find((d) => existsSync(join(d, archivo)));
  if (!dir) throw new Error(`No se encontró proto/${archivo}`);
  const def = protoLoader.loadSync(join(dir, archivo), { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  return grpc.loadPackageDefinition(def);
}

function servicioDe(paquete: grpc.GrpcObject, nombre: string): grpc.ServiceClientConstructor {
  const s = nombre.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], paquete);
  if (!s) throw new Error(`El proto no define ${nombre}`);
  return s as grpc.ServiceClientConstructor;
}

const A_GRPC: Record<number, grpc.status> = {
  400: grpc.status.INVALID_ARGUMENT, 401: grpc.status.UNAUTHENTICATED, 403: grpc.status.PERMISSION_DENIED, 404: grpc.status.NOT_FOUND,
  409: grpc.status.FAILED_PRECONDITION, 422: grpc.status.INVALID_ARGUMENT, 503: grpc.status.UNAVAILABLE,
};

const tokenValido = (enviado: string) => {
  const esperado = process.env.SERVICIOS_TOKEN ?? '';
  return esperado.length >= 16 && enviado.length === esperado.length && timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado));
};

export type Implementacion = Record<string, (req: never) => Promise<unknown>>;

/** Levanta el servidor gRPC del servicio en GRPC_PORT (o el puerto por defecto). Devuelve una función para cerrarlo. */
export async function iniciarServidorGrpc(archivo: string, servicio: string, impl: Implementacion, puertoPorDefecto: number, nombre: string) {
  const logger = new Logger(nombre);
  const server = new grpc.Server();
  const handlers: grpc.UntypedServiceImplementation = {};
  for (const [metodo, fn] of Object.entries(impl)) {
    handlers[metodo] = (call: grpc.ServerUnaryCall<unknown, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      const token = String(call.metadata.get('x-servicio-token')[0] ?? '');
      if (!tokenValido(token)) return cb({ code: grpc.status.UNAUTHENTICATED, details: JSON.stringify({ status: 401, code: 'UNAUTHORIZED', message: 'Llamada interna sin x-servicio-token válido.' }) });
      const cid = String(call.metadata.get('x-correlation-id')[0] ?? '') || undefined;
      conCorrelacion(cid, () => (fn as (r: unknown) => Promise<unknown>)(call.request))
        .then((r) => cb(null, r))
        .catch((e: unknown) => {
          if (e instanceof HttpException) {
            const st = e.getStatus();
            const cuerpo = e.getResponse() as { message?: string; code?: string };
            return cb({ code: A_GRPC[st] ?? grpc.status.UNKNOWN, details: JSON.stringify({ status: st, code: cuerpo.code, message: cuerpo.message ?? e.message }) });
          }
          logger.error(`${metodo}: ${(e as Error).message}`);
          cb({ code: grpc.status.INTERNAL, details: JSON.stringify({ status: 500, code: 'INTERNAL', message: 'Error interno.' }) });
        });
    };
  }
  server.addService(servicioDe(cargar(archivo), servicio).service, handlers);
  const puerto = Number(process.env.GRPC_PORT ?? puertoPorDefecto);
  await new Promise<void>((ok, mal) => server.bindAsync(`0.0.0.0:${puerto}`, grpc.ServerCredentials.createInsecure(), (e) => (e ? mal(e) : ok())));
  logger.log(`${nombre} gRPC en 0.0.0.0:${puerto} (${servicio})`);
  return () => new Promise<void>((ok) => server.tryShutdown(() => ok()));
}

const clientes = new Map<string, grpc.Client>();

/** Llamada unaria a otro servicio. Destino: <SERVICIO>_GRPC_URL (p. ej. PRICING_GRPC_URL) o localhost. */
export function llamarGrpc<T>(archivo: string, servicio: string, destinoVar: string, destinoPorDefecto: string, metodo: string, req: unknown, timeout = 3000): Promise<T> {
  const destino = process.env[destinoVar] ?? destinoPorDefecto;
  const clave = `${servicio}@${destino}`;
  let c = clientes.get(clave);
  if (!c) {
    const Ctor = servicioDe(cargar(archivo), servicio);
    c = new Ctor(destino, grpc.credentials.createInsecure());
    clientes.set(clave, c);
  }
  const meta = new grpc.Metadata();
  meta.set('x-servicio-token', process.env.SERVICIOS_TOKEN ?? '');
  const cid = correlacionActual();
  if (cid) meta.set('x-correlation-id', cid);
  const corto = servicio.split('.').pop();
  return new Promise<T>((ok, mal) => {
    (c as unknown as Record<string, (r: unknown, m: grpc.Metadata, o: grpc.CallOptions, cb: (e: grpc.ServiceError | null, r: T) => void) => void>)[metodo](
      req, meta, { deadline: new Date(Date.now() + timeout) },
      (e, r) => {
        if (!e) return ok(r);
        let d: { status?: number; code?: string; message?: string } = {};
        try { d = JSON.parse(e.details); } catch { /* sin detalle */ }
        if (d.status && d.status < 500) return mal(new HttpException({ message: d.message, code: d.code, upstream: corto }, d.status));
        mal(new ServiceUnavailableException({ message: `${corto} no responde por gRPC (${grpc.status[e.code]}).`, code: 'DEPENDENCY_UNAVAILABLE' }));
      },
    );
  });
}
