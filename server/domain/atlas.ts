// The planet as the map of Muse's mind: fixed regions on the renderer's cube-sphere, home, fog, and where
// each topic, hop and gift sits on the ground.
import { Vector3 } from 'three';
import type { Dir, Draw, MuseState, Place, RegionKey, TopicKey } from '../../src/muse/contract';
import { FACE_COUNT, sphereToFace, uvToSphere } from '../../src/planet/cubesphere';
import type { FieldParams } from '../../src/planet/fields';
import { travel } from '../../src/planet/geo';
import { createGroundSample, generateLayout, Terrain } from '../../src/planet/terrain';
import { parseRegion, regionKey } from './ids';
import {
  DRY_MARGIN_M,
  FIND_SPACING_RAD,
  FAR_MIN_ANGLE,
  HOP_MARGIN,
  HOP_STEP,
  HOP_WATER_TRIES,
  NEAR_CHOICES,
  PLACEMENT_RADIUS,
} from './policy/constants';
import { drawFor } from './rng';

/** Cells per face edge: 6 × 4 × 4 = 96 regions. */
export const REGION_GRID = 4;

const toDir = (v: Vector3): Dir => [v.x, v.y, v.z];
const vec = (d: Dir): Vector3 => new Vector3(d[0], d[1], d[2]);

function uvDir(face: number, u: number, v: number): Vector3 {
  return uvToSphere(face, u / REGION_GRID, v / REGION_GRID, new Vector3());
}

export const REGIONS: readonly RegionKey[] = Array.from({ length: FACE_COUNT * REGION_GRID * REGION_GRID }, (_, n) =>
  regionKey(Math.floor(n / (REGION_GRID * REGION_GRID)), Math.floor(n / REGION_GRID) % REGION_GRID, n % REGION_GRID),
);

const CENTRES: ReadonlyMap<RegionKey, Dir> = new Map(
  REGIONS.map((r) => {
    const { face, i, j } = parseRegion(r);
    return [r, toDir(uvDir(face, i + 0.5, j + 0.5))];
  }),
);

export function regionCentre(r: RegionKey): Dir {
  const c = CENTRES.get(r);
  if (!c) throw new Error(`not a region: ${r}`);
  return c;
}

export function regionOf(dir: Dir): RegionKey {
  const p = sphereToFace(vec(dir), { face: 0, a: 0, b: 0 });
  const cell = (x: number): number => Math.min(REGION_GRID - 1, Math.max(0, Math.floor(((x + 1) / 2) * REGION_GRID)));
  return regionKey(p.face, cell(p.a), cell(p.b));
}

export function angularDistance(a: Dir, b: Dir): number {
  const cross = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  return Math.atan2(cross, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

// Step just past the middle of each cell edge and see which cell that lands in: this crosses face edges too.
const NEIGHBOURS: ReadonlyMap<RegionKey, readonly RegionKey[]> = new Map(
  REGIONS.map((r) => {
    const { face, i, j } = parseRegion(r);
    const c = vec(regionCentre(r));
    const edges: [number, number][] = [
      [i, j + 0.5],
      [i + 1, j + 0.5],
      [i + 0.5, j],
      [i + 0.5, j + 1],
    ];
    const out = edges.map(([u, v]) => {
      const mid = uvDir(face, u, v);
      return regionOf(toDir(mid.clone().sub(c).multiplyScalar(0.15).add(mid).normalize()));
    });
    return [r, [...new Set(out)]];
  }),
);

/** The cells sharing an edge with `r`, across face edges too. */
export function neighbours(r: RegionKey): readonly RegionKey[] {
  return NEIGHBOURS.get(r) ?? [];
}

// ── The ground (Terrain.sample, the CPU mirror of the renderer's terrain) ──

// The renderer's default terrain parameters (src/params.ts, which the server can't import: it reads Vite's
// import.meta.env). Only the terrain ones move the shoreline; the flower ones are there to fill the type.
const FIELD_DEFAULTS: FieldParams = {
  roll: 1.25,
  hummocks: 0.8,
  wetlands: 0.45,
  waterLevel: 0,
  grain: 0.9,
  density: 12,
  patchiness: 0.95,
  patchSize: 13,
  weights: [0.21, 0.35, 0.33, 0.11],
};

const terrains = new Map<number, Terrain>();

function terrainFor(worldSeed: number): Terrain {
  let t = terrains.get(worldSeed);
  if (!t) {
    t = new Terrain(generateLayout(worldSeed));
    t.update(PLACEMENT_RADIUS, FIELD_DEFAULTS, (2 * PLACEMENT_RADIUS) / 512);
    terrains.set(worldSeed, t);
  }
  return t;
}

const ground = createGroundSample();

/** Signed distance (m) from `dir` to the nearest shore at R = PLACEMENT_RADIUS: negative on water. */
export function shoreDistance(worldSeed: number, dir: Dir): number {
  return terrainFor(worldSeed).sample(vec(dir), ground).water;
}

export function isDry(worldSeed: number, dir: Dir): boolean {
  return shoreDistance(worldSeed, dir) >= DRY_MARGIN_M;
}

/** The cottage. */
export function homePlace(worldSeed: number): Place {
  const dir = toDir(terrainFor(worldSeed).layout.cottage);
  return { dir, region: regionOf(dir) };
}

export function homeRegion(worldSeed: number): RegionKey {
  return homePlace(worldSeed).region;
}

/** A dry spot 12–30 m from the cottage: where gifts are planted and Muse rests. */
export function nearHome(worldSeed: number, draw: Draw): Place {
  const layout = terrainFor(worldSeed).layout;
  const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing);
  let best: { dir: Dir; shore: number } | null = null;
  for (let t = 0; t < HOP_WATER_TRIES; t++) {
    const a = 2 * Math.PI * draw('home.angle', t);
    const meters = 12 + 18 * draw('home.dist', t);
    const tangent = layout.homeBearing.clone().multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a));
    const dir = toDir(travel(layout.cottage, tangent, meters / PLACEMENT_RADIUS, new Vector3()));
    const shore = shoreDistance(worldSeed, dir);
    if (shore >= DRY_MARGIN_M) return { dir, region: regionOf(dir) };
    if (!best || shore > best.shore) best = { dir, shore };
  }
  const dir = best?.dir ?? toDir(layout.cottage);
  return { dir, region: regionOf(dir) };
}

/** One walking step inside a cell (local coordinates in [0, 1]²), turning back off the walls. */
function step(u: number, v: number, heading: number, length: number): { u: number; v: number; heading: number } {
  const lo = HOP_MARGIN;
  const hi = 1 - HOP_MARGIN;
  let du = length * Math.cos(heading);
  let dv = length * Math.sin(heading);
  if (u + du < lo || u + du > hi) du = -du;
  if (v + dv < lo || v + dv > hi) dv = -dv;
  return { u: Math.min(hi, Math.max(lo, u + du)), v: Math.min(hi, Math.max(lo, v + dv)), heading: Math.atan2(dv, du) };
}

/**
 * Where hop k of a trip stands. The trip walks from a seeded start on a seeded heading (the draw is per
 * trip), one step per hop, so consecutive finds sit next to each other and read as a trail. A step that
 * would land in water turns aside, then strides further; with no dry ground in reach Muse stays put.
 */
export function hopPlace(worldSeed: number, region: RegionKey, k: number, draw: Draw): Place {
  const { face, i, j } = parseRegion(region);
  const at = (u: number, v: number): Dir => toDir(uvDir(face, i + u, j + v));
  const span = 1 - 2 * HOP_MARGIN;
  let best = { u: 0.5, v: 0.5, shore: -Infinity };
  for (let t = 0; t < 2 * HOP_WATER_TRIES; t++) {
    const u = HOP_MARGIN + span * draw('hop.u', t);
    const v = HOP_MARGIN + span * draw('hop.v', t);
    const shore = shoreDistance(worldSeed, at(u, v));
    if (shore > best.shore) best = { u, v, shore };
    if (shore >= DRY_MARGIN_M) break;
  }
  let pos = { u: best.u, v: best.v, heading: 2 * Math.PI * draw('hop.heading') };
  for (let hop = 1; hop <= k; hop++) {
    let next = { ...pos, heading: pos.heading + Math.PI / 2 };
    for (let t = 0; t < HOP_WATER_TRIES; t++) {
      const turn = (t % 2 === 0 ? 1 : -1) * Math.ceil(t / 2) * (Math.PI / 6);
      const stride = HOP_STEP * (1 + Math.floor(t / 6));
      const tried = step(pos.u, pos.v, pos.heading + turn, stride);
      if (shoreDistance(worldSeed, at(tried.u, tried.v)) >= DRY_MARGIN_M) {
        next = tried;
        break;
      }
    }
    pos = next;
  }
  return { dir: at(pos.u, pos.v), region };
}

/**
 * The i-th find kept on one hop. The first stands where Muse stood; each later one is planted a short way off at
 * golden-angle turns, so two objects never share an anchor, turning further round if that spot is under water.
 */
export function besidePlace(worldSeed: number, hop: Place, i: number): Place {
  if (i === 0) return hop;
  const [x, y, z] = hop.dir;
  const ref: Dir = Math.abs(y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = normalize([y * ref[2] - z * ref[1], z * ref[0] - x * ref[2], x * ref[1] - y * ref[0]]);
  const t2: Dir = [y * t1[2] - z * t1[1], z * t1[0] - x * t1[2], x * t1[1] - y * t1[0]];
  const golden = Math.PI * (3 - Math.sqrt(5));
  let fallback: Dir | null = null;
  for (let t = 0; t < 12; t++) {
    const a = (i + t) * golden;
    const r = FIND_SPACING_RAD * Math.sqrt(i);
    const dir = normalize([x + r * (Math.cos(a) * t1[0] + Math.sin(a) * t2[0]), y + r * (Math.cos(a) * t1[1] + Math.sin(a) * t2[1]), z + r * (Math.cos(a) * t1[2] + Math.sin(a) * t2[2])]);
    fallback ??= dir;
    if (shoreDistance(worldSeed, dir) >= DRY_MARGIN_M) return { dir, region: regionOf(dir) };
  }
  return { dir: fallback ?? hop.dir, region: regionOf(fallback ?? hop.dir) };
}

function normalize(v: Dir): Dir {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

// ── Fog and new areas ──────────────────────────────────────────────────────

function byDistanceFrom(anchor: RegionKey, regions: readonly RegionKey[]): RegionKey[] {
  const c = regionCentre(anchor);
  return regions
    .map((r) => ({ r, d: angularDistance(c, regionCentre(r)) }))
    .sort((a, b) => a.d - b.d || (a.r < b.r ? -1 : a.r > b.r ? 1 : 0))
    .map((x) => x.r);
}

const fogged = (s: MuseState): RegionKey[] => REGIONS.filter((r) => !s.regions.has(r));

/** A new topic opens one of the nearest fogged regions to its related topic's region, or to home. */
export function regionForNewTopic(s: MuseState, relatedTo: TopicKey | null, draw: Draw): RegionKey {
  const anchor = (relatedTo && s.interests.get(relatedTo)?.region) || s.home;
  const near = byDistanceFrom(anchor, fogged(s)).slice(0, NEAR_CHOICES);
  if (near.length === 0) return anchor;
  return near[Math.floor(draw('area.near') * near.length)];
}

/** Serendipity: a fogged region on the far side of the planet from home. */
export function farRegion(s: MuseState, draw: Draw): RegionKey {
  const home = regionCentre(s.home);
  const fog = fogged(s);
  const far = fog.filter((r) => angularDistance(home, regionCentre(r)) >= FAR_MIN_ANGLE);
  const pool = far.length > 0 ? far : byDistanceFrom(s.home, fog.length > 0 ? fog : REGIONS).slice(-1);
  return pool[Math.floor(draw('area.far') * pool.length)];
}

/**
 * Where Muse stands now on its own planet; null while beyond or a guest on a friend's planet (no follow).
 * `draw` is the episode's draw, the one its hops were placed with.
 */
export function placeNow(s: MuseState, draw?: Draw): Place | null {
  const ep = s.episode;
  if (!ep) return homePlace(s.seed.worldSeed);
  const d = draw ?? drawFor(s.seed.id, ep.n);
  switch (ep.plan.activity) {
    case 'beyond':
      return null;
    case 'visit':
      return ep.plan.role === 'guest' ? null : homePlace(s.seed.worldSeed);
    case 'rest':
      return nearHome(s.seed.worldSeed, d);
    case 'travel':
      return hopPlace(s.seed.worldSeed, ep.plan.trip.region, Math.max(0, ep.hops - 1), d);
  }
}
