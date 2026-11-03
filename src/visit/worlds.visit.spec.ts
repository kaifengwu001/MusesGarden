import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { MuseLook, PlanetId, VisitWorldView } from '../muse/contract';
import { sampleVisit } from '../muse/samples';

// A visit on each world that is a destination (environments/<x>/visit.ts), on the sample backend
// (playwright.visit.config.ts): the sample visit, as the backend serves it, with its planet set to the world, its host
// the friend who lives there (that friend's seed, server/fixtures/cast.json) and both Muses in clothes. The view is
// answered here, so these tests stand apart from the backend's clock, which visit.spec.ts moves on. Each: ready, both
// Muses together, drawn and in their clothes, the guest on its host's footing, every plant planted on dry ground, and a
// public find's card. VISIT_STILLS=<dir> keeps a still of each visit, the camera on the two Muses.

const TICKET = 'inv-wren-hero-1';
const HOST_LOOK: MuseLook = 'muse8';
const GUEST_LOOK: MuseLook = 'muse5';

/** Each destination and its host: the friend who lives there and its seed. */
const WORLDS: readonly { readonly planet: PlanetId; readonly host: string; readonly name: string; readonly seed: number }[] = [
  { planet: 'lantern-reed-gardens', host: 'lark', name: 'Lark', seed: 5512 },
  { planet: 'scarlet-sail-canyon', host: 'clover', name: 'Clover', seed: 3157 },
  { planet: 'cobalt-windfields', host: 'moss', name: 'Moss', seed: 2389 },
  { planet: 'tulip-windmill-meadows', host: 'sorrel', name: 'Sorrel', seed: 8846 },
  { planet: 'golden-rye', host: 'thistle', name: 'Thistle', seed: 9031 },
  { planet: 'cherry-blossom-waterways', host: 'juniper', name: 'Juniper', seed: 7703 },
  { planet: 'sequoia-shrine', host: 'bramble', name: 'Bramble', seed: 6624 },
  { planet: 'violet-dunes', host: 'wren', name: 'Wren', seed: 4271 },
];

interface VisitState {
  readonly phase: string;
  readonly planet: string;
  readonly together: boolean;
  readonly host: { readonly museId: string; readonly look: string } | null;
  readonly guest: { readonly museId: string; readonly look: string; readonly shown: boolean; readonly apart: number | null } | null;
  readonly plants: readonly { readonly id: string; readonly placed: boolean; readonly water: number | null }[];
  readonly card: string | null;
}

interface VisitProbe {
  readonly ready: Promise<void>;
  state(): VisitState;
  flying(): boolean;
  frameMuses(): void;
  open(id: string): void;
}

interface MuseProbe {
  readonly drawn: boolean;
  readonly where: { readonly dir: unknown; readonly height: number };
  readonly mesh: { readonly material: { readonly defines: Record<string, unknown> } };
  /** Its life on the planet: what it stands on at a place, a deck or a porch included (Violet Dunes' Muse has none). */
  readonly life?: { groundAt(dir: unknown): number };
}

interface WorldProbe {
  readonly muse: MuseProbe;
  readonly visitors: readonly MuseProbe[];
  readonly terrain: { height(dir: unknown): number };
}

/** The sample visit on a world: its planet, its host and both Muses' looks. */
function viewOn(world: (typeof WORLDS)[number]): VisitWorldView {
  return {
    ...sampleVisit,
    planet: world.planet,
    worldSeed: world.seed,
    host: { ...sampleVisit.host, museId: world.host as VisitWorldView['host']['museId'], name: world.name, look: HOST_LOOK, planet: world.planet },
    guest: { ...sampleVisit.guest, look: GUEST_LOOK },
  };
}

async function arrive(page: Page): Promise<VisitState> {
  await page.waitForFunction(() => (window as unknown as { __visit?: unknown }).__visit !== undefined, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.ready);
  return page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.state());
}

for (const world of WORLDS) {
  test(`a visit on ${world.planet}: both Muses together in their clothes, every plant on dry ground, a public find’s card`, async ({ page }) => {
    await page.route(`**/api/visits/${TICKET}/world*`, (route) => route.fulfill({ json: viewOn(world) }));
    await page.goto(`/environments/${world.planet}/?visit=${TICKET}&as=hero&garden=/api/muses/hero#hud=0`);
    const s = await arrive(page);
    expect(s).toMatchObject({ phase: 'visiting', planet: world.planet, together: true });
    expect(s.host).toMatchObject({ museId: world.host, look: HOST_LOOK });
    expect(s.guest).toMatchObject({ museId: 'hero', look: GUEST_LOOK, shown: true });
    expect(s.guest?.apart, 'the guest at its host’s side').toBeGreaterThan(0.3);
    expect(s.guest?.apart).toBeLessThan(3);
    expect(s.plants.length).toBe(sampleVisit.plants.length);
    for (const p of s.plants) {
      expect(p.placed, `${p.id} is planted`).toBe(true);
      expect(p.water, `${p.id} grows on dry ground`).toBeGreaterThan(0);
    }
    // the camera comes to the two Muses: both drawn, each in its clothes, the guest standing on what its host would
    // stand on there (a deck or a porch, not inside it)
    await page.waitForFunction(() => !(window as unknown as { __visit: VisitProbe }).__visit.flying(), undefined, { timeout: 30_000 });
    await page.waitForTimeout(500);
    const drawn = await page.evaluate(() => {
      const w = (window as unknown as { __world: WorldProbe }).__world;
      const dressed = (m: MuseProbe) => 'MUSE_PAINTED' in m.mesh.material.defines && 'MUSE_FEATURES' in m.mesh.material.defines;
      const ground = (dir: unknown) => (w.muse.life ? w.muse.life.groundAt(dir) : w.terrain.height(dir));
      const footing = (v: MuseProbe) => Math.abs(v.where.height - ground(v.where.dir)) < 0.01;
      return { host: w.muse.drawn, hostDressed: dressed(w.muse), guests: w.visitors.map((v) => ({ drawn: v.drawn, dressed: dressed(v), footed: footing(v) })) };
    });
    expect(drawn).toEqual({ host: true, hostDressed: true, guests: [{ drawn: true, dressed: true, footed: true }] });
    const stills = process.env.VISIT_STILLS;
    if (stills) {
      // (framed again on the two as they are now: the host may have moved on with its day since)
      await page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.frameMuses());
      await page.waitForFunction(() => !(window as unknown as { __visit: VisitProbe }).__visit.flying(), undefined, { timeout: 30_000 });
      await page.waitForTimeout(300);
      mkdirSync(stills, { recursive: true });
      await page.screenshot({ path: `${stills}/${world.planet}.png` });
    }
    // a public find opens its card over its bed in this world's beds
    const find = sampleVisit.plants.find((p) => p.card !== null)?.id as string;
    await page.evaluate((id) => (window as unknown as { __visit: VisitProbe }).__visit.open(id), find);
    await page.waitForFunction((id) => (window as unknown as { __visit: VisitProbe }).__visit.state().card === id, find, { timeout: 30_000 });
    await expect(page.locator('.visit .g-card')).toContainText(`${world.name}’s garden`);
  });
}
