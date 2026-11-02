/// <reference types="vite/client" />
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';
import type { World } from '../world';
import type { FindBeds } from '../life/findBeds';
import type { FindForms } from '../life/findForms';
import type { GardenState } from '../garden/state';
import type { GardenLayout } from '../garden/placement';

interface Point { x: number; y: number; z: number }
interface ResidentProbe {
  id: string; name: string; activity: string;
  where: { dir: Point; height: number };
  muse: { mesh: { visible: boolean }; shadowMesh: { visible: boolean }; living: { action: { wave: number; walk: number } } };
}
interface WorldProbe {
  residents: { members: ResidentProbe[]; ready: Promise<void> };
  terrain: { height: (point: Point) => number; radius: number; layout: { seed: number } };
  growth: { radius: number };
  scenery: { group: { children: unknown[] } };
  followingResident: string | null;
  rig: { zoom: number };
}

test('reference overlook and three wildlife encounters render without meadow flowers', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 940 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await open(page);
  await page.getByRole('button', { name: 'Wind Window', exact: true }).click();
  await page.evaluate(async () => window.__meadow!.settle());
  const legacy = await page.evaluate(() => {
    const w = (window as unknown as { __world: { flowers: { meshes: { parent: unknown }[] }; grass: { mesh: { parent: unknown } }; petals: { mesh: { parent: unknown } } } }).__world;
    return [...w.flowers.meshes,w.grass.mesh,w.petals.mesh].every(mesh => mesh.parent === null);
  });
  expect(legacy).toBe(true);
  await page.screenshot({ path: 'shots/cobalt-windfields/reference-overlook.png' });
  await page.locator('#ui').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.screenshot({ path: 'shots/cobalt-windfields/reference-clean.png' });
  await page.locator('#ui').evaluate(element => { element.style.visibility = ''; });
  for (const [id, name] of [['sailback','Sailback'],['kitelet','Kitelet'],['sand-stitcher','Sand Stitcher']]) {
    await page.getByRole('button', { name: `Watch ${name}`, exact: true }).click();
    await page.evaluate(async () => window.__meadow!.settle());
    const result = await page.evaluate(() => {
      const w = (window as unknown as { __world: { followingWildlife: string; rig: { altitude: number }; wildlife: { group: { children: { name: string; visible: boolean }[] } } } }).__world;
      return { id: w.followingWildlife, altitude:w.rig.altitude, visible: w.wildlife.group.children.filter(c=>c.visible).map(c=>c.name) };
    });
    expect(result.id).toBe(id);
    expect(result.altitude).toBeGreaterThan(0.3);
    expect(result.altitude).toBeLessThan(4.0);
    expect(result.visible).toContain(`${id} bodies`);
    await page.screenshot({ path: `shots/cobalt-windfields/${id}.png` });
  }
  expect(errors).toEqual([]);
});

async function open(page: Page, hash = 'q=high&t=12&hud=0'): Promise<void> {
  await page.goto(`/environments/cobalt-windfields/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await page.evaluate(async () => window.__meadow?.settle());
}

test('saved native finds render rooted coral and sails, with working ID-based selection', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 940 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  const empty = {
    muse: { name: 'Muse', soul: 'Quiet.', status: { home: true } },
    interests: [0, 1, 2, 3].map(species => ({ id: `native-topic-${species}`, name: `Native topic ${species}`, species, variant: 0.3, shared: true, since: '2026-11-01' })),
    friends: [], baskets: [], finds: [], postcards: [],
  };
  // Every request uses a local Playwright fixture; this test has no backend
  // writes and does not change a real user's saved findings.
  await page.route('**/native-find-fixture/garden', route => route.fulfill({ json: empty }));
  await page.route('**/native-find-fixture/garden/events', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 3600000\n\n' }));
  await page.goto('/environments/cobalt-windfields/?garden=/native-find-fixture#q=high&t=12&hud=0');
  interface NativeGardenProbe {
    state: GardenState;
    ui: { world: World; beds: FindBeds };
    forms: FindForms;
    layout(): GardenLayout;
    open(id: string): void;
  }
  await page.waitForFunction(() => window.__meadow?.isReady && (window as unknown as { __garden?: NativeGardenProbe }).__garden?.state.snapshot, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = (window as unknown as { __garden: NativeGardenProbe }).__garden;
    const terrain = g.ui.world.terrain, home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const across = home.clone().cross(forward).normalize();
    const basket = { id: 'native-local-basket', day: '2026-11-01', title: 'Local native-plant check', finds: ['native-kept-coral', 'native-kept-sail'] };
    const finds = [[6.5, 44], [7, 41.8]].map(([x, z], index) => {
      const d = Math.hypot(x, z), angle = Math.asin(d / terrain.radius);
      const dir = home.clone().multiplyScalar(Math.cos(angle)).addScaledVector(across, x / d * Math.sin(angle)).addScaledVector(forward, z / d * Math.sin(angle)).normalize();
      return { id: basket.finds[index], basket: basket.id, topic: `native-topic-${index}`, media: { kind: 'article' as const, url: 'https://example.invalid/local-native-fixture', source: 'Local fixture', title: index ? 'Saved sail finding' : 'Saved coral finding', text: 'A local fixture for the native plant renderer.' }, shared: false, place: [dir.x, dir.y, dir.z] as const };
    });
    g.state.setPins(false);
    g.state.receive({ type: 'basket', basket, finds });
    g.state.visit(basket.id);
    g.open('native-kept-coral');
  });
  await expect(page.getByRole('heading', { name: 'Saved coral finding', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => window.__meadow!.settle());
  const proof = await page.evaluate(() => {
    const g = (window as unknown as { __garden: NativeGardenProbe }).__garden;
    const world = g.ui.world, beds = g.ui.beds;
    const local = g.forms.specimens.geometry.getAttribute('aLocal');
    const parts = [...new Set(Array.from({ length: local.count }, (_, i) => Math.floor(local.getW(i) / 4096)))];
    const anchors = [...g.layout().beds.values()].map(bed => ({ id: bed.find, error: Math.abs(bed.ground - world.terrain.height(bed.dir)), norm: bed.dir.length() }));
    const meshes = beds.meshes.filter(mesh => mesh.geometry.instanceCount > 0);
    const bedProof = meshes.map(mesh => {
      const p = mesh.geometry.getAttribute('position');
      return { name: mesh.geometry.name, visible: mesh.visible, count: mesh.geometry.instanceCount, kinds: [...new Set(Array.from(mesh.geometry.getAttribute('aPart').array))], root: Math.min(...Array.from({ length: p.count }, (_, i) => p.getY(i))), groundInShader: mesh.material.vertexShader.includes('height0(dir) + uBank.x') };
    });
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const harness = window.__meadow;
    if (!gl || !harness) throw new Error('WebGL harness is unavailable');
    const read = (): Uint8Array => {
      harness.renderFrame();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const changed = (a: Uint8Array, b: Uint8Array): number => {
      let count = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) count++;
      return count;
    };
    const bodyVisible = g.forms.specimens.visible;
    // renderFrame runs the garden update, which owns mesh.visible. Isolate
    // submitted geometry instead, so that update cannot undo the pixel probe.
    const specimen = g.forms.specimens.geometry, spheres = g.forms.spheres.geometry;
    const geometry = [specimen, spheres, ...meshes.map(mesh => mesh.geometry)];
    const ranges = new Map(geometry.map(item => [item, { ...item.drawRange }]));
    const restore = (item: typeof specimen): void => {
      const range = ranges.get(item)!;
      item.setDrawRange(range.start, range.count);
    };
    let specimenPixels: number, bedPixels: number;
    try {
      for (const item of geometry) item.setDrawRange(0, 0);
      const emptyFrame = read();
      restore(specimen);
      specimenPixels = changed(emptyFrame, read());
      specimen.setDrawRange(0, 0);
      for (const mesh of meshes) restore(mesh.geometry);
      bedPixels = changed(emptyFrame, read());
    } finally {
      for (const item of geometry) restore(item);
      harness.renderFrame();
    }
    return { anchors, bedProof, parts, bodyVisible, specimenPixels, bedPixels, glError: gl.getError(), groundInSpecimenShader: g.forms.specimens.material.vertexShader.includes('height0(f.dir) + uBank.x'), kept: g.state.find('native-kept-coral')?.id, topic: g.state.find('native-kept-coral')?.topic };
  });
  expect(proof.kept).toBe('native-kept-coral');
  expect(proof.topic).toBe('native-topic-0');
  expect(proof.anchors).toHaveLength(2);
  for (const anchor of proof.anchors) { expect(anchor.error, anchor.id).toBeLessThan(0.02); expect(anchor.norm).toBeCloseTo(1, 6); }
  expect(proof.bodyVisible).toBe(true);
  expect(proof.groundInSpecimenShader).toBe(true);
  expect(proof.parts.every(part => [0, 1, 2, 5].includes(part))).toBe(true);
  expect(proof.bedProof.length).toBeGreaterThanOrEqual(2);
  for (const bed of proof.bedProof) {
    expect(bed.name).toContain('Cobalt find-bed'); expect(bed.visible).toBe(true); expect(bed.groundInShader).toBe(true);
    expect(bed.root).toBeGreaterThan(-0.015); expect(bed.root).toBeLessThanOrEqual(0.001);
    expect(bed.kinds.every(part => [0, 1, 2].includes(part))).toBe(true);
  }
  // Actual changed framebuffer pixels prove both layers draw in the subject
  // view; mesh.visible alone would also pass for an offscreen/empty draw.
  expect(proof.specimenPixels).toBeGreaterThan(150);
  expect(proof.bedPixels).toBeGreaterThan(150);
  expect(proof.glError).toBe(0);
  await page.locator('#ui').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.screenshot({ path: 'shots/cobalt-windfields/native-finds.png' });
  expect(errors).toEqual([]);
});

test('a living settlement renders with all three residents and no shader errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await open(page);
  await page.getByRole('button', { name: 'Shelter', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const probe = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    return {
      residents: w.residents.members.map(r => ({ id: r.id, visible: r.muse.mesh.visible, activity: r.activity, height: r.where.height, ground: w.terrain.height(r.where.dir) })),
      objects: w.scenery.group.children.length,
      stats: window.__meadow?.stats(),
    };
  });
  expect(probe.residents).toHaveLength(3);
  expect(probe.objects).toBeGreaterThan(0);
  for (const resident of probe.residents) {
    expect(resident.visible, resident.id).toBe(true);
    expect(Math.abs(resident.height - resident.ground), resident.id).toBeLessThan(0.03);
  }
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'renderer', description: JSON.stringify(probe.stats) });
  await page.screenshot({ path: 'shots/cobalt-windfields/settlement.png' });
});

test('find, greet, rename and reload a resident without changing meadow storage', async ({ page }) => {
  await open(page, 'q=medium&hud=0');
  const original = 'meadow-preferences-untouched';
  await page.evaluate(value => localStorage.setItem('muses-garden.garden.v1', value), original);
  await page.getByRole('button', { name: 'Meet Pip', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.residents.members[0].activity)).toMatch(/hello|greet|wave|waving/i);
  await page.getByRole('textbox', { name: 'Resident name' }).fill('Pippa');
  await page.getByRole('textbox', { name: 'Resident name' }).press('Tab');
  await expect(page.getByRole('button', { name: 'Meet Pippa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.followingResident)).toBeNull();
  await page.evaluate(async () => window.__meadow?.settle());
  expect(await page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.rig.zoom)).toBe(0);
  await page.reload();
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Meet Pippa', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('muses-garden.garden.v1'))).toBe(original);
});

test('residents remain grounded through growth and seed changes', async ({ page }) => {
  await open(page, 'q=medium&t=22&hud=0');
  for (const seed of [412, 5]) {
    for (const growth of [0, 1, 0.3]) {
      const residents = await page.evaluate(async ({ seed, growth }) => {
        const h = window.__meadow!;
        h.set('world.seed', seed);
        h.set('world.growth', growth);
        await h.settle();
        const w = (window as unknown as { __world: WorldProbe }).__world;
        return w.residents.members.map(r => ({ id: r.id, height: r.where.height, ground: w.terrain.height(r.where.dir), norm: Math.hypot(r.where.dir.x, r.where.dir.y, r.where.dir.z) }));
      }, { seed, growth });
      for (const r of residents) {
        expect(r.norm).toBeCloseTo(1, 5);
        expect(Number.isFinite(r.height)).toBe(true);
        expect(Math.abs(r.height - r.ground)).toBeLessThan(0.03);
      }
    }
  }
});

test('planet and Wind Window views work on desktop and a narrow viewport', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Whole planet', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/cobalt-windfields/planet.png' });
  await page.getByRole('button', { name: 'Wind Window', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/cobalt-windfields/wind-window.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Meet Juniper', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await expect(page.getByRole('button', { name: 'Say hello', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const panel = await page.locator('.windfield-community').boundingBox();
  const mailbox = await page.locator('.g-postbox').boundingBox();
  expect(mailbox!.y + mailbox!.height).toBeLessThan(panel!.y);
  await page.screenshot({ path: 'shots/cobalt-windfields/mobile-resident.png' });
});

test('review angles expose the same rocks and plants from ground level and the reverse side', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 940 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await open(page, 'q=high&t=12&hud=0&pose=0.1433,-0.2868,0.6666,0.6729,0.766');
  await page.locator('#ui').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.screenshot({ path: 'shots/cobalt-windfields/previous-user-angle.png' });
  for (const shot of [
    { name: 'material-close', x: 1, z: 39, tx: -4, tz: 42, height: 2.2, depression: 0.32 },
    { name: 'reverse-ground', x: -2, z: 23, tx: 7, tz: 47, height: 3.5, depression: 0.20 },
    { name: 'shelter-floor', x: 7, z: 8, tx: 0, tz: 0, height: 6.0, depression: 0.62 },
  ]) {
    await page.evaluate(async shot => {
      const w = (window as unknown as { __world: World }).__world;
      w.stopFollowing();
      const L = w.terrain.layout, R = w.terrain.radius;
      const right = L.cottage.clone().cross(L.homeBearing).normalize();
      const at = (x: number, z: number) => {
        const d = Math.hypot(x, z), a = Math.asin(Math.min(0.92, d / R));
        return L.cottage.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, x / (d || 1) * Math.sin(a)).addScaledVector(L.homeBearing, z / (d || 1) * Math.sin(a)).normalize();
      };
      const focus = at(shot.x, shot.z), target = at(shot.tx, shot.tz);
      w.rig.lookAlong(focus, target.clone().addScaledVector(focus, -target.dot(focus)).normalize(), true);
      const zoom = w.rig.zoomForAltitude(shot.height);
      w.rig.setZoom(zoom, true);
      w.rig.lookUp(Math.PI / 2 - shot.depression - w.rig.framing(zoom).tilt, true);
      await window.__meadow!.settle();
    }, shot);
    await page.screenshot({ path: `shots/cobalt-windfields/${shot.name}.png` });
  }
  expect(errors).toEqual([]);
});
