// Punto de entrada serverless para Vercel.
// `npm run build` (nest build) genera ../dist antes de empaquetar esta función.
const { createApp } = require('../dist/app.factory');

let serverPromise;

function bootstrap() {
  serverPromise ??= (async () => {
    const app = await createApp();
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
    console.error('[bootstrap] No se pudo iniciar la API:', err?.message, {
      DATABASE_URL: !!process.env.DATABASE_URL,
      DB_SSL: process.env.DB_SSL,
      NODE_ENV: process.env.NODE_ENV,
    });
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/problem+json');
    res.end(
      JSON.stringify({
        type: 'https://api.descubre-ec.com/errors/unavailable',
        title: 'Servicio no disponible',
        status: 503,
        detail: 'La API no pudo conectarse a sus dependencias. Revisa los logs del despliegue.',
      }),
    );
  }
};
