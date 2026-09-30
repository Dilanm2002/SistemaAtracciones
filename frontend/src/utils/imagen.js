/**
 * Comprime una foto en el navegador antes de subirla (igual que comprimirImagen de Sal y Canela):
 * la reduce a un máximo de `maxW`×`maxH` manteniendo la proporción y la guarda como JPEG.
 * Así cada foto ocupa ~200-500 KB en Supabase Storage en vez de varios MB.
 * Si la imagen ya es pequeña y liviana se sube tal cual.
 */
export async function comprimirImagen(file, { maxW = 1600, maxH = 1200, calidad = 0.82, pesoMin = 400 * 1024 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    if (ratio === 1 && file.size <= pesoMin) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre fondo blanco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
