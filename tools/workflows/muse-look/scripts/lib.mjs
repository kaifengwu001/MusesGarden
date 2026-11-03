// Shared by the muse-look scripts: find the dev server, open headless Chromium on the Mac's GPU
// (ANGLE on Metal: the desktop Browser pane is usually hidden and gets no animation frames),
// collect the page's errors, and wait for the meadow or the lab to be ready.
import { chromium } from '@playwright/test';

/** The dev server for this checkout: $BASE, else :5198 (where it usually runs), else :5173 (launch.json's "meadow"). */
export async function findBase() {
  const tries = [process.env.BASE, 'http://localhost:5198', 'http://localhost:5173'].filter(Boolean);
  for (const base of tries) {
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/src/dev/museLab.html`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return base.replace(/\/$/, '');
    } catch {
      // not there; try the next
    }
  }
  throw new Error(`no dev server at ${tries.join(', ')}: start one (preview_start {name: "meadow"}) or set BASE`);
}

/** A page in a fresh browser: viewport, pixel ratio (DPR, default 1: MSAA on, as on Kai's 1× screens), optional video. */
export async function open({ width = 1200, height = 750, dpr = Number(process.env.DPR ?? 1), video = null } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  return { browser, context, page, errors };
}

/** The meadow, ready, with Muse's life written `hours` ahead (so its parts can be found) and the UI hidden. */
export async function meadow(page, base, { hash = 'hud=0', hours = Number(process.env.HOURS ?? 3) } = {}) {
  await page.goto(`${base}/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true && window.__world?.muse?.life, undefined, { timeout: 90000 });
  // (and its body in place: a muse in clothes takes some seconds more to rig than the first frame)
  await page.evaluate(() => window.__world.muse.ready);
  // (the control bar and the Parameters panel, lil-gui, out of the shot)
  await page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
  return page.evaluate((h) => {
    const w = window.__world;
    w.muse.life.at(h * 3600, w.rig.camera.position);
    return w.muse.life.names;
  }, hours);
}

/** The lab (src/dev/museLab.html) with a hash, ready. */
export async function lab(page, base, hash) {
  await page.goto(`${base}/src/dev/museLab.html#${hash}`);
  await page.waitForFunction(() => window.museLabReady === true, undefined, { timeout: 60000 });
}

/** The parts of a day by name: how many, and where the first starts. */
export function listParts(parts) {
  const seen = new Map();
  for (const p of parts) {
    const s = seen.get(p.name);
    if (s) s.count++;
    else seen.set(p.name, { count: 1, first: p.start });
  }
  for (const [name, { count, first }] of seen) console.log(`${name.padEnd(18)} ×${String(count).padEnd(4)} first at ${first.toFixed(1)} s`);
}

export function report(errors) {
  console.log(errors.length ? 'ERRORS ' + errors.slice(0, 5).join(' | ') : 'no errors');
}

export const slug = (s) => String(s).replace(/[^a-z0-9.-]+/gi, '_');
