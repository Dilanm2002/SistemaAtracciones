// Punto de entrada serverless para Vercel.
// `npm run build` (nest build) genera ../dist antes de empaquetar esta función.
const { createApp } = require('../dist/app.factory');

let server;

module.exports = async (req, res) => {
  if (!server) {
    const app = await createApp();
    await app.init();
    server = app.getHttpAdapter().getInstance();
  }
  return server(req, res);
};
