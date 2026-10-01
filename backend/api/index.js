// Punto de entrada serverless para Vercel (JavaScript plano porque Vercel lo ejecuta tal cual;
// toda la lógica vive en TypeScript dentro de ../dist). `npm run vercel-build` genera ../dist.

let serverPromise;

// Misma URI que common/errors/problem-types.ts → tipoError('unavailable') (V3-SEG-01). Se calcula
// aquí porque este archivo responde justamente cuando dist/ (donde vive el catálogo) no cargó.
const tipoUnavailable = () => `${(process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/errores/unavailable`;

function bootstrap() {
  serverPromise ??= (async () => {
    // require dentro del try de la petición: si dist/ falta, se responde un 503 problem+json (OPS-001)
    const { createApp } = require('../dist/app.factory');
    const app = await createApp();
    app.enableShutdownHooks();
    await app.init();
    return app.getHttpAdapter().getInstance();
  })().catch((err) => {
    serverPromise = undefined; // permitir reintentar en la siguiente petición
    throw err;
  });
  return serverPromise;
}

module.exports = async (req, res) => {
  try {
    const server = await bootstrap();
    return server(req, res);
  } catch (err) {
    // Diagnóstico en los Runtime Logs de Vercel (sin imprimir secretos)
    console.error('[bootstrap] No se pudo iniciar la API:', err?.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/problem+json');
    res.setHeader('Retry-After', '30');
    res.end(
      JSON.stringify({
        type: tipoUnavailable(),
        title: 'Servicio no disponible',
        status: 503,
        detail: 'La API no pudo iniciar. Intenta de nuevo en unos segundos.',
        // Mensaje técnico sin secretos (la URL de la base se oculta)
        cause: String(err?.message ?? err).replace(/postgres(ql)?:\/\/\S+/g, '[DATABASE_URL]'),
      }),
    );
  }
};
