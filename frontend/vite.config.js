import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Versión de la web en la telemetría (docs/OBSERVABILIDAD.md): se ve en cada incidente y Web Vital
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Navegadores soportados (MOV-016): el código usa dvh, :focus-visible, min(), aspect-ratio,
 * env(safe-area-inset-*) e imágenes AVIF/WebP, así que se declara el mínimo de forma explícita.
 * Safari 16.4 (iOS 16.4, marzo 2023) es el piso real en iPhone; Chrome 111 en Android.
 */
const NAVEGADORES = ['es2022', 'safari16.4', 'ios16.4', 'chrome111', 'edge111', 'firefox114'];

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173 },
  build: {
    target: NAVEGADORES,
    cssTarget: ['safari16.4', 'ios16.4', 'chrome111', 'edge111', 'firefox114'],
    // heic2any (HEIC del iPhone) y xlsx (exportar reportes) superan 500 kB, pero se cargan con
    // import() solo cuando se usan: no están en la ruta crítica de ninguna página.
    chunkSizeWarningLimit: 1400,
  },
});
