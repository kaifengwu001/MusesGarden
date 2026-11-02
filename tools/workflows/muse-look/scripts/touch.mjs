// Taps and holds on Muse in the meadow, headless, as a visitor does them (real mouse events through
// main.ts's pick): a tap (wave), a second tap (bounce), a hold (pet), letting go, then a tap on the
// meadow away from Muse (the meadow's, not Muse's). Screenshots and what Muse is doing after each.
//   node touch.mjs <out-dir> [part] [s] [hold-seconds]      default: "look about", 0.5 s in, a 2.6 s hold
// env: BASE, DPR (default 1).
import { findBase, open, meadow, report } from './lib.mjs';

const [out, part = 'look about', s0 = '0.5', holdFor = '2.6'] = process.argv.slice(2);
if (!out) throw new Error('usage: node touch.mjs <out-dir> [part] [s] [hold-seconds]');
const base = await findBase();
const [W, H] = [1000, 700];
const { browser, page, errors } = await open({ width: W, height: H });
const parts = await meadow(page, base);
const found = parts.find((p) => p.name === part);
if (!found) throw new Error(`no part "${part}"`);
// framed close, Muse in the middle of the screen (frameMuse looks at its middle)
await page.evaluate((at) => {
  const w = window.__world;
  w.muse.life.seek(w.clock.time, at);
  w.frameMuse({ distance: 3.6, height: 1.5, azimuth: 0.2 });
}, found.start + Number(s0));
// (a press finds Muse only while it is drawn: wait for the frame after the jump to settle, or the first tap goes to the meadow)
await page.evaluate(() => window.__meadow.settle());
await page.waitForFunction(() => window.__world.muse.drawn, undefined, { timeout: 15000 });
await page.waitForTimeout(500);
const doing = () =>
  page.evaluate(() => {
    const l = window.__world.muse.living;
    return `wave ${l.action.wave.toFixed(2)} moves ${l.action.moves.map((m) => m.kind).join(',') || '-'} petted ${l.cues.petted.toFixed(2)}`;
  });
const [x, y] = [W / 2, H / 2];
await page.mouse.click(x, y);
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/tap-wave.png` });
console.log('after a tap:      ', await doing());
await page.mouse.click(x, y);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/tap-bounce.png` });
console.log('after a 2nd tap:  ', await doing());
await page.waitForTimeout(3000);
await page.mouse.move(x, y - 20);
await page.mouse.down();
await page.waitForTimeout(Number(holdFor) * 1000);
await page.screenshot({ path: `${out}/hold-pet.png` });
console.log('holding:          ', await doing());
await page.mouse.up();
await page.waitForTimeout(400);
console.log('let go:           ', await doing());
await page.mouse.click(120, H - 100);
await page.waitForTimeout(300);
console.log('tap on the meadow:', await doing());
report(errors);
await browser.close();
