/**
 * Copia los recursos de Swagger UI desde node_modules a public/vendor/swagger-ui/ para que la
 * documentación se sirva desde el propio dominio y no desde un CDN de terceros (SEG-019).
 * Se ejecuta en `postinstall`, así existe tanto en local como en el build de Vercel.
 * (Redoc 2.1.5 está versionado en public/vendor/redoc-2.1.5/, con su licencia MIT.)
 */
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { dirname, join } = require('path');

let origen;
try {
  origen = dirname(require.resolve('swagger-ui-dist/package.json'));
} catch {
  console.warn('vendor-docs: swagger-ui-dist no está instalado; se omite.');
  process.exit(0);
}
const destino = join(__dirname, '..', 'public', 'vendor', 'swagger-ui');
mkdirSync(destino, { recursive: true });
for (const f of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'LICENSE']) {
  const src = join(origen, f);
  if (existsSync(src)) copyFileSync(src, join(destino, f));
}
console.log(`vendor-docs: Swagger UI ${require(join(origen, 'package.json')).version} copiado a public/vendor/swagger-ui`);
