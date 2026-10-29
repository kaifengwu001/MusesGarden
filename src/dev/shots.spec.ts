import { test, type Page } from '@playwright/test';
import type {} from './harnessApi';

// `npm run shots`: fixed seeds, sizes, lights and camera views rendered at
// frozen time into /shots. Each shot pins its quality tier, so a capture never
// depends on the benchmark of the machine that ran it.

const FROZEN_T = 12;

type Preset = 'homestead' | 'range' | 'meadow';
interface Shot {
  name: string;
  hash: string;
  preset?: Preset;
}

const DESKTOP: Shot[] = [
  { name: 'overview', hash: 'cam=overview' },
  { name: 'wander', hash: 'cam=wander' },
  { name: 'homestead', hash: '', preset: 'homestead' },
  { name: 'range', hash: '', preset: 'range' },
  { name: 'meadow-from-above', hash: '', preset: 'meadow' },
  { name: 'seedling-R40', hash: 'g=0&b=0.35' },
  { name: 'wide-R400', hash: 'g=1&b=1' },
  { name: 'wide-R400-wander', hash: 'g=1&b=1&cam=wander' },
  { name: 'golden-hour', hash: 'tod=18.4', preset: 'homestead' },
  { name: 'dawn', hash: 'tod=6.3&cc=0.62&cb=0.9' },
  { name: 'bloom-front', hash: 'b=0.18', preset: 'meadow' },
  { name: 'postcard', hash: 'pc=1', preset: 'homestead' },
];

const MOBILE: Shot[] = [
  { name: 'overview', hash: 'cam=overview' },
  { name: 'wander', hash: 'cam=wander' },
  { name: 'homestead', hash: '', preset: 'homestead' },
];

const VIEWPORTS = [
  { name: 'desktop', tier: 'high', shots: DESKTOP, use: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 } },
  { name: 'mobile', tier: 'low', shots: MOBILE, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true } },
] as const;

/** Time for the HUD to show steady-state numbers instead of startup frames. */
const HUD_SETTLE_MS = 2000;

async function openSettled(page: Page, hash: string, preset?: Preset): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  await page.evaluate(async (preset) => {
    await document.fonts.ready;
    if (preset) window.__meadow?.preset(preset);
    await window.__meadow?.settle();
    await window.__meadow?.settle();
  }, preset);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use(vp.use);
    for (const shot of vp.shots) {
      test(shot.name, async ({ page }) => {
        const hud = shot.name === 'postcard' ? 'hud=0' : 'hud=1';
        await openSettled(page, `${shot.hash}&q=${vp.tier}&${hud}&t=${FROZEN_T}`.replace(/^&/, ''), shot.preset);
        // Time is frozen, so waiting changes no pixels of the world, only the HUD averages.
        await page.waitForTimeout(HUD_SETTLE_MS);
        await page.screenshot({ path: `shots/${vp.name}-${shot.name}.png` });
      });
    }
  });
}
