import { test, type Page } from '@playwright/test';
import type {} from './harnessApi';

// `npm run shots`: fixed seeds and camera presets rendered at frozen time into
// /shots. Each shot pins its quality tier, so a capture never depends on the
// benchmark of the machine that ran it. The perf HUD is on for checkpoints.

const FROZEN_T = 12;

const SHOTS: ReadonlyArray<{ name: string; hash: string }> = [
  { name: 'seed0412-overview', hash: 'cam=overview' },
  { name: 'seed0412-wander', hash: 'cam=wander' },
  { name: 'seed0007-seedling', hash: 'seed=7&g=0&b=0.2' },
  { name: 'seed1234-wide', hash: 'seed=1234&g=1&b=1&tod=16.8' },
];

const VIEWPORTS = [
  { name: 'desktop', tier: 'high', use: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 } },
  { name: 'mobile', tier: 'low', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true } },
] as const;

/** Time for the HUD to show steady-state numbers instead of startup frames. */
const HUD_SETTLE_MS = 2500;

async function openSettled(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await window.__meadow?.settle();
  });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use(vp.use);
    for (const shot of SHOTS) {
      test(shot.name, async ({ page }) => {
        await openSettled(page, `${shot.hash}&q=${vp.tier}&hud=1&t=${FROZEN_T}`);
        // Time is frozen, so waiting changes no pixels of the world, only the HUD averages.
        await page.waitForTimeout(HUD_SETTLE_MS);
        await page.screenshot({ path: `shots/${vp.name}-${shot.name}.png` });
      });
    }
  });
}
