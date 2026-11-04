// The director's mode headless (docs/director.md): open `?director` on a planet's page, give it a scene (a JSON file,
// or one of two demos made where the camera looks), wait for every Muse's body, and take stills at moments of the
// take with the panel shown (or hidden: HIDE=1), plus a report of the take (its beats' times, blocked routes) and
// the page's errors.
//
//   node director.mjs <base url> <out dir> [planet path]
//   node director.mjs http://localhost:5173/ /tmp/d                                  the meadow, the demo
//   node director.mjs http://localhost:5173/ /tmp/d environments/golden-rye/         a world (Momo visits)
//   SCENARIO=pieces node director.mjs …                                              a bench and a stove, a nap
//   SCENE=scene.json TIMES=0,5,12 node director.mjs …                                an exported scene
//
// env: TIMES (s into the take, comma separated), DPR (default 1), HIDE=1 (stills with nothing of the director drawn).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './lib.mjs';

const base = (process.argv[2] ?? 'http://localhost:5263/').replace(/\/?$/, '/');
const out = process.argv[3] ?? '/tmp/director';
const path = process.argv[4] ?? '';
const times = (process.env.TIMES ?? '0,6,14,24').split(',').map(Number);
mkdirSync(out, { recursive: true });

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});
await page.goto(`${base}${path}?director#`);
await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 120_000 });
await page.waitForFunction(() => !!window.__director, undefined, { timeout: 60_000 });
await page.evaluate(() => window.__director.ready);
const abilities = await page.evaluate(() => window.__director.abilities());
const scene0 = await page.evaluate(() => window.__director.scene());
const host = scene0.actors.find((a) => a.host);

// a scene (SCENE=file.json to give one): the host walks to a mark in view and sits, then gets up and waves at the
// camera; a guest (Kiki) starts beside it, waters twice, and bounces for joy as the host begins its wave
const given = process.env.SCENE ? JSON.parse((await import('node:fs')).readFileSync(process.env.SCENE, 'utf8')) : null;
const built = await page.evaluate(
  ({ hostId, given, guestLook, guestName, scenario }) => {
    const d = window.__director;
    if (given) {
      d.setScene(given);
      return d.scene();
    }
    const s = d.scene();
    const h = s.actors.find((a) => a.id === hostId);
    if (scenario === 'pieces') {
      // a bench and a stove in view; the host perches on the bench, then cooks at the stove; the guest naps in the grass, then waves
      const bx = (id, action, mark, extra = {}) => ({ id, action, mark, piece: extra.piece ?? null, facing: extra.facing ?? { kind: 'mark' }, amount: extra.amount ?? 3, cue: extra.cue ?? { kind: 'after' }, face: extra.face ?? 'its own', gaze: extra.gaze ?? { kind: 'own' }, seed: 11 });
      s.pieces = [{ id: 'p1', kind: 'bench', at: d.markAt(-0.32, -0.55) }, { id: 'p2', kind: 'stove', at: d.markAt(0.3, -0.6) }];
      h.beats = [bx('b1', 'perch', null, { piece: 'p1', amount: 8 }), bx('b2', 'cook', null, { piece: 'p2', amount: 1 })];
      s.actors.push({ id: 'g1', name: guestName, look: guestLook, host: false, shown: true, colour: '#2f7cc4', start: d.markAt(0.05, -0.45), beats: [bx('g1b1', 'nap', d.markAt(0.0, -0.78), { amount: 12 }), bx('g1b2', 'wave', null, { amount: 1, gaze: { kind: 'camera' } })] });
      d.setScene(s);
      return d.scene();
    }
    const beat = (id, action, mark, extra = {}) => ({ id, action, mark, piece: extra.piece ?? null, facing: extra.facing ?? { kind: 'mark' }, amount: extra.amount ?? 3, cue: extra.cue ?? { kind: 'after' }, face: extra.face ?? 'its own', gaze: extra.gaze ?? { kind: 'own' }, seed: 7 });
    h.beats = [beat('b1', 'sit', d.markAt(-0.2, -0.62), { amount: 5 }), beat('b2', 'wave', null, { amount: 1, gaze: { kind: 'camera' } })];
    s.actors.push({ id: 'g1', name: guestName, look: guestLook, host: false, shown: true, colour: '#2f7cc4', start: d.markAt(0.3, -0.5), beats: [] });
    const g = s.actors.find((a) => a.id === 'g1');
    g.beats = [beat('g1b1', 'water', d.markAt(0.12, -0.78), { amount: 2 }), beat('g1b2', 'bounce', null, { amount: 2, cue: { kind: 'event', actor: hostId, beat: 'b2', when: 'arrives' }, face: 'happy squint ∩', facing: { kind: 'camera' } })];
    d.setScene(s);
    return d.scene();
  },
  { hostId: host.id, given, guestLook: path ? 'tpose6' : 'muse5', guestName: path ? 'Momo' : 'Kiki', scenario: process.env.SCENARIO ?? '' },
);
await page.waitForTimeout(500);
// (every Muse's body in: a guest takes a few seconds on the worlds)
await page.waitForFunction(() => window.__director.loaded(), undefined, { timeout: 90_000 });
const take = await page.evaluate(() => window.__director.take());
const shots = [];
for (const t of times) {
  await page.evaluate(({ t, hide }) => {
    window.__director.seek(t);
    window.__director.hide(hide);
  }, { t, hide: process.env.HIDE === '1' });
  // (a few frames for the bodies and the overlay to follow)
  await page.waitForTimeout(700);
  const file = join(out, `t${String(t).padStart(3, '0')}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
}
const where = await page.evaluate(() => window.__director.where());
writeFileSync(join(out, 'report.json'), JSON.stringify({ abilities, take, where, errors, scene: built }, null, 1));
console.log(JSON.stringify({ abilities, length: take.length, settled: take.settled, actors: take.actors.map((a) => ({ id: a.id, end: a.end, problems: a.problems, blocked: a.blocked, beats: a.beats })), errors: errors.slice(0, 12), shots }, null, 1));
await browser.close();
