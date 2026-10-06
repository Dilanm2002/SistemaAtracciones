import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, ATRACCION, CLIENTE, enDias, simularApi } from './api-simulada.js';

/**
 * Pruebas móviles (MOV-010). Recorren el sitio construido en teléfonos y tablet y comprueban lo que
 * la auditoría móvil marcó: reflow sin scroll horizontal, accesibilidad (axe), peso del hero,
 * fotos en el ancho justo, checkout usable y el menú del panel accesible.
 */
const PUBLICAS = ['/', '/explorar', `/atraccion/${ATRACCION.id}`, '/destinos', '/ayuda', '/contacto', '/ingresar', '/registro', '/empresas'];

const desbordeHorizontal = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function abrir(page, ruta) {
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
}

test.describe('páginas públicas', () => {
  for (const ruta of PUBLICAS) {
    test(`${ruta} · sin scroll horizontal ni fallos graves de accesibilidad`, async ({ page }) => {
      await simularApi(page);
      await abrir(page, ruta);
      expect(await desbordeHorizontal(page), 'la página no debe desplazarse a los lados').toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const graves = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(graves.map((v) => `${v.id} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});

test('reflow a 320 px sin scroll horizontal (WCAG 1.4.10)', async ({ page }, info) => {
  test.skip(info.project.name !== 'iPhone SE', 'una sola vez basta');
  await page.setViewportSize({ width: 320, height: 640 });
  await simularApi(page);
  for (const ruta of PUBLICAS) {
    await abrir(page, ruta);
    expect(await desbordeHorizontal(page), `${ruta} a 320 px`).toBeLessThanOrEqual(0);
  }
});

test('MOV-001 · el teléfono descarga un solo hero, de 60 KB como máximo', async ({ page }, info) => {
  test.skip(info.project.name === 'iPad Mini', 'en tablet se elige una variante mayor, como corresponde');
  await simularApi(page);
  await abrir(page, '/');
  const heroes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((e) => /\/assets\/hero-\d+/.test(e.name))
    .map((e) => ({ url: e.name, kb: e.encodedBodySize / 1024 })));
  expect(heroes, 'el preload y la imagen deben ser el mismo archivo').toHaveLength(1);
  expect(heroes[0].kb).toBeLessThanOrEqual(60);
});

test('MOV-002 · las tarjetas del catálogo piden la variante liviana de la foto', async ({ page }) => {
  await simularApi(page);
  await abrir(page, '/explorar');
  const img = page.locator('.a-card img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el) => el.currentSrc)).toMatch(/\/w(480|960)\/|[?&]w=(480|960)/);
});

test('MOV-006 · en el checkout el primer campo se ve sin desplazarse y el resumen está plegado', async ({ page }) => {
  await simularApi(page, { usuario: CLIENTE });
  await abrir(page, `/reservar/${ATRACCION.id}?fecha=${enDias(10)}&hora=09:00&adultos=1`);
  const campo = page.getByLabel('Nombre completo');
  await expect(campo).toBeVisible();
  const caja = await campo.boundingBox();
  expect(caja.y + caja.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(page.locator('.os-toggle')).toBeVisible();
  await expect(page.locator('#os-detalle')).toBeHidden();
});

test('MOV-004 · el menú del panel atrapa el foco, se cierra con Escape y devuelve el foco', async ({ page }) => {
  await simularApi(page, { usuario: ADMIN });
  await abrir(page, '/admin/categorias');
  const boton = page.getByRole('button', { name: 'Abrir menú' });
  await boton.click();
  await expect(page.locator('#adm-sidebar')).toHaveClass(/open/);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#adm-sidebar')), `Tab n.º ${i + 1} sigue dentro del menú`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#adm-sidebar')).not.toHaveClass(/open/);
  await expect(boton).toBeFocused();
});
