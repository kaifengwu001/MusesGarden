import { expect, test, type Page } from '@playwright/test';

// The photo studio (studio.ts) on each world that is a destination, and on the meadow with a friend: `?studio`, with
// no server and no ticket (the sample backend playwright.visit.config.ts starts is never asked). Each: the studio's
// panel there and the page's own interface out of sight, both Muses drawn, a face and an answer set from the studio
// showing on the host's pose, a part of its day and a posture of the guest's where the page offers them, C putting
// the panel away and T holding the time.

/** Each page, its host, and the face it is given (Violet Dunes' Muse draws only the eyes and the smile). */
const PAGES: readonly { readonly path: string; readonly planet: string; readonly host: string; readonly guest: string; readonly face: string; readonly shows: Record<string, number> }[] = [
  ...(['golden-rye', 'cherry-blossom-waterways', 'sequoia-shrine', 'tulip-windmill-meadows', 'scarlet-sail-canyon', 'cobalt-windfields', 'lantern-reed-gardens'] as const).map((planet) => ({
    path: `/environments/${planet}/?studio`,
    planet,
    host: { 'golden-rye': 'Kiki', 'cherry-blossom-waterways': 'Hoji', 'sequoia-shrine': 'Fife', 'tulip-windmill-meadows': 'Van', 'scarlet-sail-canyon': 'Potato', 'cobalt-windfields': 'Dorie', 'lantern-reed-gardens': 'Pooh' }[planet],
    guest: 'Momo',
    face: 'happy squint ∩',
    shows: { eyes: 1, smile: 1, squint: 1, squeeze: 0 },
  })),
  { path: '/environments/violet-dunes/?studio', planet: 'violet-dunes', host: 'Moss', guest: 'Momo', face: 'beaming', shows: { eyes: 1, smile: 1 } },
  { path: '/?studio&with=muse6', planet: 'meadow', host: 'Momo', guest: 'Hoji', face: 'happy squint ∩', shows: { eyes: 1, smile: 1, squint: 1, squeeze: 0 } },
];

interface SitterState {
  readonly name: string;
  readonly doings: readonly string[];
  readonly answers: readonly string[];
  readonly faces: readonly string[];
}

interface StudioProbe {
  readonly ready: Promise<void>;
  state(): { readonly planet: string; readonly panel: boolean; readonly hold: boolean; readonly moment: number; readonly host: SitterState; readonly guest: SitterState | null };
  set(role: 'host' | 'guest', what: Record<string, string>): void;
  hold(on: boolean): void;
  flying(): boolean;
}

interface MuseProbe {
  readonly drawn: boolean;
  readonly living: { readonly action: { readonly wave: number; readonly moves?: readonly { readonly kind: string }[] } } | null;
  readonly pose?: Record<string, number> & { readonly held: { readonly moves?: readonly { readonly kind: string }[] } | null };
}

type Probed = { __studio: StudioProbe; __world: { muse: MuseProbe; visitors: MuseProbe[] } };

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => (window as unknown as { __studio?: unknown }).__studio !== undefined, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as Probed).__studio.ready);
  await page.waitForFunction(() => !(window as unknown as Probed).__studio.flying(), undefined, { timeout: 30_000 });
}

for (const p of PAGES) {
  test(`the photo studio on ${p.planet}: its panel alone over the planet, both Muses drawn, faces and doings held on them`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await open(page, p.path);
    // the studio's panel, and none of the page's own: its title, hints and controls, its HUD, its Parameters panel
    await expect(page.locator('.studio-panel')).toBeVisible();
    await expect(page.locator('#ui')).toBeHidden();
    await expect(page.locator('.meadow-panel')).toBeHidden();
    await expect(page.locator('.visit-banner, .visit-rail')).toHaveCount(0);
    const s = await page.evaluate(() => (window as unknown as Probed).__studio.state());
    expect(s).toMatchObject({ planet: p.planet, panel: true, host: { name: p.host }, guest: { name: p.guest } });
    expect(s.host.faces).toContain(p.face);
    // both Muses drawn, side by side
    await page.waitForTimeout(500);
    const drawn = await page.evaluate(() => {
      const w = (window as unknown as Probed).__world;
      return { host: w.muse.drawn, guests: w.visitors.map((v) => v.drawn) };
    });
    expect(drawn).toEqual({ host: true, guests: [true] });

    // a face held on the host's pose
    await page.evaluate((face) => (window as unknown as Probed).__studio.set('host', { face }), p.face);
    await page.waitForFunction((shows) => {
      const pose = (window as unknown as Probed).__world.muse.pose;
      return pose?.held !== null && Object.entries(shows).every(([k, v]) => pose?.[k] === v);
    }, p.shows, { timeout: 10_000 });
    // its answer, the time held at its moment: waving, its arm a second and more into the wave
    await page.evaluate(() => {
      const studio = (window as unknown as Probed).__studio;
      studio.hold(true);
      studio.set('host', { answer: 'waving' });
    });
    await page.waitForFunction(() => {
      const wave = (window as unknown as Probed).__world.muse.living?.action.wave ?? -1;
      return wave > 1 && wave < 1.4;
    }, undefined, { timeout: 10_000 });

    // a part of its day, sought (the bench, where its day has one), and the guest sat down beside it
    if (s.host.doings.includes('on the bench')) {
      await page.evaluate(() => (window as unknown as Probed).__studio.set('host', { answer: 'none', doing: 'on the bench' }));
      await page.waitForFunction(() => (window as unknown as Probed).__world.muse.living?.action.moves?.some((m) => m.kind === 'perch') === true, undefined, { timeout: 10_000 });
    }
    if (s.guest?.doings.includes('sitting in the grass')) {
      await page.evaluate(() => (window as unknown as Probed).__studio.set('guest', { doing: 'sitting in the grass' }));
      await page.waitForFunction(() => (window as unknown as Probed).__world.visitors[0].pose?.held?.moves?.[0]?.kind === 'sit', undefined, { timeout: 10_000 });
    }

    // C puts the panel away and brings it back; T lets the time run on and holds it again
    await page.keyboard.press('c');
    await expect(page.locator('.studio-panel')).toBeHidden();
    await page.keyboard.press('c');
    await expect(page.locator('.studio-panel')).toBeVisible();
    await page.keyboard.press('t');
    expect(await page.evaluate(() => (window as unknown as Probed).__studio.state().hold)).toBe(false);
    await page.keyboard.press('t');
    expect(await page.evaluate(() => (window as unknown as Probed).__studio.state().hold)).toBe(true);
    expect(errors).toEqual([]);
  });
}
