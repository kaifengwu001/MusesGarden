import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix as hashMix } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import type { GroundSample } from '../planet/terrain';
import { gradientFrame, TerraceFields, type TerraceBase, type TerraceFieldParams } from './fields';

// The terraced ground on the CPU: the camera's footing, picking, placement
// and tests read it (terrain.glsl's twin is ground.glsl, paddy.glsl).
//
//   levels   the hills cut into levels a riser apart (the bake's offset
//            shifts where they fall); a flat paddy floor each, a bund along
//            its outer edge on top of the riser below, a riser up to the next
//            level at its inner edge. Widths in meters, as shares of the
//            band they sit in (a band is riser / slope wide)
//   paddies  a level's band cut across by cross-bunds: within a cell of a
//            Voronoi tiling (direction space, chosen per octave of R) every
//            9–22 m along the contour's way at the cell's middle, staggered
//            from level to level, and at the cell's edge. Each paddy decides
//            its infill: its place in the season, or fallow
//   wild     forest, peaks, steep slopes and hilltops keep their own shape

export const R_REF = 128;
/** Riser height (m), the riser's width (m), the bund's width (m) and height (m), the water in a paddy (m). */
export const TERRACE = { step: 0.8, riser: 0.45, bund: 0.38, bundHeight: 0.2, water: 0.08 } as const;
/** The cells that cut the bands are about this wide (m), the Voronoi tiling chosen per octave of R. */
export const CELL_M = 48;
/** Within a cell each level is cut every so many meters along the band (its own spacing, between these), and a share of paddies lie fallow. */
export const PADDY = { cuts: [9, 22], fallow: 0.05 } as const;
/** How the season spreads: the share of the season field in a paddy's delay (the rest its own chance), and its width. */
export const SEASON = { field: 0.3, spread: 0.42 } as const;
/** The mesh keeps its terraces out to this distance (m), and has the hills' own shape from this one. */
export const MESH_TERRACES = { near: 22, far: 46 } as const;

export interface TerraceLayout {
  readonly seed: number;
  readonly noiseSeed: number;
  /** Axis the hills run along a little. */
  readonly grain: Vector3;
}

function sequence(seed: number): () => number {
  let state = hash32((seed ^ 0x3c6ef372) >>> 0);
  return () => ((state = hash32((state + 0x9e3779b9) >>> 0)) >>> 8) / 16777216;
}

export function generateTerraceLayout(seed: number): TerraceLayout {
  const rand = sequence(seed);
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return { seed, noiseSeed: hash32(hashMix(seed, 0x51ce7a)), grain: new Vector3(s * Math.cos(a), s * Math.sin(a), z) };
}

/** A point of the terraced ground (mirrors Terrace in ground.glsl). */
export interface TerraceSample {
  natural: number;
  slope: number;
  wild: number;
  x: number;
  level: number;
  f: number;
  floorH: number;
  rise: number;
  bund: number;
  height: number;
}

export function createTerraceSample(): TerraceSample {
  return { natural: 0, slope: 0, wild: 0, x: 0, level: 0, f: 0, floorH: 0, rise: 0, bund: 0, height: 0 };
}

/** One paddy (mirrors Paddy in paddy.glsl). */
export interface PaddySample {
  id: number;
  /** Its cell's middle, and the band's way there. */
  centre: Vector3;
  along: Vector3;
  /** Distance (m) to the nearest cross-bund. */
  wall: number;
  variant: number;
  maturity: number;
  fallow: boolean;
}

/** GLSL meadowHash over an integer cell (noise.glsl), bit-identical. */
function cellHash(x: number, y: number, z: number, seed: number): number {
  const h = Math.imul((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ seed) >>> 0, 0x27d4eb2d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

const unitHash = (h: number): number => (h >>> 8) / 16777216;

const base: TerraceBase = { natural: 0, slope: 0, wild: 0, offset: 0 };
const scratch = createTerraceSample();
const centreTmp = new Vector3();

export class TerraceTerrain {
  radius = R_REF;
  readonly fields: TerraceFields;
  /** The season's front (paddy.glsl uPaddy.y): paddies whose delay is under it are on their way. */
  seasonFront = 0.72;
  /** Voronoi frequency in direction space (paddy.glsl uPaddy.x). */
  paddyFrequency = R_REF / CELL_M;

  constructor(public layout: TerraceLayout) {
    this.fields = new TerraceFields(layout.noiseSeed, layout.grain);
  }

  /** Refresh what depends on R and the parameters (cheap but for the peaks, placed once per size). */
  update(radius: number, p: TerraceFieldParams, bloom: number): void {
    this.radius = radius;
    this.fields.update(radius, p);
    this.paddyFrequency = 2 ** Math.round(Math.log2(radius / CELL_M));
    this.seasonFront = seasonFront(bloom);
  }

  /** The terraced ground at a direction (mirrors terraceFrom in ground.glsl). */
  terraceAt(dir: Vector3, out: TerraceSample): TerraceSample {
    const b = this.fields.base(dir, base);
    return terraceFrom(b.natural, b.slope, b.wild, b.offset, out);
  }

  /** The paddy a direction falls in on a level (mirrors paddyAt in paddy.glsl). */
  paddyAt(dir: Vector3, level: number, out: PaddySample): PaddySample {
    const f = this.paddyFrequency;
    const px = dir.x * f;
    const py = dir.y * f;
    const pz = dir.z * f;
    const bx = Math.floor(px);
    const by = Math.floor(py);
    const bz = Math.floor(pz);
    let d1 = 1e9;
    let d2 = 1e9;
    let cx = bx;
    let cy = by;
    let cz = bz;
    const seed = (this.layout.noiseSeed + 811) >>> 0;
    for (let z = -1; z <= 1; z++) {
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
          const h = cellHash(bx + x, by + y, bz + z, seed);
          const fx = bx + x + 0.15 + (0.7 * (h & 1023)) / 1023;
          const fy = by + y + 0.15 + (0.7 * ((h >>> 10) & 1023)) / 1023;
          const fz = bz + z + 0.15 + (0.7 * ((h >>> 20) & 1023)) / 1023;
          const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            cx = bx + x;
            cy = by + y;
            cz = bz + z;
            centreTmp.set(fx, fy, fz);
          } else if (d < d2) d2 = d;
        }
      }
    }
    const edge = ((0.5 * (Math.sqrt(d2) - Math.sqrt(d1))) / f) * this.radius;
    out.centre.copy(centreTmp).normalize();
    this.contourAt(out.centre, out.along);
    // this level's cuts in this cell: their spacing and phase
    const levelKey = Math.imul(((level | 0) + 4096) >>> 0, 2654435761);
    const lh = cellHash(cx, cy, cz, (this.layout.noiseSeed + 813 + levelKey) >>> 0);
    const spacing = PADDY.cuts[0] + (PADDY.cuts[1] - PADDY.cuts[0]) * unitHash(lh);
    const s = (cutTmp.subVectors(dir, out.centre).dot(out.along) * this.radius) / spacing + unitHash((Math.imul(lh, 747796405) + 2891336453) >>> 0);
    const k = Math.floor(s);
    out.wall = Math.min(edge, (0.5 - Math.abs(s - k - 0.5)) * spacing);
    out.id = cellHash(cx, cy, cz, (this.layout.noiseSeed + 812 + levelKey + Math.imul(((k | 0) + 1024) >>> 0, 40503)) >>> 0);
    out.variant = unitHash(out.id);
    const chance = unitHash((out.id ^ 0x9e3779b9) >>> 0);
    const delay = clamp(SEASON.field * this.fields.season(out.centre) + (1 - SEASON.field) * chance, 0, 1);
    out.maturity = clamp((this.seasonFront - delay) / SEASON.spread, 0, 1);
    out.fallow = unitHash((out.id ^ 0x85ebca6b) >>> 0) < PADDY.fallow;
    return out;
  }

  /** The contour's way at a direction: across the hills' slope there (mirrors contourAt in paddy.glsl). */
  contourAt(d: Vector3, out: Vector3): Vector3 {
    gradientFrame(d, ga, gb);
    const e = 2 / this.radius;
    const h0 = this.fields.natural(d);
    const ha = this.fields.natural(gd.copy(d).addScaledVector(ga, e).normalize()) - h0;
    const hb = this.fields.natural(gd.copy(d).addScaledVector(gb, e).normalize()) - h0;
    gu.copy(ga).multiplyScalar(ha).addScaledVector(gb, hb);
    if (gu.lengthSq() < 1e-10) return out.copy(ga);
    return out.crossVectors(d, gu).normalize();
  }

  /** Whether the water shows at a direction: on a paddy's floor, the paddy flooded or its crop still open. */
  wetAt(dir: Vector3, t: TerraceSample): boolean {
    if (t.wild > 0.5 || t.rise > 0.15 || t.bund > 0.3) return false;
    const p = this.paddyAt(dir, t.level, paddyScratch);
    return p.wall > 0.2 && !p.fallow && p.maturity < 0.55;
  }

  /** The ground at a direction for picking and the camera (GroundSample, as the meadow's Terrain gives it). */
  sample(dir: Vector3, out: GroundSample): GroundSample {
    const t = this.terraceAt(dir, scratch);
    out.height = t.height;
    const wet = this.wetAt(dir, t);
    out.water = wet ? -1 : 1;
    out.depth = wet ? TERRACE.water : 0;
    out.clearing = 0;
    out.wet = wet ? 1 : 0;
    return out;
  }

  height(dir: Vector3): number {
    return this.terraceAt(dir, scratch).height;
  }

  /** Highest the ground can stand (m), for culling. */
  get maxHeight(): number {
    return this.fields.maxHeight + TERRACE.bundHeight + 1;
  }

  /** Uniform values for ground.glsl and paddy.glsl. */
  writeUniforms(u: TerrainUniforms): void {
    u.uTerrainSeed.value = this.layout.noiseSeed;
    u.uTerrace.value.set(TERRACE.step, TERRACE.riser, TERRACE.bund, TERRACE.bundHeight);
    u.uTerraceMesh.value.set(MESH_TERRACES.near, MESH_TERRACES.far, TERRACE.water, 0);
    u.uPaddy.value.set(this.paddyFrequency, this.seasonFront, 0, 0);
  }
}

const paddyScratch: PaddySample = { id: 0, centre: new Vector3(), along: new Vector3(), wall: 0, variant: 0, maturity: 0, fallow: false };
const cutTmp = new Vector3();
const ga = new Vector3();
const gb = new Vector3();
const gd = new Vector3();
const gu = new Vector3();

/** The season's front for the bloom slider: everything flooded at 0; at 1 (the default) about a quarter of the paddies flooded, the rest on their way or grown. */
export function seasonFront(bloom: number): number {
  return 0.62 * clamp(bloom, 0, 1);
}

/** The terraced ground from the bake's four values (mirrors terraceFrom in ground.glsl). */
export function terraceFrom(natural: number, slope: number, wild: number, offset: number, out: TerraceSample): TerraceSample {
  const T = TERRACE;
  out.natural = natural;
  out.slope = Math.max(slope, 0.01);
  out.wild = wild;
  out.x = natural / T.step + offset;
  out.level = Math.floor(out.x);
  out.f = out.x - out.level;
  const band = T.step / out.slope;
  // (on the steepest terraces the riser is a near-vertical wall, at most a third of the band)
  const wr = clamp(Math.min(T.riser, 0.33 * band) / band, 0.03, 0.6);
  const wb = clamp(T.bund / band, 0.01, 0.3);
  out.rise = smoothstep(1 - wr, 1, out.f);
  out.bund = smoothstep(0, 0.35 * wb, out.f) * (1 - smoothstep(0.6 * wb, wb, out.f));
  out.floorH = out.level * T.step;
  const terraced = out.floorH + T.step * out.rise + T.bundHeight * out.bund;
  out.height = terraced + (natural - terraced) * wild;
  return out;
}

export interface TerrainUniforms {
  uTerrainSeed: { value: number };
  uTerraceBake: { value: Texture | null };
  uTerraceLife: { value: Texture | null };
  /** Riser height (m), riser width (m), bund width (m), bund height (m). */
  uTerrace: { value: Vector4 };
  /** The mesh's terraces out to (m), gone by (m); the water's depth (m). */
  uTerraceMesh: { value: Vector4 };
  /** Paddy cells' frequency, the season's front. */
  uPaddy: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uTerrainSeed: { value: 0 },
    uTerraceBake: { value: null },
    uTerraceLife: { value: null },
    uTerrace: { value: new Vector4(TERRACE.step, TERRACE.riser, TERRACE.bund, TERRACE.bundHeight) },
    uTerraceMesh: { value: new Vector4(MESH_TERRACES.near, MESH_TERRACES.far, TERRACE.water, 0) },
    uPaddy: { value: new Vector4(R_REF / CELL_M, 0.72, 0, 0) },
  };
}
