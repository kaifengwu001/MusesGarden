// The stills Muse's postcards pick from (src/assets/postcards/stills.ts), rendered from the meadow in headless Chromium:
// each shot below is written to src/assets/postcards/<key>-<n>.jpg, n counting from 1 in the order of its key's shots.
//   node postcard-stills.mjs <target> [outDir]        (npm run postcard-stills -- http://localhost:5322)
// target: the dev server of this checkout (the shots need window.__world). outDir: src/assets/postcards by default;
//   a whole run there also deletes the numbered stills no shot makes any more.
// env: ONLY="scenery,sky-2" renders only those keys or files; SHOTS=<file.json> renders another list (to try framings,
//      into another outDir); W, H (960 × 640), DPR (2: drawn at twice the size, saved at W × H), QUALITY (82).
//
// A shot: { key, what, t?, muse?, hut?, camera | preset | pose, zoom?, friend? }, time frozen at t (s, default 12).
//   muse: { part, s, nth?, wave?, pet? } seeks Muse's day to s into the nth such part (muse-look's meadow.mjs lists
//     them) and, with wave, as if you had tapped it `wave` s ago (it waves, looking at you, for 3.3 s); with pet, as if
//     you had held it `pet` s and still do (it leans its head into your hand, toward its left, or its right with
//     side: -1, looking at you); { busy: true } has it working at home, head bowed on the bench, and
//     { at: [x, z], facing: [x, z], busy? } stands it out on the planet. Without muse, Muse is off the planet (not drawn).
//   hut: opens Muse's hut (the cutaway) and puts Muse in it, as when its room was laid out while it was away:
//     { doing, s } puts it there s s ago, living it as its life has it (museRoam.ts inside): 'cook' at the hearth's
//       stove (museRig.ts COOK: the ladle out of its pocket, stirring from 1 s, the ladle lifted at 7.6, blown on,
//       sipped at 9.3, savoured to 11.6; four rounds, then a look about), 'greet' on the rug (its eyes on you, a wave
//       from 0.6 s to 3.9 s), 'sleep' on its bed; { at: [x, z], facing: [x, z] } stands it at a spot facing another
//       (the room's meters, as the camera's), head bowed; { away: true } leaves the room empty.
//   camera: in the homestead's frame, meters across the cottage's front (x) and toward its pond (z) along the planet:
//     { at: [x, z], height, look: [x, z, h] | { yaw, pitch }, fov } stands `height` m over the ground or water there,
//       looking at a point (h m over its ground) or along a heading (° from toward the pond, + left) and pitch (° up);
//     { orbit, distance, azimuth, height, aim, fov } stands `distance` m off a subject along the ground, `azimuth` °
//       round from the way Muse faces (else from toward the pond), looking `aim` m over it. The subject: 'muse', { bed }
//       (a find's bed, by its place in the garden's layout), { bird | butterfly | cloud: n, near: [x, z] } (the nth
//       nearest the spot), or a spot [x, z];
//     { head: true, distance, azimuth, rise, fov } stands `distance` m from the middle of Muse's head (about 1 m: a
//       selfie at arm's length), `azimuth` ° round from the way Muse faces (+ toward its left), `rise` ° up from its
//       height, looking back at it.
//     Any of them takes face: [x, y], the subject put off the frame's middle (-1 … 1 of the half frame, + right and
//     up), and roll: ° the camera is tipped (+ clockwise: the horizon rises to the right).
//   preset, pose, focus, zoom: the harness's preset ('vista', 'homestead', …), a pose= string or a spot [x, z] to
//     stand over facing the pond's way, and the rig's zoom there.
//   friend: { coat: [r, g, b], right, ahead, turn, wave?, deck? } stands a second Muse, a copy of Muse's body in a
//     coat of its own, `right` m to Muse's right and `ahead` m in front of it, turned `turn` ° from Muse's heading
//     (+ toward its left); in Muse's pose, or waving `wave` s in while Muse doesn't; deck: on the floor Muse stands on
//     (the terrace, the pier) rather than the ground. It casts no shadow.
// Or a shot is the owner's own framing: { key, what, url, day?, muse? }, url the app's address (or just its hash) after
//   pressing T, which holds time and puts t= beside pose= in it. The still is that frame: the same t, pose and every
//   other key in the hash, Muse living its own day at t as the app shows it, the HUD, the garden's overlay and its
//   pins hidden, drawn at W × H (at q=high unless the URL names a tier): the same height of view, so a wider window's
//   sides are cut. Without t= it fails. A query naming an engine (?garden=/api/muses/<id>, ?dev) is kept, so the
//   finds' beds are that garden's: the target must serve its API (a dev server started with MUSE_API=<the engine>),
//   and the page only reads from it. The engine's garden and Muse move on by the engine's clock, not t: a run prints
//   the garden's day (the engine's, which runs ahead of the calendar) and where Muse stands now, so run a framing as
//   soon as it comes, then hold them as the owner's frame had them: day: 'YYYY-MM-DD' lays out only the baskets up to
//   that day (later ones sprout beds into the frame), and muse: { at, facing } (as above, 3 decimals) stands Muse
//   there. What a URL can't hold is lost: a tap on Muse or a knock at its hut moves its day on in that page.
// The finds' beds are the garden's placeholder baskets (src/garden/placeholder.ts), dated back from today, so a run on
// another day can frame other beds than these stills show.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, launch, openPage } from './lib.mjs';

const PEACH = [1.0, 0.86, 0.74];
const LAVENDER = [0.92, 0.86, 1.02];
const SAGE = [0.9, 0.97, 0.82];
const SHOTS = [
  { key: 'scenery', what: 'the vista: lakes and islands past the flowering meadow', preset: 'vista', t: 40 },
  { key: 'scenery', what: 'the meadow, the pond and the cottage from the bird’s-eye stop', pose: '-0.426,0.3515,0.2406,0.7982,0.35' },
  { key: 'scenery', what: 'a lake with the clouds in it', camera: { at: [0, -35], height: 2.2, look: { yaw: 180, pitch: -6 }, fov: 55 } },
  { key: 'scenery', what: 'a flowering hill under big clouds', camera: { at: [56.6, 56.6], height: 2.2, look: { yaw: 45, pitch: -4 }, fov: 55 } },
  { key: 'scenery', what: 'the wetland, land and water laced together', camera: { at: [-10, -8], height: 6, look: [-30, -40, 0], fov: 55 } },
  { key: 'scenery', what: 'the cottage far off over the flowers', camera: { at: [13.6, -8.3], height: 1.4, look: [0, 0, 4], fov: 60 } },
  { key: 'scenery', what: 'framed in the app: down through the clouds to a lake winding past an islet', day: '2026-11-06', url: 'http://localhost:5280/?garden=/api/muses/hero#g=0.2598&cam=wander&t=14.898&pose=-0.678,0.713,0.1786,0.0044,0.7048', muse: { at: [25.542, 47.686], facing: [25.838, 46.722] } },
  { key: 'scenery', what: 'framed in the app: over the meadow in bloom, cloud shadows on the grass', day: '2026-11-06', url: 'http://localhost:5280/?garden=/api/muses/hero#g=0.2598&cam=wander&t=14.898&pose=-0.4696,0.4123,0.759,0.1829,0.6476', muse: { at: [25.542, 47.686], facing: [25.838, 46.722] } },
  { key: 'sky', what: 'a flock crossing, clouds on the horizon', camera: { orbit: { bird: 0 }, distance: 6, height: 1.4, aim: 0, fov: 55 } },
  { key: 'sky', what: 'one tall cloud', camera: { orbit: { cloud: 2 }, distance: 30, height: 1.4, aim: 9, azimuth: 200, fov: 60 } },
  { key: 'sky', what: 'birds overhead', camera: { orbit: { bird: 2 }, distance: 2.5, height: 1.2, aim: 0, azimuth: 40, fov: 60 } },
  { key: 'sky', what: 'a bank of clouds over a hill', camera: { at: [56.6, 56.6], height: 1.2, look: { yaw: 45, pitch: 22 }, fov: 60 } },
  { key: 'closeup', what: 'poppies at knee height', camera: { at: [-24.7, -24.7], height: 0.65, look: { yaw: 225, pitch: -12 }, fov: 45 } },
  { key: 'closeup', what: 'pink tulips under the clouds', camera: { at: [24.7, 24.7], height: 0.65, look: { yaw: 45, pitch: -14 }, fov: 45 } },
  { key: 'closeup', what: 'a pink flower over the grass', camera: { at: [-56.6, 56.6], height: 0.45, look: { yaw: 315, pitch: -2 }, fov: 50 } },
  { key: 'closeup', what: 'white star daisies, a drift of them to the skyline', camera: { at: [51, -18], height: 0.7, look: { yaw: 290, pitch: -10 }, fov: 32 } },
  { key: 'closeup', what: 'yellow buttons before a row of pink tulips', camera: { at: [-60, 0], height: 0.75, look: { yaw: 60, pitch: -14 }, fov: 33 } },
  { key: 'closeup', what: 'red cups in the grass before the cottage', camera: { at: [-12.3, -7.4], height: 0.68, look: { yaw: 62, pitch: -5 }, fov: 32 } },
  { key: 'creature', what: 'a butterfly over the flowers, birds beyond', camera: { orbit: { butterfly: 2, near: [-24, 24] }, distance: 1.4, height: 0.8, aim: 0, azimuth: 60, fov: 40 } },
  { key: 'creature', what: 'a butterfly against a cloud', camera: { orbit: { butterfly: 1, near: [-12, -10] }, distance: 0.7, height: 0.5, aim: 0, azimuth: 90, fov: 50 } },
  { key: 'creature', what: 'a butterfly overhead', camera: { orbit: { butterfly: 0, near: [-24, 24] }, distance: 0.6, height: 0.6, aim: 0, azimuth: 200, fov: 50 } },
  { key: 'creature', what: 'white birds low over the meadow', camera: { orbit: { bird: 5, near: [30, 30] }, distance: 8, height: 1.2, aim: 0, azimuth: 180, fov: 50 } },
  { key: 'creature', what: 'framed in the app: a flock over poppies and tulips at grass level', day: '2026-11-06', url: 'http://localhost:5280/?garden=/api/muses/hero#g=0.2598&cam=wander&t=45.823&pose=-0.1087,-0.1889,0.6116,0.7606,1', muse: { at: [25.542, 47.686], facing: [25.838, 46.722] } },
  { key: 'find', what: 'a bed of finds in flower among the daisies', camera: { orbit: { bed: 16 }, distance: 3.5, height: 1.4, aim: 0.3, fov: 55 } },
  { key: 'find', what: 'one find’s bloom up close', camera: { orbit: { bed: 0 }, distance: 1.2, height: 0.8, aim: 0.4, azimuth: 120, fov: 50 } },
  { key: 'find', what: 'a bed of finds from above', camera: { orbit: { bed: 1 }, distance: 0.4, height: 1.7, aim: 0, fov: 55 } },
  { key: 'selfie', what: 'Muse waving, the cottage behind', muse: { part: 'look about', s: 3, wave: 0.8 }, camera: { orbit: 'muse', distance: 1.7, height: 1.75, aim: 1.15, azimuth: -20, fov: 58 } },
  { key: 'selfie', what: 'Muse sat in the grass, waving', muse: { part: 'sit', s: 5, wave: 0.9 }, camera: { orbit: 'muse', distance: 1.4, height: 1.3, aim: 0.7, azimuth: 25, fov: 58 } },
  { key: 'selfie', what: 'Muse on its bench, humming', muse: { part: 'bench', s: 10 }, camera: { orbit: 'muse', distance: 2.0, height: 1.35, aim: 0.85, azimuth: 10, fov: 55 } },
  { key: 'selfie', what: 'Muse watering the flowers', muse: { part: 'pour', s: 2 }, camera: { orbit: 'muse', distance: 2.0, height: 1.5, aim: 0.9, azimuth: 30, fov: 55 } },
  { key: 'selfie', what: 'Muse fishing off the end of the pier', muse: { part: 'fish', s: 20 }, camera: { orbit: 'muse', distance: 2.0, height: 1.8, aim: 0.6, fov: 55 } },
  { key: 'selfie', what: 'Muse’s selfie at the end of the pier, its catch on the line', muse: { part: 'fish', s: 39 }, camera: { head: true, distance: 1.1, azimuth: 45, rise: 18, face: [0.35, -0.05], roll: 6, fov: 70 } },
  { key: 'selfie', what: 'Muse’s selfie sat in the flowers, leaning into a pat', muse: { part: 'sit', s: 5, pet: 1.5 }, camera: { head: true, distance: 1.0, azimuth: 20, rise: 30, face: [-0.3, 0.05], roll: 8, fov: 68 } },
  { key: 'selfie', what: 'Muse’s selfie fishing at the pond’s edge, its cottage across the water', muse: { part: 'fish', nth: 10, s: 20, wave: 1.2 }, camera: { head: true, distance: 1.1, azimuth: -60, rise: 25, face: [-0.35, 0], roll: -6, fov: 68 } },
  { key: 'selfie', what: 'Muse’s selfie on its bench, waving', muse: { part: 'bench', s: 3, wave: 1.2 }, camera: { head: true, distance: 1.2, azimuth: -40, rise: 30, face: [-0.3, 0.1], roll: -7, fov: 72 } },
  { key: 'selfie', what: 'Muse’s selfie in its hut, waving from the stove', hut: { doing: 'cook', s: 3 }, muse: { wave: 1.2 }, camera: { head: true, distance: 1.0, azimuth: 50, rise: 25, face: [-0.3, 0], roll: 7, fov: 68 } },
  { key: 'selfie', what: 'Muse asleep on its back in the grass, from above', muse: { part: 'nap', s: 30 }, camera: { head: true, distance: 1.6, rise: 80, fov: 55 } },
  { key: 'selfie', what: 'Muse’s selfie watering the flowers', muse: { part: 'pour', nth: 4, s: 2 }, camera: { head: true, distance: 1.2, azimuth: 45, rise: 5, face: [0.3, 0.25], roll: 5, fov: 72 } },
  { key: 'selfie', what: 'Muse looking about, out over a lake', t: 7.9, muse: { part: 'look about', nth: 2, s: 3 }, camera: { orbit: 'muse', distance: 2.0, azimuth: 40, height: 1.4, aim: 1.1, face: [0.35, 0], fov: 55 } },
  { key: 'selfie', what: 'framed in the app: Muse in the flowering meadow under big clouds', day: '2026-11-06', url: 'http://localhost:5280/?garden=/api/muses/hero#g=0.2598&cam=wander&t=14.898&pose=-0.6085,0.6933,0.2088,0.3246,0.983', muse: { at: [25.542, 47.686], facing: [25.838, 46.722] } },
  { key: 'work', what: 'Muse at its desk in the hut, head bowed over a book', hut: { at: [-2.4, 0.85], facing: [-2.4, 2.5] }, camera: { at: [-2.4, 2.6], height: 3.1, look: [-2.4, 0.9, 1.5], fov: 50 } },
  { key: 'work', what: 'Muse working on the bench, head bowed', muse: { busy: true }, camera: { orbit: 'muse', distance: 2.6, height: 1.5, aim: 0.9, azimuth: 25, fov: 50 } },
  { key: 'work', what: 'Muse working out in the meadow, head bowed', muse: { at: [8, 10], facing: [8, 20], busy: true }, camera: { orbit: 'muse', distance: 2.4, height: 1.5, aim: 0.8, azimuth: 30, fov: 50 } },
  { key: 'work', what: 'Muse cooking at the hearth, stirring its pot', hut: { doing: 'cook', s: 3 }, camera: { orbit: 'muse', distance: 1.6, azimuth: 30, height: 1.9, aim: 1.0, fov: 55 } },
  { key: 'work', what: 'Muse at the hearth, happy with a taste from its ladle', hut: { doing: 'cook', s: 10.3 }, camera: { head: true, distance: 1.0, azimuth: 35, rise: 12, face: [0.25, -0.05], fov: 55 } },
  { key: 'work', what: 'Muse at its stove, seen from the table laid with fruit', hut: { doing: 'cook', s: 3 }, camera: { at: [-1.8, 1.2], height: 1.5, look: [-0.2, -1.6, 1.1], fov: 55 } },
  { key: 'home', what: 'the cottage, its pier and pond, as in the painting', preset: 'homestead' },
  { key: 'home', what: 'the cottage and its pier from the meadow', camera: { at: [6, 10], height: 1.6, look: [-6, 4, 1], fov: 55 } },
  { key: 'home', what: 'the terrace, the bench and the door', camera: { at: [1.5, 6.5], height: 1.7, look: [-1, 2.6, 1.3], fov: 55 } },
  { key: 'home', what: 'the cottage across the pond', camera: { at: [-15, 38], height: 5, look: [0, 0, 2], fov: 45 } },
  { key: 'home', what: 'Muse on its bench, swinging its legs', muse: { part: 'bench', s: 3 }, camera: { orbit: 'muse', distance: 1.9, azimuth: 20, height: 0.9, aim: 0.7, fov: 55 } },
  { key: 'home', what: 'Muse waving hello on the rug in its hut, its dresser and stove behind', hut: { doing: 'greet', s: 1.6 }, camera: { orbit: 'muse', distance: 1.8, height: 1.5, aim: 1.0, fov: 58 } },
  { key: 'home', what: 'Muse asleep in its bed, the hearth glowing across the room', hut: { doing: 'sleep', s: 20 }, camera: { head: true, distance: 2.2, azimuth: 90, rise: 40, face: [0.2, 0.1], fov: 58 } },
  { key: 'home', what: 'Muse’s hut from a high corner: its dresser, table, stove and bed', hut: { away: true }, camera: { at: [3.5, 1.9], height: 2.8, look: [-1.2, -1.2, 0.5], fov: 60 } },
  { key: 'friend', what: 'Muse and a friend in the meadow, the friend waving', muse: { part: 'look about', s: 3 }, friend: { coat: PEACH, right: -1.1, ahead: 0.1, turn: -10, wave: 0.8 }, camera: { orbit: 'muse', distance: 3.2, azimuth: -12, height: 1.5, aim: 0.9, fov: 50 } },
  { key: 'friend', what: 'Muse fishing off the pier, a friend sat beside it, waving', muse: { part: 'fish', s: 20 }, friend: { coat: LAVENDER, right: 1.1, ahead: -0.1, turn: 30, wave: 0.8, deck: true }, camera: { orbit: 'muse', distance: 2.8, azimuth: -15, height: 1.8, aim: 0.6, fov: 50 } },
  { key: 'friend', what: 'Muse and a friend side by side on its bench', muse: { part: 'bench', s: 3 }, friend: { coat: PEACH, right: 0.8, deck: true }, camera: { orbit: 'muse', distance: 2.8, azimuth: 10, height: 1.5, aim: 0.7, fov: 55 } },
  { key: 'friend', what: 'Muse and a friend napping side by side in the grass, from above', muse: { part: 'nap', s: 30 }, friend: { coat: LAVENDER, right: 0.9 }, camera: { head: true, distance: 2.8, azimuth: -90, rise: 80, face: [0, 0.3], fov: 55 } },
  { key: 'friend', what: 'Muse and a friend sat in the flowers, a selfie of the two', muse: { part: 'sit', s: 5, pet: 1.5 }, friend: { coat: PEACH, right: -0.8, ahead: -0.05, turn: -15 }, camera: { head: true, distance: 1.7, azimuth: -10, rise: 28, face: [0.05, 0], roll: -6, fov: 72 } },
  { key: 'friend', what: 'a friend waving in Muse’s hut while it cooks', hut: { doing: 'cook', s: 3 }, friend: { coat: LAVENDER, right: -0.95, ahead: -0.4, turn: 40, wave: 0.8, deck: true }, camera: { orbit: 'muse', distance: 2.5, azimuth: 50, height: 2.0, aim: 1.0, fov: 60 } },
  { key: 'new-friend', what: 'a new friend waving hello to Muse', muse: { part: 'look about', s: 3 }, friend: { coat: SAGE, right: 1.2, ahead: 0.5, turn: 55, wave: 0.8 }, camera: { orbit: 'muse', distance: 3.6, azimuth: -20, height: 1.5, aim: 0.9, fov: 45 } },
  { key: 'new-friend', what: 'a new friend waving into Muse’s selfie', muse: { part: 'look about', s: 3, wave: 1.2 }, friend: { coat: SAGE, right: -0.85, ahead: -1.3, turn: -15, wave: 0.8 }, camera: { head: true, distance: 1.3, azimuth: 10, rise: 15, face: [-0.05, -0.15], roll: -5, fov: 72 } },
  { key: 'new-friend', what: 'a new friend come along the pier, waving hello to Muse at its fishing', muse: { part: 'fish', s: 20 }, friend: { coat: SAGE, ahead: -2.2, wave: 0.8, deck: true }, camera: { orbit: 'muse', distance: 3.2, azimuth: 60, height: 2.2, aim: 0.6, face: [-0.3, 0], fov: 52 } },
  { key: 'beyond', what: 'the whole planet from far out, its cottage side', preset: 'meadow', zoom: 0.05 },
  { key: 'beyond', what: 'the whole planet from far out, over its wetland', pose: '-0.426,0.3515,0.2406,0.7982,0.05' },
  { key: 'beyond', what: 'the whole planet from far out, its far side', focus: [0, -200], zoom: 0.07 },
  { key: 'invitation', what: 'along the pier to the pond, its chair waiting', camera: { at: [-1, 3.5], height: 2.3, look: [-8, 4.5, 1.0], fov: 55 } },
  { key: 'invitation', what: 'down the porch steps into the meadow', camera: { at: [2.9, 3.2], height: 2.3, look: [3.0, 8, 0.2], fov: 55 } },
  { key: 'invitation', what: 'into Muse’s hut, its stove lit and its table laid', hut: { away: true }, camera: { at: [0.5, 2.0], height: 2.4, look: [-0.6, -1.2, 0.8], fov: 60 } },
];

const [target, out = join(REPO, 'src/assets/postcards')] = process.argv.slice(2);
if (!target) {
  console.error('usage: node postcard-stills.mjs <target> [outDir]');
  process.exit(2);
}
const env = process.env;
const W = Number(env.W ?? 960);
const H = Number(env.H ?? 640);
const DPR = Number(env.DPR ?? 2);
const QUALITY = Number(env.QUALITY ?? 82);
const shots = env.SHOTS ? JSON.parse(readFileSync(env.SHOTS, 'utf8')) : SHOTS;
const counts = {};
const named = shots.map((s) => ({ ...s, file: `${s.key}-${(counts[s.key] = (counts[s.key] ?? 0) + 1)}.jpg` }));
const only = env.ONLY?.split(',').map((x) => x.trim());
const todo = only ? named.filter((s) => only.includes(s.key) || only.includes(s.file.replace(/\.jpg$/, ''))) : named;
mkdirSync(out, { recursive: true });
if (!only && !env.SHOTS) {
  const keep = new Set(named.map((s) => s.file));
  for (const f of readdirSync(out)) if (/^[a-z-]+-\d+\.jpg$/.test(f) && !keep.has(f)) rmSync(join(out, f));
}

/** In the page: put the world as a shot has it (Muse, its hut, the camera, a friend). Returns where the camera stands. */
async function stage(shot) {
  const w = window.__world;
  const m = window.__meadow;
  const g = window.__garden;
  const L = w.terrain.layout;
  const R = w.terrain.radius;
  const V = L.cottage.constructor;
  const deg = Math.PI / 180;
  /** Muse's head among its body's spheres (muse.ts BODY). */
  const HEAD = 3;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const U = L.cottage.clone();
  const X = new V().crossVectors(U, L.homeBearing).normalize();
  const Z = new V().crossVectors(X, U).normalize();
  /** A direction on the planet x m across and z m toward the pond from the cottage, along the surface. */
  const spot = ([x, z]) => {
    const d = Math.hypot(x, z);
    if (d < 1e-6) return U.clone();
    const t = X.clone().multiplyScalar(x / d).addScaledVector(Z, z / d);
    return U.clone().multiplyScalar(Math.cos(d / R)).addScaledVector(t, Math.sin(d / R)).normalize();
  };
  const point = (dir, h) => dir.clone().multiplyScalar(R + w.terrain.height(dir) + h);
  const tangent = (at, toward) => toward.clone().addScaledVector(at, -toward.dot(at)).normalize();
  /** Where a direction is in the homestead's frame (m across the cottage's front, toward its pond). */
  const across = (dir, digits = 1) => {
    const a = dir.clone().addScaledVector(U, -dir.dot(U)).normalize().multiplyScalar(Math.acos(Math.min(1, dir.dot(U))) * R);
    return [+a.dot(X).toFixed(digits), +a.dot(Z).toFixed(digits)];
  };
  const rig = w.rig;
  const muse = w.muse;
  const own = (u) => ({ value: Array.isArray(u.value) ? u.value.map((v) => v.clone()) : u.value?.clone ? u.value.clone() : u.value });
  g?.pins(false);
  // Muse: the garden tells it where to be every frame, so it is told once here and held there (put in its hut to do
  // something, the garden goes on putting it there)
  const direct = muse.direct.bind(muse);
  if (shot.url) {
    if (shot.muse?.at) {
      direct({ kind: 'out', dir: spot(shot.muse.at), toward: spot(shot.muse.facing), walk: 0, busy: Boolean(shot.muse.busy) });
      muse.direct = () => {};
    }
    await m.settle();
    await m.settle();
    const garden = g.state.snapshot?.today;
    if (!muse.drawn) return garden ? { day: garden } : null;
    const ahead = muse.where.dir.clone().addScaledVector(muse.where.heading, 1 / R).normalize();
    return { ...(garden ? { day: garden } : {}), muse: { at: across(muse.where.dir, 3), facing: across(ahead, 3) } };
  }
  const doing = shot.hut?.doing;
  if (shot.hut) {
    g.hut(doing ?? 'greet', true);
    for (let k = 0; !(g.inHut().open && g.inHut().loaded); k++) {
      if (k === 60) throw new Error('the hut did not open in 30 s');
      await sleep(500);
    }
    await sleep(1500);
    if (doing) {
      if (muse.direction.doing !== doing) throw new Error(`Muse is not at '${doing}' in its hut: ${muse.direction.kind} ${muse.direction.doing ?? ''}`);
      muse.insideSince = w.clock.time - (shot.hut.s ?? 0);
    } else if (shot.hut.away) {
      direct({ kind: 'hidden' });
    } else {
      const floor = muse.where.height;
      direct({ kind: 'out', dir: spot(shot.hut.at), toward: spot(shot.hut.facing), walk: 0, busy: true });
      const lifeAt = muse.lifeAt.bind(muse);
      muse.lifeAt = (...a) => Object.assign(lifeAt(...a), { height: floor });
    }
  } else if (!shot.muse) {
    direct({ kind: 'hidden' });
  } else if (shot.muse.at) {
    direct({ kind: 'out', dir: spot(shot.muse.at), toward: spot(shot.muse.facing), walk: 0, busy: Boolean(shot.muse.busy) });
  } else {
    direct({ kind: 'home', busy: Boolean(shot.muse.busy) });
  }
  if (!doing) muse.direct = () => {};
  const life = muse.life;
  const answer = () => {
    if (shot.muse?.wave !== undefined) muse.tap(w.clock.time - shot.muse.wave);
    if (shot.muse?.pet !== undefined) muse.hold(w.clock.time - shot.muse.pet, shot.muse.side ?? 1);
  };
  const seek = () => {
    if (!shot.muse?.part) return;
    life.at(3 * 3600, rig.camera.position);
    const part = life.names.filter((p) => p.name === shot.muse.part)[shot.muse.nth ?? 0];
    if (!part) throw new Error(`no part "${shot.muse.part}" #${shot.muse.nth ?? 0} in Muse's day`);
    life.seek(w.clock.time, part.start + shot.muse.s);
  };
  seek();
  answer();

  // the camera: the rig's own (a preset, a pose), or one of the shot's, the rig standing over it and the camera put there
  if (rig.__orig) rig.update = rig.__orig;
  if (shot.preset) m.preset(shot.preset);
  if (shot.focus) rig.lookAlong(spot(shot.focus), tangent(spot(shot.focus), Z));
  if (shot.pose) {
    rig.applyPose(shot.pose);
    w.markPosed?.();
  }
  if (shot.zoom !== undefined) rig.setZoom(shot.zoom, true);
  let framed = null;
  const c = shot.camera;
  if (c) {
    let at;
    let eye;
    let look;
    if (c.orbit) {
      const o = c.orbit;
      let subject;
      let front;
      if (o === 'muse') {
        muse.update(w.clock.time, w.terrain, rig.camera.position, w.look.uWindVec.value, w.look.uPixelAngle.value, true);
        subject = muse.where.dir.clone().multiplyScalar(R + muse.where.height);
        front = muse.where.heading.clone();
      } else if (o.bed !== undefined) {
        subject = point([...g.layout().beds.values()][o.bed].dir, 0);
      } else if (Array.isArray(o)) {
        subject = point(spot(o), 0);
      } else {
        // (the butterflies fly only about where the camera stands: stand there for a frame first)
        const near = spot(o.near ?? [0, 0]);
        rig.lookAlong(near, tangent(near, Z));
        rig.setZoom(1, true);
        await m.settle();
        m.renderFrame();
        const flying = (life) => {
          const a = life.mesh.geometry.attributes.aPos.array;
          return Array.from({ length: life.mesh.geometry.instanceCount }, (_, i) => new V(a[3 * i], a[3 * i + 1], a[3 * i + 2]));
        };
        const all = o.bird !== undefined ? flying(w.birds) : o.butterfly !== undefined ? flying(w.butterflies) : w.clouds.bounds().map((b) => b.centre.clone());
        all.sort((a, b) => a.clone().normalize().distanceTo(near) - b.clone().normalize().distanceTo(near));
        subject = all[o.bird ?? o.butterfly ?? o.cloud];
        if (!subject) throw new Error(`no such subject near the spot: ${JSON.stringify(o)} of ${all.length}`);
      }
      const centre = subject.clone().normalize();
      const away = (front ? tangent(centre, front) : tangent(centre, Z)).applyAxisAngle(centre, (c.azimuth ?? 0) * deg);
      at = centre.clone().applyAxisAngle(new V().crossVectors(centre, away).normalize(), c.distance / R).normalize();
      eye = point(at, c.height);
      look = subject.clone().addScaledVector(centre, c.aim ?? 0);
    } else if (c.head) {
      muse.update(w.clock.time, w.terrain, rig.camera.position, w.look.uWindVec.value, w.look.uPixelAngle.value, true);
      const s = muse.spheres[HEAD];
      look = new V(s.x, s.y, s.z);
      const up = look.clone().normalize();
      const away = tangent(up, muse.where.heading).applyAxisAngle(up, (c.azimuth ?? 0) * deg);
      const rise = (c.rise ?? 0) * deg;
      eye = look.clone().addScaledVector(away, c.distance * Math.cos(rise)).addScaledVector(up, c.distance * Math.sin(rise));
      at = eye.clone().normalize();
    } else {
      at = spot(c.at);
      eye = point(at, c.height);
      if (Array.isArray(c.look)) look = point(spot([c.look[0], c.look[1]]), c.look[2] ?? 0);
      else {
        const ahead = tangent(at, Z).applyAxisAngle(at, (c.look?.yaw ?? 0) * deg);
        const pitch = (c.look?.pitch ?? 0) * deg;
        look = eye.clone().addScaledVector(ahead, Math.cos(pitch)).addScaledVector(at, Math.sin(pitch));
      }
    }
    // (in the hut the cutaway keeps the rig where it stood)
    if (!shot.hut) {
      rig.lookAlong(at, tangent(at, look.clone().normalize().sub(at)));
      rig.setZoom(rig.zoomForAltitude(Math.max(c.height ?? eye.length() - R - w.terrain.height(at), 1.6)), true);
    }
    rig.__orig ??= rig.update.bind(rig);
    rig.update = (...a) => {
      rig.__orig(...a);
      const cam = rig.camera;
      cam.position.copy(eye);
      cam.up.copy(at);
      cam.lookAt(look);
      cam.fov = c.fov ?? 50;
      const half = Math.tan((cam.fov * deg) / 2);
      if (c.face) cam.rotateY(Math.atan(c.face[0] * half * cam.aspect)).rotateX(-Math.atan(c.face[1] * half));
      if (c.roll) cam.rotateZ(-c.roll * deg);
      cam.near = Math.min(cam.near, 0.05);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    framed = { at: across(at), ground: +w.terrain.height(at).toFixed(2) };
  }
  await m.settle();
  await m.settle();

  const f = shot.friend;
  if (f) {
    // its body: Muse's mesh with uniforms of its own where Muse has its own (its pose, place, coat), shared elsewhere
    if (f.wave !== undefined) {
      muse.tap(w.clock.time - f.wave);
      m.renderFrame();
    }
    const src = muse.mesh.material;
    const uniforms = Object.fromEntries(Object.entries(src.uniforms).map(([k, u]) => [k, k in muse.uniforms ? own(u) : u]));
    if (f.wave !== undefined) {
      // (the wave was the friend's: Muse back as it was, its answer to the tap forgotten)
      life.you.answer = null;
      life.you.lastWave = -Infinity;
      seek();
      answer();
    }
    const material = new src.constructor({ name: 'friend', vertexShader: src.vertexShader, fragmentShader: src.fragmentShader, uniforms, side: src.side, defines: { ...src.defines } });
    const body = new muse.mesh.constructor(muse.mesh.geometry, material);
    body.frustumCulled = false;
    body.renderOrder = 1;
    const up0 = muse.where.dir.clone();
    const ahead0 = tangent(up0, muse.where.heading);
    const left0 = new V().crossVectors(up0, ahead0);
    const up = up0.clone().addScaledVector(left0, -(f.right ?? 0) / R).addScaledVector(ahead0, (f.ahead ?? 0) / R).normalize();
    const forward = tangent(up, ahead0).applyAxisAngle(up, (f.turn ?? 0) * deg);
    const left = new V().crossVectors(up, forward);
    uniforms.uMusePos.value.copy(up).multiplyScalar(R + (f.deck ? muse.where.height : w.terrain.height(up)));
    uniforms.uMuseFrame.value.set(left.x, up.x, forward.x, left.y, up.y, forward.y, left.z, up.z, forward.z);
    uniforms.uMuseGrade.value.multiply(new V(...f.coat));
    w.scene.add(body);
    await m.settle();
  }
  if (framed && muse.drawn) framed.muse = across(muse.where.dir);
  return framed;
}

/** The page a shot is drawn in: its query, its hash and the time held there. The owner's URL keeps its own, the HUD off. */
function pageFor(shot) {
  if (!shot.url) return { search: '', hash: `hud=0&q=high&t=${shot.t ?? 12}`, t: shot.t ?? 12 };
  const at = shot.url.indexOf('#');
  const before = at < 0 ? (shot.url.includes('://') ? shot.url : '') : shot.url.slice(0, at);
  const search = before.includes('?') ? before.slice(before.indexOf('?')) : '';
  const pairs = (at < 0 ? (shot.url.includes('://') ? '' : shot.url) : shot.url.slice(at + 1)).split('&').filter(Boolean);
  const value = (key) => pairs.find((p) => p.split('=')[0] === key)?.slice(key.length + 1);
  const t = Number(value('t') || NaN);
  if (!Number.isFinite(t)) throw new Error('no t= in its URL: press T in the app before copying the address');
  const kept = pairs.filter((p) => !/^hud(=|$)/.test(p));
  return { search, hash: [...kept, 'hud=0', ...(value('q') === undefined ? ['q=high'] : [])].join('&'), t };
}

/**
 * In the page, before its own scripts: it reads the engine its URL names and never writes to it; given a day, the
 * garden as it stood then (its baskets up to that day, as its today, and nothing arriving while the page is open).
 */
function replayed(day) {
  const send = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if ((init?.method ?? input?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('a replayed page only reads');
    const response = await send(input, init);
    if (!day || !new URL(String(input?.url ?? input), location.href).pathname.endsWith('/garden') || !response.ok) return response;
    const garden = await response.json();
    const baskets = garden.baskets.filter((b) => b.day <= day);
    return new Response(JSON.stringify({ ...garden, today: day, baskets }), { headers: { 'content-type': 'application/json' } });
  };
  if (day) window.EventSource = class {
    close() {}
  };
}

const browser = await launch();
for (const shot of todo) {
  const file = join(out, shot.file);
  let opened;
  try {
    const { search, hash, t } = pageFor(shot);
    const init = search ? [`(${replayed})(${JSON.stringify(shot.day ?? null)})`] : [];
    opened = await openPage(browser, search ? `${target.replace(/\/+$/, '')}/${search}` : target, { hash, width: W, height: H, dpr: DPR, init });
    const { page } = opened;
    await page.waitForFunction(() => window.__world?.muse?.life && window.__garden, undefined, { timeout: 60_000 });
    await page.addStyleTag({ content: 'body > :not(canvas) { display: none !important; }' });
    const framed = await page.evaluate(stage, shot);
    await page.evaluate((t) => {
      const m = window.__meadow;
      m.freeze(t);
      m.setScale(1);
      m.renderFrame();
      m.renderFrame();
    }, t);
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, scale: 'css' });
    const kb = Math.round(statSync(file).size / 1024);
    console.log(`${shot.file}  ${kb} KB  ${shot.what ?? ''}${framed ? `  ${JSON.stringify(framed)}` : ''}${opened.errors.length ? `  ERRORS ${opened.errors.slice(0, 3).join(' | ')}` : ''}`);
  } catch (e) {
    console.log(`${shot.file}: FAILED ${String(e.message ?? e).split('\n')[0]}${opened?.errors.length ? `  page errors: ${opened.errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await opened?.ctx.close();
  }
}
await browser.close();
console.log(`${todo.length} stills in ${out}`);
