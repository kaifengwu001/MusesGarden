import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

test('layered canyon and all three native species render and can be observed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/environments/scarlet-sail-canyon/#q=high&t=12&hud=0');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Shelter', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const settlementStats = await page.evaluate(() => window.__meadow?.stats());
  expect(settlementStats?.flowerInstances).toBe(0);
  const bedSpecies = await page.evaluate(() => (window as unknown as { __garden: { ui: { beds: { meshes: { geometry: { userData: { nativeSpecies: string } } }[] } } } }).__garden.ui.beds.meshes.map(mesh => mesh.geometry.userData.nativeSpecies));
  expect(bedSpecies).toEqual(['coral', 'ivory', 'sage', 'young-coral']);
  test.info().annotations.push({ type: 'settlement-renderer', description: JSON.stringify(settlementStats) });
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/revised-settlement.png' });
  await page.getByRole('button', { name: 'Postcard', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/revised-postcard.png' });
  await page.keyboard.press('Escape');
  const bloomFrames = await page.evaluate(async () => {
    const h = window.__meadow!;
    h.set('world.bloom', 0); await h.settle(); const dormant = h.frameHash();
    h.set('world.bloom', 1); await h.settle(); const blooming = h.frameHash();
    return { dormant, blooming, flowers: h.stats().flowerInstances };
  });
  expect(bloomFrames.dormant).not.toBe(bloomFrames.blooming);
  expect(bloomFrames.flowers).toBe(0);
  // Revisit the user's steep shelter view where coplanar floor strips appeared.
  await page.evaluate(() => window.__meadow?.setHash('q=high&t=12&hud=0&pose=-0.1975,0.0379,0.5902,0.7818,0.657'));
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/shelter-floor.png' });
  for (const [name, id] of [['Chalkstep', 'chalkstep'], ['Fern Sifter', 'fern-sifter'], ['Dewwing', 'dewwing']]) {
    await page.getByRole('button', { name: `Observe ${name}`, exact: true }).click();
    await page.evaluate(async () => window.__meadow?.settle());
    await expect(page.locator('.canyon-notice')).toContainText(name === 'Chalkstep' ? 'fallen seeds' : name === 'Fern Sifter' ? 'mint leaf plates' : 'scarlet wings');
    await page.screenshot({ path: `shots/scarlet-sail-canyon/${id}.png` });
  }
  await page.getByRole('button', { name: 'Whole planet', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/revised-planet.png' });
  const ecology = await page.evaluate(() => {
    const w = (window as unknown as { __world: {
      fauna: { species: { id: string; count: number }[]; group: { children: unknown[] } };
      scenery: { group: { children: { isMesh?: boolean; geometry: { instanceCount: number } }[] } };
    } }).__world;
    return { species: w.fauna.species, animals: w.fauna.group.children.length, scenery: w.scenery.group.children.filter(b => b.isMesh).map(b => b.geometry.instanceCount) };
  });
  expect(ecology.species.map(s => s.id)).toEqual(['chalkstep', 'fern-sifter', 'dewwing']);
  expect(ecology.animals).toBeGreaterThanOrEqual(11);
  expect(ecology.scenery[0]).toBeGreaterThan(250);
  expect(ecology.scenery[3]).toBeGreaterThan(250);
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'ecology', description: JSON.stringify(ecology) });
});
