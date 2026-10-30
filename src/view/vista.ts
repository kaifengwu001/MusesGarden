import { Vector3 } from 'three';
import { clamp } from '../core/math';
import type { Terrain } from '../planet/terrain';

// The vista: a stand and a heading that frame the meadow like the reference
// still (reference/howls-lake.webp, kept out of git): meadow up to the top of
// the frame, a band of lake and islands across the middle, meadow again in
// the foreground, a cloud over the far meadow on the right. The planet is
// searched for it: candidate stands × headings, each scored by casting a
// grid of view rays to the water table (through the tiny-planet warp) and
// comparing the water's share per row of the frame (mostly) and per cell
// with the still's; the best few are refined in place, heading and zoom, and
// scored for a cloud where the still has one.

const GW = 16;
const GH = 9;
/** Water share per cell of the still (16 × 9, top row first), measured from it once. */
const LAYOUT = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0.3, 0.3, 0.4, 0.4, 0.4, 0.4, 0.3, 0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0, 0, 0],
  [0.9, 1, 0.9, 0.7, 0.6, 0.6, 0.8, 0.7, 0.6, 0.6, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2],
  [0.9, 0.8, 0.8, 0.8, 0.8, 0.8, 0.9, 1, 1, 1, 0.9, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0.1, 0.1, 0.3, 0.8, 0.7, 0.3, 0.1, 0, 0, 0.1, 0.1],
  [0, 0, 0.1, 0.3, 0.4, 0.4, 0.5, 0.6, 0.5, 0.3, 0.2, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];
/** Where the still has its cloud: the upper rows, right half. */
const CLOUD_CELLS = { rows: [0, 1], cols: [8, 15] } as const;
/** Zooms tried when refining (eyes about 4–6 m up at R 128, looking 20–30° down, in the flat band of the warp). */
const ZOOMS = [0.77, 0.8, 0.83];

export interface Framing {
  altitude: number;
  /** From straight down, rad. */
  tilt: number;
  /** Vertical, degrees. */
  fov: number;
  /** Tiny-planet warp k (1/m). */
  k: number;
}

export interface CloudBound {
  centre: Vector3;
  radius: number;
}

export interface Vista {
  focus: Vector3;
  forward: Vector3;
  zoom: number;
  /** Mean squared water-share error per cell, plus penalties (lower is better). */
  score: number;
}

/** View rays of one framing, cast once in a canonical frame (focus +y, forward −z, right +x). */
interface RayTable {
  w: number;
  h: number;
  /** Hit direction per cell (canonical frame), or NaN for sky. */
  hits: Float32Array;
  /** Target water share per cell. */
  target: Float32Array;
  framing: Framing;
  aspect: number;
}

/** The still's water share at a point of the frame (u, v ∈ [0, 1], v down), bilinear. */
function layoutAt(u: number, v: number): number {
  const x = clamp(u * GW - 0.5, 0, GW - 1);
  const y = clamp(v * GH - 0.5, 0, GH - 1);
  const x0 = Math.min(Math.floor(x), GW - 2);
  const y0 = Math.min(Math.floor(y), GH - 2);
  const fx = x - x0;
  const fy = y - y0;
  const row = (r: number): number => LAYOUT[r][x0] * (1 - fx) + LAYOUT[r][x0 + 1] * fx;
  return row(y0) * (1 - fy) + row(y0 + 1) * fy;
}

/** Cast the rays of a framing onto the water table (radius R), through the warp. */
function castRays(radius: number, framing: Framing, aspect: number, w: number, h: number): RayTable {
  const hits = new Float32Array(w * h * 3);
  const target = new Float32Array(w * h);
  const { altitude, tilt, fov, k } = framing;
  const camY = radius + altitude;
  const look = new Vector3(0, -Math.cos(tilt), -Math.sin(tilt));
  const camUp = new Vector3(0, Math.sin(tilt), -Math.cos(tilt));
  const right = new Vector3().crossVectors(look, camUp).normalize();
  const upOrtho = new Vector3().crossVectors(right, look);
  const tanV = Math.tan((fov * Math.PI) / 360);
  const d = new Vector3();
  const q = new Vector3();
  // height of a view-space point above the water table, through the warp (focus at (0, R, 0), up +y)
  const above = (s: number): number => {
    q.set(d.x * s, camY + d.y * s, d.z * s);
    const lift = k * (q.x * q.x + q.z * q.z);
    return Math.hypot(q.x, q.y + lift, q.z) - radius;
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      const v = (j + 0.5) / h;
      target[j * w + i] = layoutAt(u, v);
      d.copy(look)
        .addScaledVector(right, (u * 2 - 1) * tanV * aspect)
        .addScaledVector(upOrtho, (1 - v * 2) * tanV)
        .normalize();
      let s = 0;
      let f = above(0);
      let hit = false;
      for (let step = 0; step < 400 && s < altitude + 3 * radius; step++) {
        const next = s + Math.max(0.05, f * 0.6);
        const fn = above(next);
        if (fn < 0) {
          let lo = s;
          let hi = next;
          for (let b = 0; b < 16; b++) {
            const mid = (lo + hi) / 2;
            if (above(mid) > 0) lo = mid;
            else hi = mid;
          }
          above(hi);
          const lift = k * (q.x * q.x + q.z * q.z);
          q.y += lift;
          q.normalize();
          hits.set([q.x, q.y, q.z], (j * w + i) * 3);
          hit = true;
          break;
        }
        s = next;
        f = fn;
      }
      if (!hit) hits.set([NaN, NaN, NaN], (j * w + i) * 3);
    }
  }
  return { w, h, hits, target, framing, aspect };
}

const dir = new Vector3();
const right = new Vector3();

/** Weight of the per-row water share in the score; the rest is per cell. */
const ROW_WEIGHT = 0.7;

/**
 * How far a pose's water and land are from the still's: squared error of the
 * water share per row (where the lake lies in depth) and per cell (where it
 * lies across), sky counted as wrong.
 */
function layoutError(table: RayTable, terrain: Terrain, focus: Vector3, forward: Vector3): number {
  right.crossVectors(forward, focus);
  let cells = 0;
  let rows = 0;
  for (let j = 0; j < table.h; j++) {
    let got = 0;
    let want = 0;
    for (let i = 0; i < table.w; i++) {
      const c = j * table.w + i;
      const x = table.hits[c * 3];
      let water = 0.5;
      if (Number.isNaN(x)) cells += 1;
      else {
        dir.copy(right).multiplyScalar(x).addScaledVector(focus, table.hits[c * 3 + 1]).addScaledVector(forward, -table.hits[c * 3 + 2]);
        water = clamp(0.5 - terrain.height0(dir) / 0.3, 0, 1);
        cells += (water - table.target[c]) ** 2;
      }
      got += water;
      want += table.target[c];
    }
    rows += ((got - want) / table.w) ** 2;
  }
  return ROW_WEIGHT * (rows / table.h) + (1 - ROW_WEIGHT) * (cells / (table.w * table.h));
}

const flora = new Float32Array(4);

/** Flowers in the foreground (lower rows, on land) against the meadow's mean: the still is thick with them. */
function flowerScore(table: RayTable, terrain: Terrain, focus: Vector3, forward: Vector3): number {
  right.crossVectors(forward, focus);
  const f = terrain.fields;
  let sum = 0;
  let n = 0;
  for (let j = Math.floor(table.h * 0.55); j < table.h; j++) {
    for (let i = 0; i < table.w; i += 2) {
      const c = j * table.w + i;
      if (Number.isNaN(table.hits[c * 3])) continue;
      dir.copy(right).multiplyScalar(table.hits[c * 3]).addScaledVector(focus, table.hits[c * 3 + 1]).addScaledVector(forward, -table.hits[c * 3 + 2]);
      f.flora(dir, f.wetness(dir), flora);
      sum += flora[0] + flora[1] + flora[2] + flora[3];
      n++;
    }
  }
  const mean = f.speciesDensity[0] + f.speciesDensity[1] + f.speciesDensity[2] + f.speciesDensity[3];
  return n > 0 && mean > 0 ? -0.02 * Math.min(sum / n / mean, 2) : 0;
}

/** Cells of the frame a cloud covers, scored: covering the still's cloud cells is good, the lake and foreground bad. */
function cloudScore(table: RayTable, radius: number, ground: number, clouds: readonly CloudBound[], focus: Vector3, forward: Vector3): number {
  const { altitude, tilt, fov, k } = table.framing;
  const tanV = Math.tan((fov * Math.PI) / 360);
  const look = new Vector3(0, -Math.cos(tilt), -Math.sin(tilt));
  const camUp = new Vector3(0, Math.sin(tilt), -Math.cos(tilt));
  const r = new Vector3().crossVectors(look, camUp).normalize();
  const upOrtho = new Vector3().crossVectors(r, look);
  right.crossVectors(forward, focus);
  const covered = new Uint8Array(GW * GH);
  const p = new Vector3();
  let near = 0;
  for (const cloud of clouds) {
    // into the canonical frame, warped about the focus, relative to the camera
    p.set(cloud.centre.dot(right), cloud.centre.dot(focus), -cloud.centre.dot(forward));
    p.y -= k * (p.x * p.x + p.z * p.z);
    p.y -= radius + ground + altitude;
    // a cloud around the camera thins away (clouds.glsl): it neither helps nor should crowd the stand
    if (p.length() - 0.6 * cloud.radius < 16) {
      near += 1;
      continue;
    }
    const depth = p.dot(look);
    if (depth < 1) continue;
    const x = p.dot(r) / (depth * tanV * table.aspect);
    const y = p.dot(upOrtho) / (depth * tanV);
    const rad = (cloud.radius * 0.8) / (depth * tanV);
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const cx = ((i + 0.5) / GW) * 2 - 1;
        const cy = 1 - ((j + 0.5) / GH) * 2;
        if (((cx - x) * table.aspect) ** 2 + (cy - y) ** 2 < rad * rad) covered[j * GW + i] = 1;
      }
    }
  }
  let score = 0;
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      if (!covered[j * GW + i]) continue;
      const wanted = j >= CLOUD_CELLS.rows[0] && j <= CLOUD_CELLS.rows[1] && i >= CLOUD_CELLS.cols[0] && i <= CLOUD_CELLS.cols[1];
      score += wanted ? -1 : j >= 3 ? 0.6 : 0.2;
    }
  }
  return score / (GW * GH) + 0.03 * near;
}

/** Evenly spread directions (Fibonacci sphere). */
function sphereDesign(n: number): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(1 - z * z);
    return new Vector3(s * Math.cos(golden * i), s * Math.sin(golden * i), z);
  });
}

function headingAt(focus: Vector3, angle: number, out: Vector3): Vector3 {
  const ref = Math.abs(focus.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const north = ref.addScaledVector(focus, -ref.dot(focus)).normalize();
  const east = new Vector3().crossVectors(north, focus);
  return out.copy(north).multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle));
}

interface Ranked {
  focus: Vector3;
  angle: number;
  score: number;
}

/** Stage 1 depends only on the terrain and the framing: kept for the world it was run for. */
let cache: { key: string; ranked: Ranked[] } | null = null;

/**
 * Search the planet for the vista. `framing(z)` gives the camera at zoom z;
 * `clouds` are where the clouds are now (planet space); `key` names the
 * terrain and framing (the slow first stage is reused while it holds).
 */
export function findVista(terrain: Terrain, framing: (z: number) => Framing, aspect: number, clouds: readonly CloudBound[], bloomed: (dir: Vector3) => boolean, key: string): Vista {
  const R = terrain.radius;
  const ranked = cache?.key === `${key}/${aspect}` ? cache.ranked : rankStands(terrain, framing, aspect, bloomed);
  cache = { key: `${key}/${aspect}`, ranked };
  return refine(terrain, framing, aspect, clouds, ranked, R);
}

function rankStands(terrain: Terrain, framing: (z: number) => Framing, aspect: number, bloomed: (dir: Vector3) => boolean): Ranked[] {
  const R = terrain.radius;
  const f = terrain.fields;
  // stage 1: stands about 8 m apart on dry ground in the wetlands, 12 headings, a coarse 8 × 5 grid of rays
  const coarse = castRays(R, framing(ZOOMS[1]), aspect, 8, 5);
  const stands = sphereDesign(clamp(Math.round((4 * Math.PI * R * R) / 64), 400, 4000)).filter((d) => {
    if (!bloomed(d)) return false;
    const h = terrain.height0(d);
    return h > 0.15 && h < 3 && f.wetness(d) > 0.2;
  });
  const heading = new Vector3();
  const ranked: Ranked[] = [];
  for (const focus of stands) {
    for (let a = 0; a < 12; a++) {
      const angle = (a / 12) * Math.PI * 2;
      ranked.push({ focus, angle, score: layoutError(coarse, terrain, focus, headingAt(focus, angle, heading)) });
    }
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked.slice(0, 400);
}

// stage 2: the best stands, moved a few meters, turned a little and zoomed,
// on the full 16 × 9 grid, with the clouds
function refine(terrain: Terrain, framing: (z: number) => Framing, aspect: number, clouds: readonly CloudBound[], ranked: readonly Ranked[], R: number): Vista {
  const heading = new Vector3();
  const fine = ZOOMS.map((z) => castRays(R, framing(z), aspect, GW, GH));
  let best: Vista = { focus: new Vector3(0, 1, 0), forward: new Vector3(0, 0, -1), zoom: ZOOMS[1], score: Infinity };
  const seen = new Set<Vector3>();
  const side = new Vector3();
  const moved = new Vector3();
  for (const cand of ranked) {
    if (seen.has(cand.focus)) continue;
    seen.add(cand.focus);
    if (seen.size > 16) break;
    headingAt(cand.focus, cand.angle, heading);
    side.crossVectors(heading, cand.focus);
    for (const [ahead, across] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
      moved.copy(cand.focus).addScaledVector(heading, ahead / R).addScaledVector(side, across / R).normalize();
      const ground = terrain.height0(moved);
      if (ground < 0.1) continue;
      for (const da of [-0.26, -0.13, 0, 0.13, 0.26]) {
        headingAt(moved, cand.angle + da, heading);
        fine.forEach((table, zi) => {
          const score = layoutError(table, terrain, moved, heading) + cloudScore(table, R, ground, clouds, moved, heading) + flowerScore(table, terrain, moved, heading);
          if (score < best.score) best = { focus: moved.clone(), forward: heading.clone(), zoom: ZOOMS[zi], score };
        });
      }
      headingAt(cand.focus, cand.angle, heading);
    }
  }
  return best;
}
