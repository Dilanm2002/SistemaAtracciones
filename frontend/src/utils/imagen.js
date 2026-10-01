/**
 * Fotos de cualquier formato y tamaño → una foto lista para mostrar.
 *
 * El usuario sube lo que tenga (JPG, PNG, WebP, GIF, BMP, AVIF, SVG o HEIC del iPhone; cuadrada,
 * vertical, panorámica o pequeña) y aquí se convierte en el navegador a un JPEG horizontal 3:2 de
 * 1600×1067, el formato de las tarjetas y del carrusel:
 * - Si ya es horizontal (proporción cercana a 3:2) se recorta un poco y se escala.
 * - Si es cuadrada, vertical, muy panorámica o muy pequeña, se coloca completa (sin recortarla)
 *   sobre un fondo desenfocado de la misma foto, como en las redes sociales.
 * Así la API solo recibe JPEG livianos (~200-500 KB) y la galería se ve uniforme.
 */
export const ANCHO = 1600;
export const ALTO = 1067;
const PROPORCION = ANCHO / ALTO;

/** Formatos que se aceptan para subir (lo que el navegador no decodifique se avisa). */
export const ACEPTA = 'image/*,.heic,.heif,.avif';
const esHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
export const esImagen = (f) => f.type.startsWith('image/') || esHeic(f) || /\.(jpe?g|png|webp|gif|bmp|avif|svg|tiff?)$/i.test(f.name);

async function decodificar(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* algunos formatos (SVG) solo los decodifica <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const dims = (img) => ({ w: img.naturalWidth ?? img.width, h: img.naturalHeight ?? img.height });

/** Dibuja `img` cubriendo el rectángulo (recorta lo que sobra, centrado). */
function cubrir(ctx, img, x, y, w, h) {
  const { w: iw, h: ih } = dims(img);
  const escala = Math.max(w / iw, h / ih);
  const sw = w / escala;
  const sh = h / escala;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Convierte cualquier imagen a un JPEG 3:2 de 1600×1067. Lanza Error si el formato no se puede leer. */
export async function normalizarFoto(file, { calidad = 0.85 } = {}) {
  let origen = file;
  if (esHeic(file)) {
    // El convertidor de HEIC (fotos del iPhone) solo se descarga cuando hace falta
    const { default: heic2any } = await import('heic2any');
    const r = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    origen = Array.isArray(r) ? r[0] : r;
  }
  let img;
  try {
    img = await decodificar(origen);
  } catch {
    throw new Error('el navegador no puede leer este formato de imagen');
  }
  const { w, h } = dims(img);
  if (!w || !h) throw new Error('la imagen está vacía o dañada');

  const canvas = document.createElement('canvas');
  canvas.width = ANCHO;
  canvas.height = ALTO;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const r = w / h;

  if (Math.abs(r - PROPORCION) <= 0.35) {
    cubrir(ctx, img, 0, 0, ANCHO, ALTO);
  } else {
    // Fondo: la misma foto muy reducida y ampliada (desenfoque que funciona en todos los navegadores)
    const mini = document.createElement('canvas');
    mini.width = 48;
    mini.height = 32;
    const mctx = mini.getContext('2d');
    cubrir(mctx, img, 0, 0, mini.width, mini.height);
    ctx.drawImage(mini, 0, 0, ANCHO, ALTO);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(0, 0, ANCHO, ALTO);
    // Frente: la foto completa, sin recortar, lo más grande posible
    const escala = Math.min(ANCHO / w, ALTO / h);
    const dw = w * escala;
    const dh = h * escala;
    ctx.drawImage(img, (ANCHO - dw) / 2, (ALTO - dh) / 2, dw, dh);
  }
  img.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad));
  if (!blob) throw new Error('no se pudo convertir la imagen');
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg' });
}

/** Compatibilidad con el código anterior: hoy toda foto pasa por normalizarFoto. */
export const comprimirImagen = (file) => normalizarFoto(file);
