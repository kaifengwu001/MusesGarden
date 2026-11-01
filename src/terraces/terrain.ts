import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix as hashMix } from '../core/hash';
import { clamp } from '../core/math';
import type { GroundSample } from '../planet/terrain';
import { TerraceCells } from './cells';
import { TerraceFields, type TerraceBase, type TerraceFieldParams } from './fields';
import { createCropSample, createPlotSample, PLOTS, SEASON, TERRACE, TerracePlots, type CropSample, type PlotSample } from './plots';
import { CUTS } from './survey';

// The terraced ground on the CPU: the camera's footing, picking, placement
// and tests read it. Its twins on the GPU are plots.glsl, paddy.glsl and
// ground.glsl (plots.ts holds the mirror); the cells (cells.ts) are what the
// layout bake holds.

export const R_REF = 128;
/** The mesh's finest grid (m: the leaves' 2 m over 16 steps), and how coarse it is at a distance (at most d / 22: CDLOD's ranges, chunks.ts). */
export const MESH = { finest: 0.125, perMeter: 1 / 22, gather: [0.45, 0.55] } as const;

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

/** The terraced ground at a point: its plot, its crop, and the ground, water and surface there (m). */
export interface TerraceSample extends PlotSample {
  readonly crop: CropSample;
  /** Floor, bunds and walls (m). */
  ground: number;
  /** The water's level (m), or −1e4 where it is dry. */
  water: number;
  /** The surface: the ground, or the water over it; the hills' own where wild. */
  height: number;
}

export function createTerraceSample(): TerraceSample {
  return { ...createPlotSample(), crop: createCropSample(), ground: 0, water: -1e4, height: 0 };
}

const scratch = createTerraceSample();

/** The built terraces at a point (TerraceTerrain.builtAt): the land's use there, the band's lower wall (a level of the planet's), its paddy's crop. */
export interface BuiltSample {
  wild: number;
  flat: number;
  level: number;
  readonly crop: CropSample;
}

export function createBuiltSample(): BuiltSample {
  return { wild: 0, flat: 0, level: 0, crop: createCropSample() };
}

const builtBase: TerraceBase = { natural: 0, slope: 0, wild: 0, flat: 0 };
const builtWalls = { lo2: 0, lo: 0, hi: 0, hi2: 0 };
const builtPlot = createPlotSample();

export class TerraceTerrain {
  radius = R_REF;
  readonly fields: TerraceFields;
  readonly cells: TerraceCells;
  readonly plots: TerracePlots;
  /** The season's front (paddy.glsl uPaddy.y): paddies whose delay is under it are on their way. */
  seasonFront = 0.72;

  constructor(public layout: TerraceLayout) {
    this.fields = new TerraceFields(layout.noiseSeed, layout.grain);
    this.cells = new TerraceCells(this.fields, layout.noiseSeed);
    this.plots = new TerracePlots(this.fields, this.cells, layout.noiseSeed);
  }

  /** Refresh what depends on R and the parameters (cheap but for the peaks, placed once per size). */
  update(radius: number, p: TerraceFieldParams, bloom: number): void {
    this.radius = radius;
    this.fields.update(radius, p);
    this.cells.update(radius, `${radius}/${JSON.stringify(p)}`);
    this.seasonFront = seasonFront(bloom);
  }

  /** The terraced ground at a direction: its plot and crop, the ground, the water and the surface. */
  terraceAt(dir: Vector3, out: TerraceSample): TerraceSample {
    this.plots.plotAt(dir, out);
    this.plots.cropOf(out, this.seasonFront, out.crop);
    out.ground = this.plots.ground(out);
    out.water = out.crop.water > 0 ? out.floorH + out.crop.water : -1e4;
    out.height = this.plots.surface(out, out.crop);
    return out;
  }

  /**
   * The built terraces at a direction as the survey lays them out (survey.ts), read without a survey: the
   * planet's levels round the hills' own height, the band the ground stands in (by its lower wall's level), and
   * the paddy of its stretch along that wall's cut field (read here: the wall's, near enough) with its crop. No
   * lenses, cuts or bunds; the valleys' flats and the wild as the bake has them.
   */
  builtAt(dir: Vector3, out: BuiltSample): BuiltSample {
    const b = this.fields.base(dir, builtBase);
    out.wild = b.wild;
    out.flat = b.flat;
    const w = this.plots.walls(0, b.natural / TERRACE.step + this.plots.offset(0), builtWalls);
    out.level = Math.round(w.lo);
    const at = Math.floor(this.plots.cutField(dir, out.level) / CUTS.step);
    builtPlot.id = this.plots.hash(0, out.level, at, 0, 47);
    builtPlot.season = this.plots.seasonOf(out.level, at);
    this.plots.cropOf(builtPlot, this.seasonFront, out.crop);
    return out;
  }

  /** Whether the water shows at a point: on a paddy's floor, under its water, its crop still open. */
  wetAt(t: TerraceSample): boolean {
    return t.wild < 0.35 && t.water > t.ground + 0.01 && t.crop.height < 0.5;
  }

  /** The ground at a direction for picking and the camera (GroundSample, as the meadow's Terrain gives it). */
  sample(dir: Vector3, out: GroundSample): GroundSample {
    const t = this.terraceAt(dir, scratch);
    out.height = t.height;
    const wet = this.wetAt(t);
    out.water = wet ? -1 : 1;
    out.depth = wet ? t.water - t.ground : 0;
    out.clearing = 0;
    out.wet = wet ? 1 : 0;
    return out;
  }

  height(dir: Vector3): number {
    return this.terraceAt(dir, scratch).height;
  }

  /** Highest the ground can stand (m), for culling. */
  get maxHeight(): number {
    return this.fields.maxHeight + TERRACE.riser[1] + TERRACE.bundHeight + 1;
  }

  /** Uniform values for plots.glsl, paddy.glsl and ground.glsl; texel: the terrain and layout bakes' texel (m) at its coarsest (the life bake's is twice it). */
  writeUniforms(u: TerrainUniforms, texel: number): void {
    u.uTerrainSeed.value = this.layout.noiseSeed;
    u.uTerraceShape.value.set(TERRACE.band, TERRACE.riser[0], TERRACE.riser[1], TERRACE.spread);
    u.uTerraceLevels.value.set(TERRACE.jitter, TERRACE.merge, TERRACE.cuts[0], TERRACE.cuts[1]);
    u.uTerraceWall.value.set(TERRACE.batter, TERRACE.bund, TERRACE.bundHeight, TERRACE.crest);
    u.uPlots.value.set(PLOTS.width[0], PLOTS.width[1], PLOTS.length[0], PLOTS.length[1]);
    u.uLayoutInfo.value.set(2 * texel, TERRACE.square, 0.5 * texel, 0);
    u.uTerraceMesh.value.set(MESH.finest, MESH.perMeter, MESH.gather[0], MESH.gather[1]);
    u.uPaddy.value.set(0, this.seasonFront, SEASON.cell, 0);
    u.uLevels.value.set(TERRACE.step, this.plots.offset(0), 0, 0); // (the terraces' levels: survey.ts MODES)
  }
}

/** The season's front for the bloom slider: everything flooded at 0; at 1 (the default) about a quarter of the paddies flooded, the rest on their way or grown. */
export function seasonFront(bloom: number): number {
  return 0.62 * clamp(bloom, 0, 1);
}

export interface TerrainUniforms {
  uTerrainSeed: { value: number };
  uTerraceBake: { value: Texture | null };
  uTerraceLife: { value: Texture | null };
  uTerraceLayout: { value: Texture | null };
  /** A cell's band (m), its riser between (m), each cell's spread of it. */
  uTerraceShape: { value: Vector4 };
  /** Each wall's jitter, the share of walls left out, the cuts along a band between (m). */
  uTerraceLevels: { value: Vector4 };
  /** A riser's batter, a bund's width (m), its height (m), its flat top's share. */
  uTerraceWall: { value: Vector4 };
  /** The flats' rows between (m) wide, their plots between (× the row) long. */
  uPlots: { value: Vector4 };
  /** How far in a cell is read near its edge (m), bands wider than this (m) cut square-ish, half the layout's texel (m). */
  uLayoutInfo: { value: Vector4 };
  /** The mesh: its finest grid (m), its spacing per meter away, the gathering's fade (spacing / band). */
  uTerraceMesh: { value: Vector4 };
  /** -, the season's front, the cell's share of a paddy's delay. */
  uPaddy: { value: Vector4 };
  /** The terraces as built: round this direction (xyz), out to this far (m; 0: none built); the ground sinks under them. */
  uObjects: { value: Vector4 };
  /** The planet's levels the terraces are built on (survey.ts): their step (m), their offset (a level's share). */
  uLevels: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uTerrainSeed: { value: 0 },
    uTerraceBake: { value: null },
    uTerraceLife: { value: null },
    uTerraceLayout: { value: null },
    uTerraceShape: { value: new Vector4(TERRACE.band, TERRACE.riser[0], TERRACE.riser[1], TERRACE.spread) },
    uTerraceLevels: { value: new Vector4(TERRACE.jitter, TERRACE.merge, TERRACE.cuts[0], TERRACE.cuts[1]) },
    uTerraceWall: { value: new Vector4(TERRACE.batter, TERRACE.bund, TERRACE.bundHeight, TERRACE.crest) },
    uPlots: { value: new Vector4(PLOTS.width[0], PLOTS.width[1], PLOTS.length[0], PLOTS.length[1]) },
    uLayoutInfo: { value: new Vector4(1, TERRACE.square, 0, 0) },
    uTerraceMesh: { value: new Vector4(MESH.finest, MESH.perMeter, MESH.gather[0], MESH.gather[1]) },
    uPaddy: { value: new Vector4(0, 0.72, SEASON.cell, 0) },
    uObjects: { value: new Vector4(0, 1, 0, 0) },
    uLevels: { value: new Vector4(TERRACE.step, 0, 0, 0) },
  };
}
