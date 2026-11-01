import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

test('Lantern scenery renders its reeds, leaf roof and four-winged pollinators', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/environments/lantern-reed-gardens/#q=high&hud=0&t=12');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await page.evaluate(async () => { window.__meadow?.preset('homestead'); await window.__meadow?.settle(); });
  const batches = await page.evaluate(() => {
    const w = (window as unknown as { __world: { scenery: { group: { children: { name: string; geometry: { instanceCount: number } }[] } } } }).__world;
    return w.scenery.group.children.map(m => ({ name: m.name, count: m.geometry.instanceCount }));
  });
  expect(batches).toHaveLength(4);
  for (const batch of batches) expect(batch.count, batch.name).toBeGreaterThan(0);
  expect(batches.find(b => /Lamp Petals/.test(b.name))?.count).toBe(7);
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-home.png' });
  await page.evaluate(async () => { window.__meadow?.preset('vista'); await window.__meadow?.settle(); });
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-vista.png' });
  await page.evaluate(async () => { window.__meadow?.set('light.timeOfDay', 12.5); await window.__meadow?.settle(); });
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-day.png' });
  expect(errors).toEqual([]);
});
