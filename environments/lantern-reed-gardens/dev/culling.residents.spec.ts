import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

test('scenery culling preserves every visible pixel including the pool reflection', async ({ page }) => {
  await page.goto('/environments/lantern-reed-gardens/#q=high&hud=0&t=12');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  const results = await page.evaluate(async () => {
    const m = window.__meadow!;
    const w = (window as unknown as { __world: {
      scenery: { cullingEnabled: boolean; populationCounts: { count: number; visible: number }[] };
    } }).__world;
    const initial = m.stats().growth;
    const results: { growth: number; preset: string; culled: string; full: string; saved: number }[] = [];
    for (const growth of [0, initial, 1]) {
      m.set('world.growth', growth);
      for (const preset of ['homestead', 'vista', 'meadow'] as const) {
        m.preset(preset);
        w.scenery.cullingEnabled = true;
        await m.settle();
        const culled = m.frameHash();
        const saved = w.scenery.populationCounts.reduce((sum, batch) => sum + batch.count - batch.visible, 0);
        w.scenery.cullingEnabled = false;
        await m.settle();
        const full = m.frameHash();
        results.push({ growth, preset, culled, full, saved });
      }
    }
    w.scenery.cullingEnabled = true;
    return results;
  });
  for (const result of results) expect(result.culled, `growth ${result.growth}, ${result.preset}`).toBe(result.full);
  expect(results.some(result => result.saved > 100)).toBe(true);
});
