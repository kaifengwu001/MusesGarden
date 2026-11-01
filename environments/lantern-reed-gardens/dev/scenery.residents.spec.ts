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
  expect(batches).toHaveLength(9);
  for (const batch of batches) expect(batch.count, batch.name).toBeGreaterThan(0);
  expect(batches.filter(b => /Lantern reed colony/.test(b.name)).reduce((sum,b) => sum+b.count,0)).toBeGreaterThan(200);
  expect(batches.find(b => /Lamp Petals/.test(b.name))?.count).toBe(7);
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-home.png' });
  await page.evaluate(async () => { window.__meadow?.preset('vista'); await window.__meadow?.settle(); });
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-vista.png' });
  const habitat = await page.evaluate(() => {
    const w = (window as unknown as { __world: {
      wildlife: { poses: { species: string; visible: boolean }[] };
      poolReflection: { uniforms: { uPoolMirrorStrength: { value: number }; uPoolMirrorMatrix: { value: { elements: number[] } } } };
      shared: { uLanternLightCount: { value: number } };
      birds: { mesh: { visible: boolean } }; butterflies: { mesh: { visible: boolean } };
    } }).__world;
    return { wildlife: w.wildlife.poses.filter(p => p.visible).length, reflection: w.poolReflection.uniforms.uPoolMirrorStrength.value, finite: w.poolReflection.uniforms.uPoolMirrorMatrix.value.elements.every(Number.isFinite), lights: w.shared.uLanternLightCount.value, birds: w.birds.mesh.visible, butterflies: w.butterflies.mesh.visible };
  });
  expect(habitat.wildlife).toBe(6);
  expect(habitat.reflection).toBeGreaterThan(0.9);
  expect(habitat.finite).toBe(true);
  expect(habitat.lights).toBeGreaterThan(0);
  expect(habitat.birds || habitat.butterflies).toBe(false);
  await page.getByRole('button', { name: 'Postcard', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/lantern-reed-gardens/reference-vista.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { window.__meadow?.set('light.timeOfDay', 12.5); await window.__meadow?.settle(); });
  await page.screenshot({ path: 'shots/lantern-reed-gardens/scenery-day.png' });
  expect(errors).toEqual([]);
});
