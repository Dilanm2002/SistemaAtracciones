# Imágenes originales

Originales en alta resolución, a partir de las cuales se generan las variantes del sitio. **No se publican**: el sitio usa las versiones optimizadas.

| Original | Variantes generadas | Dónde se usan |
|---|---|---|
| `hero-cotopaxi.jpg` (1920×1280, 429 KB) | `src/assets/img/hero-{640,960,1280,1920}.{avif,webp,jpg}` y `public/img/og-cotopaxi-1200.jpg` | Portada del inicio y vista previa al compartir |
| `auth-bg.jpg` | `src/assets/img/auth-{960,1440}.webp` | Pantallas de ingreso y registro (solo en escritorio) |

Las variantes se generan con [sharp](https://sharp.pixelplumbing.com/):
- **Hero:** AVIF con calidad 50 a 640 y 960 px, y 44 a 1280 y 1920 px. WebP con calidad 70. JPEG con mozjpeg y calidad 72.
- **Vista previa:** 1200×630 en JPEG con calidad 78.

Si se cambia una imagen, regenera todas sus variantes. Vite les pone un hash en el nombre, así que nunca se sirve una copia vieja desde la caché.
