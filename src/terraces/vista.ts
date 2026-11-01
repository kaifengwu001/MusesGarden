import { PerspectiveCamera, Vector3 } from 'three';
import { tangentToward } from '../planet/geo';
import { unwarpPoint, type WarpFrame } from '../render/warp';
import { gradientFrame } from './fields';
import { PLOT_FLAT } from './plots';
import { createTerraceSample, type TerraceTerrain } from './terrain';

// The vista (the Vista button, the squint test): a stand and heading framed
// like the green terraces painting (reference/terraces/vista-green.webp):
// looking down across terraces, flooded fields running through them in
// pale bands, forest in dark masses, no sky. Searched as the meadow's is
// (view/vista.ts): stands on terraced slopes, a few headings each, a coarse
// grid of view rays marched through the warp to the ground, each hit sorted
// into forest, open water or crop, the shares of each per row compared
// with the painting's (measured once, below), the best few refined.

/** The painting squinted to 9 × 16: f forest (its dark masses), w open water (its pale fields), c crop. */
const LAYOUT = ['ccccccccc', 'ccccccccc', 'ccccccccf', 'cccccccff', 'ffcccccww', 'ccccccwwc', 'cfffcccwc', 'cccccwcwc', 'fccwcwccc', 'cccwcwccc', 'ccccccwcc', 'fcccccwcw', 'fccccwwcw', 'fcccccccc', 'ccccccccc', 'ccccccccc'];
const GRID = { x: 9, y: 16 } as const;

export interface TerraceVista {
  readonly focus: Vector3;
  readonly forward: Vector3;
  /** Height over the stand (m) and tilt from straight down (rad). */
  readonly height: number;
  readonly tilt: number;
  readonly score: number;
}

/** How the camera frames a view at a height: its tilt is given; its field of view and warp come from the rig. */
export type VistaFraming = (height: number) => { fov: number; k: number };

const s = createTerraceSample();
const q = new Vector3();
const p = new Vector3();
const ray = new Vector3();

/** Villages to keep out of the vista (the painting has none): their middles and reach (m). */
let avoid: ReadonlyArray<{ dir: Vector3; radius: number }> = [];

/** The level of the last terraced ground a ray met (-1e9: none). */
let lastLevel = -1e9;

/** The class of what a view ray meets (f, w, c; h for a village, which the painting has none of), or s for sky. */
function classify(terrain: TerraceTerrain, origin: Vector3, dir: Vector3, warp: WarpFrame): string {
  lastLevel = -1e9;
  const R = terrain.radius;
  let t = 1;
  for (let i = 0; i < 90; i++) {
    q.copy(origin).addScaledVector(dir, t);
    unwarpPoint(warp, q, p);
    const len = p.length();
    const above = len - R;
    if (above < 0 || above < terrain.fields.natural(p.divideScalar(len))) {
      for (const v of avoid) if (p.distanceTo(v.dir) * R < v.radius + 12) return 'h';
      terrain.terraceAt(p, s);
      if (s.wild > 0.5) return 'f';
      // (the valleys' flat floors, their plots under the fog: the painting shows only the slopes)
      if (s.kind === PLOT_FLAT) return 'v';
      lastLevel = s.level;
      return !s.crop.fallow && s.crop.maturity < 0.3 ? 'w' : 'c';
    }
    if (t > 700) break;
    t += Math.max(1.2, 0.045 * t, 0.5 * (above - terrain.maxHeight));
  }
  return 's';
}

/** How a pose's view compares with the painting's layout (higher is closer); gx × gy rays. */
function score(terrain: TerraceTerrain, camera: PerspectiveCamera, warp: WarpFrame, gx: number, gy: number): number {
  // the terraces' bands each column crosses (the painting: about one a row of the grid)
  let bands = 0;
  const lastInColumn = new Array<number>(gx).fill(-1e9);
  const rows: Array<{ f: number; w: number; s: number; h: number; v: number; n: number; match: number }> = Array.from({ length: GRID.y }, () => ({ f: 0, w: 0, s: 0, h: 0, v: 0, n: 0, match: 0 }));
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const u = ((i + 0.5) / gx) * 2 - 1;
      const v = 1 - ((j + 0.5) / gy) * 2;
      ray.set(u, v, 0.5).unproject(camera).sub(camera.position).normalize();
      const c = classify(terrain, camera.position, ray, warp);
      if (lastLevel > -1e8) {
        if (lastInColumn[i] > -1e8 && lastLevel !== lastInColumn[i]) bands += Math.min(Math.abs(lastLevel - lastInColumn[i]), 3);
        lastInColumn[i] = lastLevel;
      }
      const row = Math.min(GRID.y - 1, Math.floor(((j + 0.5) / gy) * GRID.y));
      const col = Math.min(GRID.x - 1, Math.floor(((i + 0.5) / gx) * GRID.x));
      const r = rows[row];
      r.n++;
      if (c === 'f') r.f++;
      else if (c === 'w') r.w++;
      else if (c === 's') r.s++;
      else if (c === 'h') r.h++;
      else if (c === 'v') r.v++;
      if (c === LAYOUT[row][col]) r.match++;
    }
  }
  let total = 0.25 * Math.min(bands / (gx * (gy - 1)), 1);
  rows.forEach((r, k) => {
    if (r.n === 0) return;
    const ref = LAYOUT[k];
    const F = [...ref].filter((c) => c === 'f').length / ref.length;
    const W = [...ref].filter((c) => c === 'w').length / ref.length;
    total -= (r.f / r.n - F) ** 2 + (r.w / r.n - W) ** 2 + 2 * (r.s / r.n) ** 2 + 2 * (r.h / r.n) ** 2 + (r.v / r.n) ** 2;
    total += (0.05 * r.match) / r.n;
  });
  return total;
}

const cache = new Map<string, TerraceVista>();

/**
 * The stand and heading that frame the terraces like the painting. key: what
 * the result depends on (the world, its size, the framing); cached.
 */
export function findTerraceVista(terrain: TerraceTerrain, framing: VistaFraming, aspect: number, height: number, tilt: number, villages: ReadonlyArray<{ dir: Vector3; radius: number }>, key: string): TerraceVista {
  const hit = cache.get(key);
  if (hit) return hit;
  avoid = villages;
  const R = terrain.radius;
  const camera = new PerspectiveCamera(40, aspect, 0.1, 5000);
  const warp = { focus: new Vector3(), up: new Vector3(), k: 0 };
  const a = new Vector3();
  const b = new Vector3();
  const fwd = new Vector3();
  const pose = (focus: Vector3, forward: Vector3, h: number, tl: number): void => {
    const f = framing(h);
    const ground = terrain.height(focus);
    camera.fov = f.fov;
    camera.aspect = aspect;
    camera.position.copy(focus).multiplyScalar(R + ground + h);
    camera.up.copy(forward).multiplyScalar(Math.cos(tl)).addScaledVector(focus, Math.sin(tl));
    const look = forward.clone().multiplyScalar(Math.sin(tl)).addScaledVector(focus, -Math.cos(tl)).add(camera.position);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    warp.focus.copy(focus).multiplyScalar(R + ground);
    warp.up.copy(focus);
    warp.k = f.k;
  };
  // 1. stands on terraced slopes, each looked at downhill and to either side of it
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = 420;
  const found: Array<{ focus: Vector3; forward: Vector3; score: number }> = [];
  const d = new Vector3();
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
    terrain.terraceAt(d, s);
    if (s.wild > 0.1 || s.slope < 0.2 || s.slope > 0.6) continue;
    if (villages.some((v) => d.distanceTo(v.dir) * R < v.radius + 40)) continue;
    gradientFrame(d, a, b);
    const e = 2 / R;
    const h0 = s.natural;
    const ha = terrain.fields.natural(q.copy(d).addScaledVector(a, e).normalize()) - h0;
    const hb = terrain.fields.natural(q.copy(d).addScaledVector(b, e).normalize()) - h0;
    fwd.copy(a).multiplyScalar(-ha).addScaledVector(b, -hb);
    if (fwd.lengthSq() < 1e-12) continue;
    fwd.normalize();
    for (const turn of [-0.8, 0, 0.8]) {
      const forward = fwd.clone().applyAxisAngle(d, turn);
      pose(d, forward, height, tilt);
      found.push({ focus: d.clone(), forward, score: score(terrain, camera, warp, 5, 8) });
    }
  }
  found.sort((x, y) => y.score - x.score);
  // 2. the best few refined: heading, height and tilt, at the full grid
  let best: TerraceVista = { focus: new Vector3(0, 1, 0), forward: new Vector3(1, 0, 0), height, tilt, score: -Infinity };
  for (const c of found.slice(0, 6)) {
    for (const turn of [-0.25, 0, 0.25]) {
      for (const h of [height * 0.75, height * 1.3]) {
        for (const tl of [tilt - 0.08, tilt + 0.05]) {
          const forward = c.forward.clone().applyAxisAngle(c.focus, turn);
          pose(c.focus, forward, h, tl);
          const sc = score(terrain, camera, warp, GRID.x, GRID.y);
          if (sc > best.score) best = { focus: c.focus.clone(), forward: tangentToward(c.focus, forward.clone().add(c.focus), new Vector3()), height: h, tilt: tl, score: sc };
        }
      }
    }
  }
  cache.set(key, best);
  return best;
}
