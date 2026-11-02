import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

// `npm run lock`: canvas hashes of fixed views at frozen time, the HUD off (its
// live numbers would differ run to run). `LOCK_BASELINE=<hashes.json>` fails on
// any view whose pixels differ from that earlier run's: the proof that a change
// left a world as it was. Hashes are only comparable on one machine and GL backend.

type Preset = 'homestead' | 'lakes' | 'meadow' | 'vista' | 'muse';

interface View {
  readonly name: string;
  readonly hash: string;
  readonly preset?: Preset;
}

interface Device {
  readonly name: string;
  readonly tier: 'low' | 'medium' | 'high';
  readonly viewport: { width: number; height: number };
  readonly deviceScaleFactor: number;
  readonly views: readonly View[];
}

const FROZEN_T = 12;
const OUT = 'shots/lantern-reed-gardens/lock';

const DEVICES: readonly Device[] = [
  {
    name: 'desktop',
    tier: 'high',
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    views: [
      { name: 'overview', hash: 'cam=overview' },
      { name: 'wander', hash: 'cam=wander' },
      { name: 'homestead', hash: '', preset: 'homestead' },
      { name: 'lakes', hash: '', preset: 'lakes' },
      { name: 'vista', hash: '', preset: 'vista' },
      { name: 'meadow-from-above', hash: '', preset: 'meadow' },
      { name: 'muse', hash: '', preset: 'muse' },
      { name: 'seedling-R40', hash: 'g=0&b=0.35' },
      { name: 'wide-R400', hash: 'g=1&b=1' },
      { name: 'wide-R400-wander', hash: 'g=1&b=1&cam=wander' },
      { name: 'cloudy', hash: 'cc=0.8', preset: 'vista' },
      { name: 'bloom-front', hash: 'b=0.18', preset: 'meadow' },
      { name: 'seed5-overview', hash: 'seed=5&cam=overview' },
      { name: 'seed5-homestead', hash: 'seed=5', preset: 'homestead' },
      { name: 'sliders', hash: 'roll=2.5&wet=0.7&lvl=0.3&fp=0.6&fb=0.4&fd=20', preset: 'lakes' },
    ],
  },
  {
    name: 'medium',
    tier: 'medium',
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    views: [{ name: 'wander', hash: 'cam=wander' }],
  },
  {
    name: 'mobile',
    tier: 'low',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.5,
    views: [
      { name: 'overview', hash: 'cam=overview' },
      { name: 'wander', hash: 'cam=wander' },
      { name: 'homestead', hash: '', preset: 'homestead' },
    ],
  },
];

async function capture(browser: Browser, device: Device, view: View): Promise<string> {
  const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor });
  const page = await context.newPage();
  const state = [view.hash, `q=${device.tier}`, 'hud=0', `t=${FROZEN_T}`].filter(Boolean).join('&');
  await page.goto(`/environments/lantern-reed-gardens/#${state}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  const hash = await page.evaluate(async (preset) => {
    const m = window.__meadow;
    if (!m) throw new Error('harness missing');
    await document.fonts.ready;
    m.setScale(1);
    if (preset) m.preset(preset);
    await m.settle();
    await m.settle();
    return m.frameHash();
  }, view.preset);
  await page.screenshot({ path: `${OUT}/${device.name}-${view.name}.png` });
  await context.close();
  return hash;
}

test('frame lock', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const device of DEVICES) {
    for (const view of device.views) hashes[`${device.name}-${view.name}`] = await capture(browser, device, view);
  }
  writeFileSync(`${OUT}/hashes.json`, `${JSON.stringify(hashes, null, 2)}\n`);

  const baselinePath = process.env.LOCK_BASELINE;
  if (!baselinePath) return;
  expect(existsSync(baselinePath), `baseline ${baselinePath}`).toBe(true);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string>;
  const changed = Object.keys(baseline).filter((name) => hashes[name] !== baseline[name]);
  expect(changed, 'views whose pixels changed').toEqual([]);
});
