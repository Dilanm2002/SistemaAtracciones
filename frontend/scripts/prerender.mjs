/**
 * Pre-renderizado para SEO (WEB-003) — se ejecuta después de `vite build`.
 *
 * La app sigue siendo una SPA, pero cada página pública y CADA atracción publicada tiene su propio
 * HTML estático con título, descripción, canonical, Open Graph, datos estructurados (schema.org) y
 * el contenido principal visible dentro de #root. Un buscador o una red social lee la página sin
 * ejecutar JavaScript; en el navegador React reemplaza ese contenido al montar.
 * También se regenera sitemap.xml con todas las atracciones.
 * Si la API no responde, el build continúa sin pre-renderizar las atracciones (no falla).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SITIO = (process.env.SITE_URL ?? 'https://descubre-ec.vercel.app').replace(/\/$/, '');
const API = (process.env.VITE_API_URL ?? 'https://sistemaatracciones-backend.vercel.app/api/v1').replace(/\/$/, '');
const plantilla = readFileSync(join(DIST, 'index.html'), 'utf8');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const recortar = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function pagina({ ruta, titulo, descripcion, imagen, cuerpo, ld }) {
  const url = `${SITIO}${ruta}`;
  let html = plantilla
    // La precarga del hero solo sirve en el inicio: en las demás páginas gastaría datos (MOV-001)
    .replace(/\s*<link rel="preload" as="image"[^>]*data-hero[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(descripcion)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(titulo)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(descripcion)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(titulo)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(descripcion)}$2`);
  if (imagen) {
    html = html
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(imagen)}$2`)
      .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(imagen)}$2`);
  }
  if (ld) html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`);
  html = html.replace('<div id="root"></div>', `<div id="root"><main class="container prerender">${cuerpo}</main></div>`);
  const destino = join(DIST, ruta === '/' ? '' : ruta, 'index.html');
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, html);
}

const ESTATICAS = [
  ['/explorar', 'Explorar tours y experiencias en Ecuador · Descubre EC', 'Busca y filtra tours, entradas y aventuras por región, categoría, precio y duración en todo el Ecuador.'],
  ['/destinos', 'Destinos turísticos del Ecuador · Descubre EC', 'Quito, Galápagos, Baños, Cuenca, Montañita y más destinos con experiencias reservables.'],
  ['/ayuda', 'Ayuda y preguntas frecuentes · Descubre EC', 'Cómo reservar, métodos de pago, cancelaciones y reembolsos en Descubre EC.'],
  ['/contacto', 'Contacto · Descubre EC', 'Escríbenos para dudas sobre reservas, cancelaciones o para publicar tus tours.'],
  ['/empresas', 'Vende tus tours y paquetes · Descubre EC', 'Agencias y operadores turísticos del Ecuador: publica tus experiencias y recibe reservas en línea.'],
];

async function obtener(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function main() {
  for (const [ruta, titulo, descripcion] of ESTATICAS) {
    pagina({ ruta, titulo, descripcion, cuerpo: `<h1>${esc(titulo.split(' · ')[0])}</h1><p>${esc(descripcion)}</p>` });
  }
  let atracciones = [];
  try {
    atracciones = (await obtener(`${API}/atracciones?limit=100`)).data ?? [];
  } catch (e) {
    console.warn(`prerender: no se pudo leer el catálogo (${e.message}); solo páginas estáticas.`);
  }
  for (const a of atracciones) {
    const ruta = `/atraccion/${a.id}`;
    const precio = a.price?.total != null ? `${a.price.total.toFixed(2)} ${a.price.currency}` : '';
    const lugar = [a.destination?.name, a.locations?.[0]?.address].filter(Boolean).join(' · ');
    const descripcion = recortar(a.short_description || a.long_description || a.name, 160);
    const imagen = a.photos?.[0]?.url;
    pagina({
      ruta,
      titulo: `${a.name} · Descubre EC`,
      descripcion,
      imagen,
      cuerpo: [
        `<h1>${esc(a.name)}</h1>`,
        lugar && `<p>${esc(lugar)}</p>`,
        imagen && `<img src="${esc(imagen)}" alt="${esc(a.name)}" width="800" height="533" />`,
        precio && `<p>Desde ${esc(precio)} por persona</p>`,
        `<p>${esc(a.long_description ?? '')}</p>`,
        a.includes?.length ? `<h2>Incluye</h2><ul>${a.includes.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '',
        `<p><a href="${esc(ruta)}">Reservar ${esc(a.name)}</a></p>`,
      ].filter(Boolean).join(''),
      ld: {
        '@context': 'https://schema.org',
        '@type': 'TouristTrip',
        name: a.name,
        description: descripcion,
        url: `${SITIO}${ruta}`,
        ...(imagen ? { image: imagen } : {}),
        ...(a.ratings?.number_of_reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: a.ratings.score, reviewCount: a.ratings.number_of_reviews } } : {}),
        ...(a.price?.total != null ? { offers: { '@type': 'Offer', price: a.price.total, priceCurrency: a.price.currency, availability: 'https://schema.org/InStock', url: `${SITIO}${ruta}` } } : {}),
        ...(a.destination?.name ? { touristType: a.categories, itinerary: { '@type': 'Place', name: a.destination.name, address: { '@type': 'PostalAddress', addressCountry: 'EC', addressLocality: a.destination.name } } } : {}),
      },
    });
  }
  const urls = ['/', ...ESTATICAS.map(([r]) => r), ...atracciones.map((a) => `/atraccion/${a.id}`)];
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(`${SITIO}${u}`)}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
  console.log(`prerender: ${ESTATICAS.length} páginas + ${atracciones.length} atracciones pre-renderizadas; sitemap con ${urls.length} URLs.`);
}

main().catch((e) => {
  console.warn(`prerender: ${e.message} (el build continúa)`);
});
