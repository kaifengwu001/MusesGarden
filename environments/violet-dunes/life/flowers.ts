import { DoubleSide, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform, type InstancedBufferGeometry } from 'three';
import { hash32, salt, unit } from '../../../src/core/hash';
import { clamp, smoothstep } from '../../../src/core/math';
import { uvToSphere } from '../../../src/planet/cubesphere';
import { clumps, Fields, type ClumpSettings, type FieldParams } from '../planet/fields';
import type { RestPoint } from '../../../src/planet/rest';
import type { Layout } from '../planet/terrain';
import { SPECIES_MESH } from './flowerMeshes';
import { starGroups, type StarGroup } from './landmarks';
import fragmentShader from '../../../src/life/grass.frag.glsl?raw';
import vertexShader from './flower.vert.glsl?raw';
import { SCATTER_STRIDE, ScatterLayer, type ScatterClassifier, type ScatterLook, type ScatterView } from '../../../src/life/scatter';

// Starflowers near the camera. One rest-space point set (so the total
// follows the mean density per m² exactly), thinned on the CPU by the same
// fields the far paint reads (fields.ts): the habitat's drifts from a grid
// per tile, clumps exactly where each flower stands, plus the starflower
// groups at the foot of the rocks round the shelter (landmarks.ts), which the
// paint draws too (meadow.glsl uStarGroups). Each flower also gets a size
// (from the sand's tone and its own seed) and a colour variant, so the near
// flowers and the far paint tell the same story.

/** Stem top (m) and resting nod (rad) per species: the starflower alone, its face turned well over (board 01 shows them facing you, not the sky). */
const HEADS: ReadonlyArray<readonly [number, number]> = [[0.38, 0.62]];
/** The flora channel the starflowers are baked in (fields.ts). */
const STAR = 1;
/** Beyond this (m) from the shelter no starflower group reaches. */
const GROUPS_REACH = 24;

/** Starflowers per m² the groups add at shelter-local (x, z); mirrors starGroupsAt() in meadow.glsl. */
export function starGroupsAt(groups: readonly StarGroup[], x: number, z: number): number {
  let d = 0;
  for (const g of groups) d += g.density * smoothstep(g.radius, 0.6 * g.radius, Math.hypot(x - g.x, z - g.z));
  return d;
}

export const FLOWER_FADE = { fullRadius: 0.4, keepAtEdge: 0.3 };
/** Per instance: the standard five floats, then size and colour variant. */
const STRIDE = SCATTER_STRIDE + 2;
/** Field samples per tile side (bilinear in between). */
const GRID = 4;
/** R is quantised for classification (4 % steps), so a settled world never depends on its history. */
const LN_R_STEP = 0.04;

interface TileFlora {
  level: number;
  i: number;
  j: number;
  /** GRID² starflowers per m² (from the drifts). */
  flora: Float32Array;
  /** Whether any starflower group can reach the tile. */
  groups: boolean;
  lush: Float32Array;
  variant: Float32Array;
  clumps: ClumpSettings;
}

export interface FlowerLook {
  /** 0..1: how much sizes vary (with lushness, and per flower). */
  sizeVariation: number;
  /** 0..1: how far colonies drift from their species' middle colour. */
  colourVariation: number;
}

/** A colony's colour variant after the colour-variation setting (matches colonyVariant() in GLSL). */
export function colonyVariant(v: number, colourVariation: number): number {
  return clamp(0.5 + (v - 0.5) * colourVariation * 1.4, 0, 1);
}

export class FlowerClassifier implements ScatterClassifier<TileFlora> {
  version = '';
  private fields: Fields | null = null;
  private layout: Layout | null = null;
  /** Mean flowers per m² of the view (tier scale applied). */
  private density = 1;
  private scale = 1;
  private look: FlowerLook = { sizeVariation: 0.5, colourVariation: 0.5 };
  private readonly dir = new Vector3();
  private readonly tmp = new Float32Array(4);
  private readonly clumps = new Float32Array(4);
  private readonly groups = starGroups();
  private readonly groupPeak = Math.max(...starGroups().map((g) => g.density));
  private readonly across = new Vector3();

  private lnR = Number.NaN;
  private paramsKey = '';

  /**
   * Refresh for the current world. `paramsKey` names the field parameters
   * (the caller rebuilds it only when they change); nothing is allocated
   * unless something changed.
   */
  set(layout: Layout, radius: number, params: FieldParams, paramsKey: string, density: number, tierScale: number, look: FlowerLook): void {
    const lnR = Math.round(Math.log(radius) / LN_R_STEP) * LN_R_STEP;
    if (
      layout === this.layout &&
      lnR === this.lnR &&
      paramsKey === this.paramsKey &&
      density === this.density &&
      tierScale === this.scale &&
      look.sizeVariation === this.look.sizeVariation &&
      look.colourVariation === this.look.colourVariation
    )
      return;
    if (layout !== this.layout || !this.fields) {
      this.layout = layout;
      this.fields = new Fields(layout.noiseSeed, layout.grain);
    }
    this.fields.update(Math.exp(lnR), params);
    this.lnR = lnR;
    this.paramsKey = paramsKey;
    this.density = density;
    this.scale = tierScale;
    this.look = { ...look };
    this.version = `${layout.seed}/${lnR.toFixed(3)}/${paramsKey}/${density}/${tierScale}/${look.sizeVariation}/${look.colourVariation}`;
  }

  prepare(face: number, level: number, i: number, j: number): { state: TileFlora; boost: number } {
    const fields = this.fields!;
    const n = 2 ** level;
    const st: TileFlora = { level, i, j, flora: new Float32Array(GRID * GRID), groups: false, lush: new Float32Array(GRID * GRID), variant: new Float32Array(GRID * GRID), clumps: fields.clumpSettings() };
    const home = this.layout!.cottage;
    let max = 0;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const k = gy * GRID + gx;
        uvToSphere(face, (i + gx / (GRID - 1)) / n, (j + gy / (GRID - 1)) / n, this.dir);
        fields.flora(this.dir, fields.habitat(this.dir), this.tmp);
        st.flora[k] = this.tmp[STAR] * this.scale;
        st.lush[k] = fields.tone(this.dir);
        st.variant[k] = colonyVariant(fields.variant(this.dir), this.look.colourVariation);
        max = Math.max(max, st.flora[k]);
        if (Math.acos(Math.min(1, this.dir.dot(home))) * this.radius < GROUPS_REACH + this.tileMeters(level)) st.groups = true;
      }
    }
    const peak = max * st.clumps.peak + (st.groups ? this.groupPeak * this.scale : 0);
    return { state: st, boost: peak / Math.max(this.density, 1e-6) };
  }

  classify(st: TileFlora, p: RestPoint, sigma: number, record: Float32Array, o: number): number {
    const n = 2 ** st.level;
    const x = clamp((p.u * n - st.i) * (GRID - 1), 0, GRID - 1 - 1e-6);
    const y = clamp((p.v * n - st.j) * (GRID - 1), 0, GRID - 1 - 1e-6);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const k00 = y0 * GRID + x0;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const f = st.flora;
    const drift = f[k00] * w00 + f[k00 + 1] * w10 + f[k00 + GRID] * w01 + f[k00 + GRID + 1] * w11;
    this.dir.set(record[o], record[o + 1], record[o + 2]);
    // the groups round the shelter, where they reach
    const group = st.groups ? this.groupsAt(this.dir) * this.scale : 0;
    // a point that would not be born even in the densest clump is done with
    // before the clumps are evaluated (most of them, outside the clumps)
    const near = drift * st.clumps.peak + group;
    if (near <= 1e-6 || (p.threshold * this.density) / near > sigma) return -1;
    // the clumps, exactly where this flower stands
    const total = drift * clumps(st.clumps, this.dir, this.clumps)[STAR] + group;
    if (total <= 1e-6) return -1;
    // born when the local density, not the mean, reaches its threshold
    const local = (p.threshold * this.density) / total;
    if (local > sigma) return -1;
    record[o + 3] = Math.log(local);
    const species = 0;
    const mix4 = (a: Float32Array): number => a[k00] * w00 + a[k00 + 1] * w10 + a[k00 + GRID] * w01 + a[k00 + GRID + 1] * w11;
    const lush = mix4(st.lush);
    const variant = mix4(st.variant);
    const look = this.look;
    record[o + 5] = clamp(1 + look.sizeVariation * (0.25 * lush + 0.45 * (2 * unit(hash32(p.seed ^ 0x7a1c3e55)) - 1)), 0.65, 1.45);
    record[o + 6] = clamp(variant + look.colourVariation * 0.3 * (unit(hash32(p.seed ^ 0x13579bdf)) - 0.5), 0, 1);
    return species;
  }

  /** The planet's radius the classification is for (R quantised). */
  private get radius(): number {
    return Math.exp(this.lnR);
  }

  /** A tile's edge at this level (m), roughly. */
  private tileMeters(level: number): number {
    return (Math.PI / 2) * this.radius / 2 ** level;
  }

  /** The starflower groups' density at dir (shelter-local meters, as Terrain.cottageLocal measures them). */
  private groupsAt(dir: Vector3): number {
    const L = this.layout!;
    const R = this.radius;
    this.across.crossVectors(L.cottage, L.homeBearing);
    const dx = dir.x - L.cottage.x;
    const dy = dir.y - L.cottage.y;
    const dz = dir.z - L.cottage.z;
    const x = (dx * this.across.x + dy * this.across.y + dz * this.across.z) * R;
    const z = (dx * L.homeBearing.x + dy * L.homeBearing.y + dz * L.homeBearing.z) * R;
    return starGroupsAt(this.groups, x, z);
  }
}

export class Flowers {
  readonly layer: ScatterLayer;
  readonly classifier = new FlowerClassifier();
  readonly meshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  private readonly own: { uFlowers: IUniform<Vector4>; uFlowerFade: IUniform<Vector4> }[] = [];

  constructor(shared: Record<string, IUniform>, pages: number) {
    this.layer = new ScatterLayer({
      name: 'flowers',
      cls: { salt: salt('flowers'), jitter: 0.85 },
      tileMeters: 9,
      pageSize: 256,
      pages,
      headroom: 1.25,
      stride: STRIDE,
      channels: SPECIES_MESH.length,
      mapBuilt: true,
    });
    SPECIES_MESH.forEach((make, species) => {
      const geometry = make();
      geometry.instanceCount = 0;
      const own = {
        uPageSize: { value: 256 },
        uPool: { value: this.layer.mainTextures[species] },
        uPoolRest: { value: this.layer.restTextures[species] },
        uPageList: { value: this.layer.listTextures[species] },
        uFlowers: { value: new Vector4(30, 0, species, 1) },
        uFlowerFade: { value: new Vector4(12, FLOWER_FADE.keepAtEdge, HEADS[species][0], HEADS[species][1]) },
      };
      const material = new ShaderMaterial({
        name: `flowers ${species}`,
        vertexShader,
        fragmentShader,
        uniforms: { ...shared, ...own },
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -19;
      this.meshes.push(mesh);
      this.own.push(own);
    });
  }

  static keep(d: number, near: number): number {
    if (near <= 0) return 0;
    return 1 + (FLOWER_FADE.keepAtEdge - 1) * smoothstep(near * FLOWER_FADE.fullRadius, near, d);
  }

  update(view: Omit<ScatterView, 'falloff' | 'classifier' | 'ahead'> & { ahead?: Omit<ScatterLook, 'falloff'> }, sizeScale: number): void {
    const { near, ahead } = view;
    this.layer.update({ ...view, falloff: (d) => Flowers.keep(d, near), classifier: this.classifier, ahead: ahead && { ...ahead, falloff: (d) => Flowers.keep(d, ahead.near) } });
    for (let s = 0; s < this.meshes.length; s++) {
      const mesh = this.meshes[s];
      mesh.geometry.instanceCount = this.layer.instanceCounts[s];
      const u = this.own[s];
      u.uFlowers.value.set(near, Math.log(Math.max(view.density, 1e-6)), s, sizeScale);
      u.uFlowerFade.value.x = near * FLOWER_FADE.fullRadius;
      mesh.visible = near > 0.5 && view.density > 0 && mesh.geometry.instanceCount > 0;
    }
  }
}
