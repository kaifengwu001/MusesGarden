import { DoubleSide, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform, type InstancedBufferGeometry } from 'three';
import { hash32, salt, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { uvToSphere } from '../planet/cubesphere';
import { clumps, Fields, type ClumpSettings, type FieldParams } from '../planet/fields';
import type { RestPoint } from '../planet/rest';
import type { Layout } from '../planet/terrain';
import { SPECIES_MESH } from './flowerMeshes';
import fragmentShader from './grass.frag.glsl?raw';
import vertexShader from './flower.vert.glsl?raw';
import { SCATTER_STRIDE, ScatterLayer, type ScatterClassifier, type ScatterLook, type ScatterView } from './scatter';

// Flowers near the camera. One rest-space point set (so the total follows the
// mean density per m² exactly), sorted on the CPU into four pools, one per
// species mesh, by the same fields the far paint reads (fields.ts): drifts
// and colonies from a grid per tile, clumps exactly where each flower stands.
// Each flower also gets a size (lusher ground grows bigger flowers) and a
// colour variant (set per colony, with a little spread of its own), so the
// near flowers and the far paint tell the same story.

/** Stem top (m) and resting nod (rad) per species. */
export const HEADS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.35], // pink cup
  [0.44, 0.08], // white star
  [0.34, 0.05], // button
  [0.38, 0.1], // blue cluster
];

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
  /** GRID² × (pink, star, yellow, blue) flowers per m². */
  flora: Float32Array;
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
    const st: TileFlora = { level, i, j, flora: new Float32Array(GRID * GRID * 4), lush: new Float32Array(GRID * GRID), variant: new Float32Array(GRID * GRID), clumps: fields.clumpSettings() };
    let max = 0;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const k = gy * GRID + gx;
        uvToSphere(face, (i + gx / (GRID - 1)) / n, (j + gy / (GRID - 1)) / n, this.dir);
        fields.flora(this.dir, fields.wetness(this.dir), this.tmp);
        let total = 0;
        for (let s = 0; s < 4; s++) {
          st.flora[k * 4 + s] = this.tmp[s] * this.scale;
          total += this.tmp[s] * this.scale;
        }
        st.lush[k] = fields.lush(this.dir);
        st.variant[k] = colonyVariant(fields.variant(this.dir), this.look.colourVariation);
        max = Math.max(max, total);
      }
    }
    return { state: st, boost: (max * st.clumps.peak) / Math.max(this.density, 1e-6) };
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
    const at = (s: number): number => f[k00 * 4 + s] * w00 + f[(k00 + 1) * 4 + s] * w10 + f[(k00 + GRID) * 4 + s] * w01 + f[(k00 + GRID + 1) * 4 + s] * w11;
    // a point that would not be born even in the densest clump is done with
    // before the clumps are evaluated (most of them, outside the clumps)
    const near = at(0) + at(1) + at(2) + at(3);
    if (near <= 1e-6 || (p.threshold * this.density) / (near * st.clumps.peak) > sigma) return -1;
    // the clumps, exactly where this flower stands
    const k = clumps(st.clumps, this.dir.set(record[o], record[o + 1], record[o + 2]), this.clumps);
    const d0 = at(0) * k[0];
    const d1 = at(1) * k[1];
    const d2 = at(2) * k[2];
    const d3 = at(3) * k[3];
    const total = d0 + d1 + d2 + d3;
    if (total <= 1e-6) return -1;
    // born when the local density, not the mean, reaches its threshold
    const local = (p.threshold * this.density) / total;
    if (local > sigma) return -1;
    record[o + 3] = Math.log(local);
    const pick = unit(hash32(p.seed ^ 0x2f6b9c4d)) * total;
    const species = pick < d0 ? 0 : pick < d0 + d1 ? 1 : pick < d0 + d1 + d2 ? 2 : 3;
    const mix4 = (a: Float32Array): number => a[k00] * w00 + a[k00 + 1] * w10 + a[k00 + GRID] * w01 + a[k00 + GRID + 1] * w11;
    const lush = mix4(st.lush);
    const variant = mix4(st.variant);
    const look = this.look;
    record[o + 5] = clamp(1 + look.sizeVariation * (0.3 * lush + 0.25 * (2 * unit(hash32(p.seed ^ 0x7a1c3e55)) - 1)), 0.45, 1.8);
    record[o + 6] = clamp(variant + look.colourVariation * 0.3 * (unit(hash32(p.seed ^ 0x13579bdf)) - 0.5), 0, 1);
    return species;
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
