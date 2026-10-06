import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas móviles (MOV-010): el sitio construido (`vite preview`) en perfiles de teléfono y tablet.
 * La API se simula con datos reales grabados (e2e/fixtures), así la prueba no depende de producción.
 * Se usa Chromium con el viewport, la densidad y el modo táctil de cada dispositivo.
 */
const chromium = (d) => ({ ...devices[d], browserName: 'chromium', defaultBrowserType: 'chromium' });

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', locale: 'es-EC', timezoneId: 'America/Guayaquil' },
  projects: [
    { name: 'iPhone SE', use: chromium('iPhone SE (3rd gen)') }, // 375×667, el mínimo real de la matriz de la auditoría
    { name: 'iPhone 13', use: chromium('iPhone 13') },
    { name: 'Pixel 5', use: chromium('Pixel 5') },
    { name: 'iPad Mini', use: chromium('iPad Mini') },
  ],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
