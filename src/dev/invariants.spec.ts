import { expect, test, type Page } from '@playwright/test';
import type {} from './harnessApi';

// Browser-side invariants (`npm run test:gpu`). CPU-side invariants live in
// src/dev/invariants/*.test.ts (Vitest).

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
}

async function settledHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const m = window.__meadow;
    if (!m) throw new Error('harness missing');
    await m.settle();
    return m.frameHash();
  });
}

test.describe('determinism', () => {
  const state = 'seed=412&q=high&hud=0&t=12';

  test('two loads of the same URL render an identical frame', async ({ page }) => {
    await open(page, state);
    const first = await settledHash(page);
    await page.goto('about:blank');
    await open(page, state);
    expect(await settledHash(page)).toBe(first);
  });

  test('a frozen frame is identical across re-renders', async ({ page }) => {
    await open(page, state);
    const a = await settledHash(page);
    const b = await page.evaluate(() => window.__meadow?.frameHash());
    expect(b).toBe(a);
  });
});

test.describe('state', () => {
  test('the URL hash round-trips through the store', async ({ page }) => {
    await open(page, 'seed=77&g=0.42&ws=0.9&q=high&t=3');
    expect(await page.evaluate(() => window.__meadow?.getHash())).toBe('seed=77&g=0.42&ws=0.9&q=high&t=3');
  });

  test('setHash applies a full state and resets what it omits', async ({ page }) => {
    await open(page, 'seed=77&ws=0.9&q=high');
    await page.evaluate(() => window.__meadow?.setHash('#seed=5&q=high'));
    expect(await page.evaluate(() => window.__meadow?.getHash())).toBe('seed=5&q=high');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#seed=5&q=high');
  });
});

test.describe('budgets', () => {
  test('first frame within 2 s', async ({ page }) => {
    await open(page, 'q=high');
    const stats = await page.evaluate(() => window.__meadow?.stats());
    expect(stats?.firstFrameMs).toBeLessThan(2000);
  });
});

test.describe('later stages', () => {
  test.fixme('picking: a CPU pick lands within 2 cm of the GPU position readback at 64 pixels (S8)', () => {});
  test.fixme('attached: props, stones and flower bases sit on the warped terrain (S6)', () => {});
  test.fixme('no LOD rings or popping during a 10 s dolly from Overview to Wander (S8)', () => {});
  test.fixme('growth scrub 0.3 → 0.7 → 0.3 returns the identical frame (S1)', () => {});
});
