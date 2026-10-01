import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Caché en el CDN de Vercel para el catálogo público (rendimiento).
 *
 * Solo las respuestas 2xx de peticiones ANÓNIMAS (sin Authorization) se marcan como públicas:
 * el CDN las sirve durante `segundos` sin tocar la base de datos y, mientras revalida, entrega
 * la copia anterior (stale-while-revalidate). Con sesión (panel, operador, cliente) la respuesta
 * es `private, no-store`: nunca se comparte ni se guarda lo que depende del usuario.
 * `Vary: Authorization` evita que una copia anónima se use para una petición autenticada.
 */
@Injectable()
class CachePublicoInterceptor implements NestInterceptor {
  constructor(private readonly segundos: number) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const anonimo = !req.headers.authorization;
    return next.handle().pipe(
      tap(() => {
        if (res.headersSent) return;
        res.setHeader('Vary', 'Authorization');
        res.setHeader(
          'Cache-Control',
          anonimo
            ? `public, max-age=${Math.min(this.segundos, 60)}, s-maxage=${this.segundos}, stale-while-revalidate=${this.segundos * 10}`
            : 'private, no-store',
        );
      }),
    );
  }
}

/** Marca un GET del catálogo como cacheable en el CDN durante `segundos` (solo peticiones anónimas). */
export const CachePublico = (segundos: number) => UseInterceptors(new CachePublicoInterceptor(segundos));
