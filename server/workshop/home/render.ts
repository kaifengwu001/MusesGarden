// The hut's cutaway rendered headless (as tools/workflows/drive-app/scripts/hut.mjs does it): the room with only the
// pieces a home keeps standing, for the picture Muse's things are drawn into, with how the camera sees the floor;
// and the room as furnished. A stub stands in for tests and WORKSHOP_FAKE=1.
import sharp from 'sharp';
import { ANCHORS, proportionalRoom, ROOM, type RoomInfo } from './place';

export interface RoomShot {
  /** The cutaway, PNG. */
  readonly png: Buffer;
  readonly info: RoomInfo;
}

export interface HomeRenderer {
  /** The room seen through the cutaway with only `keep` standing (and the rug): its picture, the camera's view of the floor and what stands. `page` is a world's page path ('/', '/environments/muse-pooh/'). */
  room(req: { readonly page: string; readonly keep: readonly string[]; readonly signal: AbortSignal }): Promise<RoomShot>;
  /** The room as its world furnishes it (home.json in the fork). */
  furnished(req: { readonly page: string; readonly signal: AbortSignal }): Promise<Buffer>;
}

/** The view's size (CSS px, at 1×): the cutaway's own framing in hut.mjs. */
const VIEWPORT = { width: 1405, height: 860 } as const;
/** How long a render may take, all in (ms). */
const TIMEOUT = 150_000;

/**
 * In the page (plain JS, run by Playwright): into the hut with Muse asleep on its bed (out of the floor's way), the
 * furniture loaded and the rise over; only `keep` standing when given (the page's own copy of the pieces is changed,
 * nothing else); the garden's controls hidden. Then the floor's
 * corners and middles, and the same a metre up, as the camera puts them in the picture (0 … 1), and the kept pieces'
 * footprints (local m), for placing what Muse's picture adds.
 */
const IN_PAGE = `async ({ keep, room }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const m = window.__meadow;
  m.preset('homestead');
  await m.settle();
  await m.settle();
  const g = window.__garden;
  g.hut('sleep', true);
  for (let k = 0; k < 120; k++) { const s = g.inHut(); if (s.open && s.loaded) break; await sleep(500); }
  const c = g.cutaway;
  const w = c.world;
  const hut = w.hut;
  if (keep) {
    // (what isn't kept goes, with its lamp and the shade round its foot)
    for (const lamp of hut.uniforms.uLamps.value) lamp.w = 0;
    for (const p of hut.pieces) if (p.piece && !keep.includes(p.name)) { p.piece.glow = undefined; p.piece.rests = false; }
    hut.refresh();
    for (const mesh of hut.furniture) if (mesh.name !== 'rug') mesh.visible = keep.includes(mesh.name);
  }
  const style = document.createElement('style');
  style.textContent = 'body > :not(canvas) { opacity: 0 !important; }';
  document.head.append(style);
  await sleep(1800);
  const cam = w.rig.camera;
  const V = cam.position.constructor;
  const samples = [];
  for (const y of [0, 1]) for (const x of [-room.x, -room.x / 2, 0, room.x / 2, room.x]) for (const z of [-room.z, 0, room.z]) {
    const p = c.local(x, room.floor + y, z, new V()).project(cam);
    samples.push({ x, z, y, u: (p.x + 1) / 2, v: (1 - p.y) / 2 });
  }
  const anchors = [];
  for (const p of hut.pieces) {
    if (!p.piece || (keep && !keep.includes(p.name))) continue;
    const b = p.box.clone().applyMatrix4(p.place.value);
    anchors.push({ name: p.name, rect: { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }, top: b.max.y - room.floor });
  }
  const box = hut.showpieceBox(hut.pieces[0].box.clone());
  const showpiece = box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  return { samples, anchors, showpiece, state: g.inHut() };
}`;

/** The renderer that drives the page on the dev server (npm run dev) in headless Chromium on the GPU. */
export function browserRenderer(devServer: string): HomeRenderer {
  const shoot = async (page: string, keep: readonly string[] | null, signal: AbortSignal): Promise<{ png: Buffer; info: RoomInfo | null }> => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
    const stop = (): void => void browser.close();
    signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, TIMEOUT);
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      const tab = await ctx.newPage();
      const errors: string[] = [];
      tab.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      await tab.goto(`${devServer.replace(/\/+$/, '')}${page}#t=40&q=high&hud=0`);
      await tab.waitForFunction('window.__meadow?.isReady === true', undefined, { timeout: 120_000 });
      const out = await tab.evaluate<RoomInfo & { state: { open: boolean; loaded: boolean } }>(`(${IN_PAGE})(${JSON.stringify({ keep, room: ROOM })})`);
      if (!out.state.open || !out.state.loaded) throw new Error(`the hut didn't open (${errors.join('; ') || 'no page errors'})`);
      const png = await tab.screenshot({ type: 'png' });
      return { png, info: { samples: out.samples, anchors: out.anchors, showpiece: out.showpiece } };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      await browser.close().catch(() => undefined);
    }
  };
  return {
    room: async ({ page, keep, signal }) => {
      const { png, info } = await shoot(page, keep, signal);
      return { png, info: info ?? proportionalRoom() };
    },
    furnished: async ({ page, signal }) => (await shoot(page, null, signal)).png,
  };
}

/** A stand-in: a plain warm room picture the view's size, the floor laid on it proportionally, the meadow's anchors. */
export function stubRenderer(picture?: Buffer): HomeRenderer {
  const plain = (): Promise<Buffer> =>
    picture ? Promise.resolve(picture) : sharp({ create: { width: VIEWPORT.width, height: VIEWPORT.height, channels: 3, background: { r: 196, g: 150, b: 104 } } }).png().toBuffer();
  return {
    room: async () => ({ png: await plain(), info: { ...proportionalRoom(), anchors: ANCHORS } }),
    furnished: () => plain(),
  };
}
