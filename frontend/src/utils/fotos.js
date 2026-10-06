/**
 * Fotos del catálogo en el ancho justo (MOV-002). Antes cada tarjeta descargaba la foto completa
 * (1280-1600 px, ~200-500 KB) aunque en un celular se muestra a ~345 px.
 *  - Fotos de ejemplo  (…/img/x.jpg)            → variantes estáticas …/img/w480/x.webp y …/img/w960/x.webp
 *  - Fotos subidas     (…/api/v1/media/x.jpg)   → la API las reduce: ?w=480 y ?w=960 (WebP, caché del CDN)
 *  - Cualquier otra URL (blob:, externas)       → se usa tal cual
 * `completa`: incluye también la original, para la galería del detalle en pantallas grandes.
 */
const RE_ESTATICA = /^(.*\/img\/)([^/?#]+)\.(jpe?g|png)$/i;

export function srcSetFoto(url, { completa = false } = {}) {
  if (!url) return undefined;
  const est = RE_ESTATICA.exec(url);
  if (est) {
    const [, base, nombre] = est;
    return [`${base}w480/${nombre}.webp 480w`, `${base}w960/${nombre}.webp 960w`, ...(completa ? [`${url} 1280w`] : [])].join(', ');
  }
  if (url.includes('/api/v1/media/')) {
    const sep = url.includes('?') ? '&' : '?';
    return [`${url}${sep}w=480 480w`, `${url}${sep}w=960 960w`, ...(completa ? [`${url} 1600w`] : [])].join(', ');
  }
  return undefined;
}

/** Anchos con que se muestra cada tipo de foto (atributo `sizes`). */
export const SIZES = {
  tarjeta: '(max-width: 487px) 92vw, (max-width: 1100px) 46vw, 340px',
  destino: '(max-width: 520px) 92vw, (max-width: 900px) 46vw, 300px',
  resumen: '(max-width: 1000px) 92vw, 380px',
  miniatura: '160px',
  galeria: '(max-width: 760px) 100vw, (max-width: 1200px) 66vw, 800px',
};

/** Props `src`/`srcSet`/`sizes` listas para un <img>. */
export const fotoProps = (url, sizes, opciones) => {
  const srcSet = srcSetFoto(url, opciones);
  return { src: url, ...(srcSet ? { srcSet, sizes } : {}) };
};
