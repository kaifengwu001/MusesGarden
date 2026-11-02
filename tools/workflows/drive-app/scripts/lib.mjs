// Shared by the skills' probe scripts (drive-app, measure-perf, check-frames, look-dev, publish-page):
// headless Chromium on the real GPU, a page on a target (a URL, or a build on disk served by route
// interception), the views of a views file, and frozen frames read back pixel for pixel.
import { chromium } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout these scripts sit in (tools/workflows/drive-app/scripts → its root). */
export const REPO = resolve(HERE, '../../../..');
/** Where build-at.sh puts builds, a folder per name. */
export const BUILDS = process.env.BUILDS ?? join(tmpdir(), 'muses-garden-builds');
/** The meadow's standard views; VIEWSFILE=<file> for another planet's. */
export const VIEWSFILE = process.env.VIEWSFILE ?? join(HERE, '..', 'views', 'meadow.json');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Headless Chromium through ANGLE on Metal (honest timings on this Mac); MEADOW_GL=swiftshader for the CPU rasterizer. */
export function launch() {
  const args =
    process.env.MEADOW_GL === 'swiftshader'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  return chromium.launch({ args });
}

// In the page: window.__pause = true holds the app's own animation loop while a script renders frames itself.
function pausableRaf() {
  const raf = window.requestAnimationFrame.bind(window);
  window.__pause = false;
  window.requestAnimationFrame = (cb) =>
    raf(function again(t) {
      if (window.__pause) raf(again);
      else cb(t);
    });
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Open the app on a target and wait for the harness (window.__meadow) to be ready.
 * target: a URL (http://localhost:5198, a published page) or the name of a build in BUILDS, served from disk at
 * http://<name>.test/. Options: hash, width, height, dpr (env DPR, default 2), mobile, pausable, init (scripts).
 */
export async function openPage(browser, target, opts = {}) {
  const { hash = '', width = 1440, height = 900, dpr = Number(process.env.DPR ?? 2), mobile = false, pausable = false, init = [] } = opts;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  let base = target.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(target)) {
    if (!/^[a-z0-9-]+$/i.test(target)) throw new Error(`a build name is letters, digits and hyphens: ${target}`);
    const root = join(BUILDS, target);
    if (!isFile(join(root, 'index.html'))) throw new Error(`no build at ${root}: make it with build-at.sh ${target} [commit]`);
    base = `http://${target}.test`;
    await ctx.route(`${base}/**`, (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      const file = join(root, path === '/' ? 'index.html' : path);
      if (!file.startsWith(root) || !isFile(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } });
    });
  }
  if (pausable) await ctx.addInitScript(pausableRaf);
  for (const script of init) await ctx.addInitScript(script);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  await page.goto(`${base}/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 120_000 });
  return { page, ctx, errors, base };
}

/** The views of a views file (VIEWSFILE by default), filtered by env VIEWS="name,name". */
export function loadViews(file = VIEWSFILE) {
  const all = JSON.parse(readFileSync(file, 'utf8'));
  const only = process.env.VIEWS ? process.env.VIEWS.split(',').map((s) => s.trim()) : null;
  return only ? all.filter((v) => only.includes(v.name)) : all;
}

/**
 * Put the camera on a view and settle: a preset, a pose (as in the hash's pose=: frame quaternion and zoom) and,
 * in dev or probe builds (window.__world), a fixed tilt (degrees from straight down), field of view (degrees) and turn
 * (radians about up, with tilt), so builds whose rigs differ still see the same picture. Without __world the
 * overrides are skipped (the result says so).
 */
export function applyView(page, view) {
  return page.evaluate(async (v) => {
    const m = window.__meadow;
    const w = window.__world;
    if (v.preset) m.preset(v.preset);
    if (v.pose) {
      if (w?.rig) {
        w.rig.applyPose(v.pose);
        w.markPosed?.();
      } else {
        const parts = m.getHash().split('&').filter((p) => p && !p.startsWith('pose='));
        parts.push(`pose=${v.pose}`);
        m.setHash(parts.join('&'));
      }
    }
    const wantsFixed = v.tilt !== undefined || v.fov !== undefined;
    let fixed = false;
    if (wantsFixed && w?.rig) {
      const rig = w.rig;
      if (!rig.__orig) rig.__orig = rig.update.bind(rig);
      rig.update = (...a) => {
        rig.__orig(...a);
        const cam = rig.camera;
        if (v.tilt !== undefined) {
          const tilt = (v.tilt * Math.PI) / 180;
          const fwd = rig.forward.clone().applyAxisAngle(rig.up, v.turn ?? 0);
          cam.up.copy(fwd).multiplyScalar(Math.cos(tilt)).addScaledVector(rig.up, Math.sin(tilt));
          const look = rig.up.clone().multiplyScalar(-Math.cos(tilt)).addScaledVector(fwd, Math.sin(tilt));
          cam.lookAt(look.add(cam.position));
        }
        if (v.fov !== undefined) cam.fov = v.fov;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      };
      fixed = true;
    } else if (w?.rig?.__orig) {
      w.rig.update = w.rig.__orig; // a view without overrides after one with them
    }
    await m.settle();
    await m.settle();
    return { fixed, skipped: wantsFixed && !fixed };
  }, view);
}

/**
 * A frame that is the same on every load: freeze time at t, pin the render scale (after freezing: Auto's scale is
 * locked only while frozen), render twice (the first frame after a scale change carries a little of the last), then
 * read the canvas back in the same task. Leaves the pixels in window.__px; returns their FNV-1a hash and size.
 */
export function frozenFrame(page, t = 12) {
  return page.evaluate((t) => {
    const m = window.__meadow;
    m.freeze(t);
    m.setScale?.(1);
    m.renderFrame();
    m.renderFrame();
    const canvas = document.querySelector('canvas#scene') ?? document.querySelector('canvas');
    const gl = canvas.getContext('webgl2');
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    window.__px = px;
    let h = 0x811c9dc5;
    for (let i = 0; i < px.length; i++) {
      h ^= px[i];
      h = Math.imul(h, 0x01000193);
    }
    return { hash: (h >>> 0).toString(16), width: W, height: H, scale: m.stats().renderScale };
  }, t);
}

/** The pixels frozenFrame left in the page, as a Buffer (RGBA, rows bottom to top). */
export async function pagePixels(page) {
  const b64 = await page.evaluate(() => {
    const p = window.__px;
    let s = '';
    for (let i = 0; i < p.length; i += 32768) s += String.fromCharCode.apply(null, p.subarray(i, i + 32768));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

/** Encode RGBA pixels (rows bottom to top, as readPixels gives them) as a PNG, through the page's canvas. */
export async function rgbaToPng(page, rgba, width, height, crop = null) {
  const b64 = await page.evaluate(
    ({ data, width, height, crop }) => {
      const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
      const flipped = new Uint8ClampedArray(bytes.length);
      const row = width * 4;
      for (let y = 0; y < height; y++) flipped.set(bytes.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      const full = document.createElement('canvas');
      full.width = width;
      full.height = height;
      full.getContext('2d').putImageData(new ImageData(flipped, width, height), 0, 0);
      let out = full;
      if (crop) {
        out = document.createElement('canvas');
        out.width = crop.w * crop.zoom;
        out.height = crop.h * crop.zoom;
        const o = out.getContext('2d');
        o.imageSmoothingEnabled = false;
        o.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
      }
      return out.toDataURL('image/png').split(',')[1];
    },
    { data: rgba.toString('base64'), width, height, crop },
  );
  return Buffer.from(b64, 'base64');
}

/** p-quantile of numbers. */
export const quantile = (a, f) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))] : NaN);
