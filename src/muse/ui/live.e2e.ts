import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type {} from '../../dev/harnessApi';
import type { Dir, MuseId, NowView } from '../contract';
import { dirAlong } from './route';

// The dev tools on the real engine, over the garden's interface: advance the clock from the dev tools, and the 3D
// Muse goes where the engine's view says. Screenshots for a human eye go to shots/muse-live/.

const API = 'http://localhost:8787/api';
const SHOTS = 'shots/muse-live';
const HERO = 'hero' as MuseId;
/** Out on the planet the drawn Muse walks toward the engine's spot and never lags it by more than a jump (rad, body.ts). */
const JUMP = 0.1;

type Kind = 'home' | 'out' | 'hidden';

async function get<T>(api: APIRequestContext, path: string): Promise<T> {
  const r = await api.get(`${API}${path}`);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

/** What the engine's view says of Muse: away (beyond, or at a friend's) is hidden, a trip is out on the planet, the rest at home. */
function expected(view: NowView): { kind: Kind; dir: Dir | null } {
  if (view.away) return { kind: 'hidden', dir: null };
  const dir = view.activity === 'travel' && view.path ? dirAlong(view.path, view.at) : null;
  return dir ? { kind: 'out', dir } : { kind: 'home', dir: null };
}

/** The 3D Muse as the world has it this frame (dev builds expose the world). */
const drawn = (page: Page) =>
  page.evaluate(() => {
    type Muse = { away: boolean; home: boolean; where: { dir: { toArray(): number[] } } };
    const muse = (window as unknown as { __world?: { muse: Muse } }).__world?.muse;
    return muse ? { away: muse.away, home: muse.home, dir: muse.where.dir.toArray() as [number, number, number] } : null;
  });

const angle = (a: readonly number[], b: readonly number[]): number => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

/** Whether the drawn Muse matches the engine's view; a description of the mismatch otherwise. */
async function follows(page: Page, want: { kind: Kind; dir: Dir | null }): Promise<true | string> {
  const muse = await drawn(page);
  if (!muse) return 'no world';
  if (want.kind === 'hidden') return muse.away || 'drawn while away';
  if (muse.away) return `hidden while ${want.kind}`;
  if (want.kind === 'out' && want.dir) {
    const off = angle(muse.dir, want.dir);
    return (!muse.home && off <= JUMP + 1e-3) || `out, but ${off.toFixed(3)} rad from the engine's spot (home: ${muse.home})`;
  }
  return true;
}

test('the dev tools drive the engine, and the 3D Muse follows it', async ({ page, request: api }) => {
  const muses = await get<{ museId: MuseId }[]>(api, '/muses');
  expect(muses.map((m) => m.museId)).toContain(HERO);

  await page.goto(`/?dev&garden=/api/muses/${HERO}#hud=0`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  const dev = page.locator('.mu-dev');
  await expect(dev).toBeVisible();
  await expect(page.locator('.garden .g-rail')).toBeVisible();
  await expect(dev.locator('.mu-dev-head')).toContainText(HERO);
  await expect(dev.getByText(/^Sim time \S/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-dev-tools.png` });

  const hours = dev.getByLabel('Hours to advance');
  await hours.fill('1');
  const seen = new Set<Kind>();
  const spots: number[][] = [];
  for (let h = 0; h <= 48 && !(seen.has('out') && seen.size > 1); h++) {
    if (h > 0) {
      const before = await get<{ now: number }>(api, '/dev/clock');
      await dev.getByRole('button', { name: 'Advance' }).click();
      await expect.poll(async () => (await get<{ now: number }>(api, '/dev/clock')).now).toBe(before.now + 3_600_000);
    }
    const view = await get<NowView>(api, `/muses/${HERO}/now`);
    const want = expected(view);
    await expect.poll(() => follows(page, want), { message: `after ${h} h, ${view.label}` }).toBe(true);
    const muse = await drawn(page);
    if (muse && !muse.away) spots.push(muse.dir);
    if (!seen.has(want.kind)) await page.screenshot({ path: `${SHOTS}/02-${h}h-${want.kind}.png` });
    seen.add(want.kind);
  }
  expect([...seen], 'the hours advanced took Muse out on the planet, and home or away').toContain('out');
  expect(seen.size).toBeGreaterThan(1);
  expect(Math.max(...spots.map((s) => angle(s, spots[0]))), 'the 3D Muse moved').toBeGreaterThan(1e-3);
});
