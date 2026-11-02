// Into Muse's hut headless (the cutaway, view/cutaway.ts): the cottage view, a knock (window.__garden.hut()), the rise,
// the room, the showpiece's view (shelf), a favourite's card (fav<i>), back to the room, outside again (leave).
// node hut.mjs <target> <outdir> [outside in mid open shelf fav2 room leave orbit-az,el,size]; env W, H, DPR, T, WAIT,
// DOING (greet, cook, sleep: else at random). Time is frozen (T), so Muse is put in its room rather than walking in
// (for the walk in and out, film with time running: muse-look).
import { launch, openPage } from './lib.mjs';
const [base = 'http://localhost:5194', out = '.', ...steps] = process.argv.slice(2);
const W = Number(process.env.W ?? 1405), H = Number(process.env.H ?? 860), dpr = Number(process.env.DPR ?? 2);
const T = process.env.T ?? '40';
const browser = await launch();
const { page, errors } = await openPage(browser, base, { width: W, height: H, dpr, hash: `t=${T}&q=high&hud=0` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(async () => { const m = window.__meadow; m.preset('homestead'); await m.settle(); await m.settle(); });
await sleep(800);
const list = steps.length ? steps : ['outside', 'in', 'mid', 'open'];
for (const step of list) {
  if (step === 'outside') {
    await page.screenshot({ path: `${out}/outside.png` });
  } else if (step === 'in') {
    await page.evaluate((doing) => window.__garden.hut(doing || undefined, true), process.env.DOING ?? '');
    await sleep(700);
    await page.screenshot({ path: `${out}/rising-0.7s.png` });
  } else if (step === 'mid') {
    await sleep(700);
    await page.screenshot({ path: `${out}/rising-1.4s.png` });
  } else if (step === 'open') {
    // wait for the furniture and the end of the rise
    for (let k = 0; k < 60; k++) { const s = await page.evaluate(() => window.__garden.inHut()); if (s.open && s.loaded) break; await sleep(500); }
    await sleep(Number(process.env.WAIT ?? 1.5) * 1000);
    await page.screenshot({ path: `${out}/open.png` });
    console.log(JSON.stringify(await page.evaluate(() => window.__garden.inHut())));
  } else if (step.startsWith('fav')) {
    const i = Number(step.slice(3) || 0);
    await page.evaluate((i) => window.__garden.favourite(i), i);
    await sleep(1200);
    await page.screenshot({ path: `${out}/favourite-${i}.png` });
  } else if (step === 'shelf') {
    await page.evaluate(() => window.__garden.shelf());
    await sleep(2600);
    await page.screenshot({ path: `${out}/shelf.png` });
    console.log(JSON.stringify(await page.evaluate(() => window.__garden.inHut())));
  } else if (step === 'room') {
    await page.evaluate(() => window.__garden.room());
    await sleep(2400);
    await page.screenshot({ path: `${out}/room-again.png` });
  } else if (step === 'leave') {
    await page.evaluate(() => window.__garden.outside());
    await sleep(900);
    await page.screenshot({ path: `${out}/leaving.png` });
    await sleep(1500);
    await page.screenshot({ path: `${out}/left.png` });
  } else if (step.startsWith('orbit')) {
    const [az, el, size] = step.slice(6).split(',').map(Number);
    await page.evaluate(([az, el, size]) => { const c = window.__garden.cutaway; c.aim.azimuth = az; c.aim.elevation = el; c.aim.size = size; }, [az, el, size]);
    await sleep(1500);
    await page.screenshot({ path: `${out}/orbit-${az}-${el}-${size}.png` });
  }
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
