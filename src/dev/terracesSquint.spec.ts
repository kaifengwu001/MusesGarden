import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './harnessApi';

// `npm run squint:terraces`: the terraces' squint test, as the meadow's
// (squint.spec.ts). Renders the terraces' vista as the painting composes it
// (TerraceWorld.paintingVista, found by search; the Vista button's is Kai's
// own view since 2026-11-03) at the painting's portrait aspect and
// compares it with the vista target the way you would by squinting: both
// shrunk to a 27×48 grid and blurred, the colour difference (CIE ΔE76 in
// Lab) measured per cell. The target is the green terraces painting (the
// composition Kai chose to squint against) recoloured into the blue ink
// painting's colours (the colour reference): its Lab mean and spread matched
// to the ink painting's. Writes shots/terraces-squint.png and prints the
// score with each third's mean colour.
//
// The paintings are kept out of git (reference/terraces/); the test is
// skipped without them.

const REFERENCE = 'reference/terraces/vista-target.png';
/**
 * Mean ΔE over the squinted grid: the goal (reads as the same picture) and
 * the guard this test fails above (today's score plus a little: no regressions).
 * Raised from 18 to 19 with Kai's notes on the second pass (2026-11-01): the
 * paddies built in 3D, rice standing in them, read darker than the painted
 * dashes over white water did (16.0 then, 18.6 now; flagged to Kai).
 */
const GOAL_DELTA_E = 10;
const GUARD_DELTA_E = 19;
const VIEWPORT = { width: 720, height: 1288 };

interface Squint {
  deltaE: number;
  thirds: Array<{ name: string; reference: string; render: string; deltaE: number }>;
  composite: string;
}

test.skip(!existsSync(REFERENCE), `needs ${REFERENCE}`);
test.use({ viewport: VIEWPORT, deviceScaleFactor: 1 });

test("the terraces' vista matches the painting when you squint", async ({ page }) => {
  await page.goto('/#pl=terraces&q=high&hud=0&t=20');
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  await page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
  await page.evaluate(async () => {
    // (once the build is in and its towers stand: the stand is looked for clear of them)
    const terraces = (window as unknown as { __terraces?: { paintingVista(): void; whenBuilt(): Promise<void> } }).__terraces;
    await terraces?.whenBuilt();
    await window.__meadow?.settle();
    terraces?.paintingVista();
    await window.__meadow?.settle();
    await window.__meadow?.settle();
  });
  const shot = (await page.screenshot()).toString('base64');

  const result = await page.evaluate(
    async ({ reference, shot }): Promise<Squint> => {
      const load = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error(`could not load ${src.slice(0, 40)}`));
          im.src = src;
        });
      const [ref, render] = await Promise.all([load(`/${reference}`), load(`data:image/png;base64,${shot}`)]);
      const GW = 27;
      const GH = 48;
      // squint: shrink to 4× the grid, average each 4×4 block, then a 3×3
      // binomial blur with clamped edges (a canvas blur would fade them)
      const squint = (im: HTMLImageElement): Uint8ClampedArray => {
        const mid = document.createElement('canvas');
        mid.width = GW * 4;
        mid.height = GH * 4;
        const m = mid.getContext('2d', { willReadFrequently: true })!;
        m.imageSmoothingQuality = 'high';
        m.drawImage(im, 0, 0, mid.width, mid.height);
        const src = m.getImageData(0, 0, mid.width, mid.height).data;
        const box = new Float32Array(GW * GH * 3);
        for (let y = 0; y < GH * 4; y++)
          for (let x = 0; x < GW * 4; x++)
            for (let c = 0; c < 3; c++) box[((y >> 2) * GW + (x >> 2)) * 3 + c] += src[(y * GW * 4 + x) * 4 + c] / 16;
        const out = new Uint8ClampedArray(GW * GH * 4);
        const at = (x: number, y: number, c: number): number => box[(Math.min(GH - 1, Math.max(0, y)) * GW + Math.min(GW - 1, Math.max(0, x))) * 3 + c];
        const w = [1, 2, 1];
        for (let y = 0; y < GH; y++)
          for (let x = 0; x < GW; x++) {
            for (let c = 0; c < 3; c++) {
              let s = 0;
              for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += w[i + 1] * w[j + 1] * at(x + i, y + j, c);
              out[(y * GW + x) * 4 + c] = s / 16;
            }
            out[(y * GW + x) * 4 + 3] = 255;
          }
        return out;
      };
      const lab = (r: number, g: number, b: number): [number, number, number] => {
        const lin = (c: number): number => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        const R = lin(r);
        const G = lin(g);
        const B = lin(b);
        const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
        const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
        const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
        const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
        return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
      };
      const a = squint(ref);
      const b = squint(render);
      const diff = new Float32Array(GW * GH);
      for (let i = 0; i < GW * GH; i++) {
        const p = lab(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]);
        const q = lab(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]);
        diff[i] = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      }
      const hex = (px: Uint8ClampedArray, y0: number, y1: number): string => {
        const sum = [0, 0, 0];
        for (let y = y0; y < y1; y++) for (let x = 0; x < GW; x++) for (let c = 0; c < 3; c++) sum[c] += px[(y * GW + x) * 4 + c];
        const n = (y1 - y0) * GW;
        return '#' + sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      };
      const mean = (y0: number, y1: number): number => {
        let s = 0;
        for (let y = y0; y < y1; y++) for (let x = 0; x < GW; x++) s += diff[y * GW + x];
        return s / ((y1 - y0) * GW);
      };
      const thirds = [
        ['far hills and forest', 0, 16],
        ['middle terraces', 16, 32],
        ['near terraces', 32, 48],
      ] as const;

      // composite: the still and the render on top, squinted below, the ΔE map at the right
      const W = 270;
      const H = Math.round((W * GH) / GW);
      const out = document.createElement('canvas');
      out.width = W * 3;
      out.height = H * 2;
      const o = out.getContext('2d')!;
      o.fillStyle = '#f4f1e8';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(ref, 0, 0, W, H);
      o.drawImage(render, W, 0, W, H);
      const grid = (px: Uint8ClampedArray): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = GW;
        c.height = GH;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), GW, GH), 0, 0);
        return c;
      };
      o.imageSmoothingEnabled = true;
      o.drawImage(grid(a), 0, H, W, H);
      o.drawImage(grid(b), W, H, W, H);
      const heat = new Uint8ClampedArray(GW * GH * 4);
      for (let i = 0; i < GW * GH; i++) {
        const t = Math.min(diff[i] / 40, 1);
        heat[i * 4] = 255 * t;
        heat[i * 4 + 1] = 255 * (1 - Math.abs(t - 0.5) * 2) * 0.8;
        heat[i * 4 + 2] = 255 * (1 - t);
        heat[i * 4 + 3] = 255;
      }
      o.imageSmoothingEnabled = false;
      o.drawImage(grid(heat), W * 2, H, W, H);
      o.font = '15px sans-serif';
      o.fillStyle = '#333';
      o.fillText(`squint ΔE ${mean(0, GH).toFixed(1)}`, W * 2 + 16, 28);
      thirds.forEach(([name, y0, y1], k) => o.fillText(`${name}: ${mean(y0, y1).toFixed(1)}`, W * 2 + 16, 56 + k * 22));
      o.fillText('blue = close · red = ΔE ≥ 40', W * 2 + 16, 56 + 3 * 22 + 8);

      return {
        deltaE: mean(0, GH),
        thirds: thirds.map(([name, y0, y1]) => ({ name, reference: hex(a, y0, y1), render: hex(b, y0, y1), deltaE: mean(y0, y1) })),
        composite: out.toDataURL('image/png'),
      };
    },
    { reference: REFERENCE, shot },
  );

  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/terraces-squint.png', Buffer.from(result.composite.split(',')[1], 'base64'));
  writeFileSync('shots/terraces-vista.png', Buffer.from(shot, 'base64'));
  console.info(`squint ΔE ${result.deltaE.toFixed(2)} (goal ≤ ${GOAL_DELTA_E}, fails above ${GUARD_DELTA_E})`);
  for (const t of result.thirds) console.info(`  ${t.name.padEnd(24)} ΔE ${t.deltaE.toFixed(1).padStart(5)}   reference ${t.reference}   render ${t.render}`);
  expect(result.deltaE).toBeLessThan(GUARD_DELTA_E);
});
