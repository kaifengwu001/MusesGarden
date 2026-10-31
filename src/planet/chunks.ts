import { Sphere, Vector3, type Frustum } from 'three';
import { clamp } from '../core/math';
import { warpPoint, type WarpFrame } from '../render/warp';
import { uvToSphere } from './cubesphere';

// CDLOD over six face quadtrees. Every selected node is drawn with the same
// grid mesh in one instanced draw; per-node instance data says where the node
// sits and over which distances its odd vertices morph onto the parent grid.
//
// Ranges double per level: a level-L node is refined while it is closer than
// D_(L+1) = k·S_(L+1), where S_L is the nominal node edge (a face edge / 2^L).
// Its vertices morph toward the parent grid between MORPH_START·D_L and D_L,
// measured from the camera to the vertex on the base sphere (the vertex
// shader does the same).
//
// The morph is symmetric: an odd vertex keeps its uv and blends its position
// toward the midpoint of its two parent-grid neighbours (along the parent's
// triangle diagonal for odd-odd vertices). Classic CDLOD slides odd vertices
// toward one neighbour instead, which tears at cube-face seams where the two
// faces run the edge parameter in opposite directions; a midpoint is the
// same from either side. Fully morphed, the node lies exactly on its
// parent's triangles.
//
// Crack-freeness: a finer neighbour exists only inside a parent closer than
// D_(L+1), so the shared edge is at most D_(L+1) + 2r away, where r ≤ 1.05·S_L
// is a node's bounding radius (nodes stretch near cube edges). That edge must
// not have started morphing: MORPH_START·k·S_L ≥ (k/2 + 2.1)·S_L. k = 5.5
// with MORPH_START = 0.9 holds with margin; chunks.test.ts checks every edge.

/** Floats per selected node: u0, v0, size, face, morphStart, morphEnd, level, pad. */
export const NODE_FLOATS = 8;
export const MORPH_START = 0.9;

export interface LodConfig {
  /** Vertices per node edge; (grid − 1) must be even. */
  readonly grid: number;
  /** k: refinement range in node sizes. */
  readonly rangeFactor: number;
  /** Target finest node edge, m. */
  readonly leafSize: number;
}

export const LOD_DEFAULT: LodConfig = { grid: 17, rangeFactor: 5.5, leafSize: 8 };

export interface LodView {
  /** Camera position, planet space. */
  readonly camera: Vector3;
  readonly radius: number;
  /** Highest terrain point above R and deepest below it, m (culling only). */
  readonly heightAbove: number;
  readonly heightBelow: number;
  /** Null disables frustum culling. */
  readonly frustum: Frustum | null;
  /** Tiny-planet warp; the frustum is tested against warped bounds. */
  readonly warp?: WarpFrame | null;
  /** False disables horizon culling (tests). */
  readonly horizonCull: boolean;
  /**
   * Warped horizon: under the tiny-planet warp the ground near the focus
   * curves like a sphere of radius `radiusEff`; seen from `eyeHeight`, ground
   * of height H is hidden beyond √(2·R_eff·h) + √(2·R_eff·H) from the focus.
   * `heightAt(cap)` bounds the ground height over a node.
   */
  readonly warpHorizon?: { focusDir: Vector3; radiusEff: number; eyeHeight: number; heightAt: (centre: Vector3, alpha: number) => number } | null;
  /**
   * Where the homestead shapes or shades the ground: discs (centre direction,
   * radius in m). A node reaching into any is flagged in its last float and
   * drawn with the homestead's code, the rest without it (surface.ts). Null:
   * every node is flagged.
   */
  readonly home?: ReadonlyArray<{ readonly dir: Vector3; readonly reach: number }> | null;
}

const corner = new Vector3();
const centre = new Vector3();
const sphere = new Sphere();

/** Nominal face edge length in meters (a quarter great circle). */
export function faceEdgeLength(radius: number): number {
  return 0.5 * Math.PI * radius;
}

export function leafLevelFor(radius: number, cfg: LodConfig): number {
  return clamp(Math.ceil(Math.log2(faceEdgeLength(radius) / cfg.leafSize)), 0, 20);
}

export class ChunkSelection {
  readonly data: Float32Array;
  count = 0;
  minLevel = 0;
  maxLevel = 0;
  /** Nodes visited by the last selection (cost). */
  visited = 0;
  private view: LodView | null = null;
  private cfg: LodConfig = LOD_DEFAULT;
  private leafLevel = 0;
  private cosHorizon = -1;
  private camDir = new Vector3();

  constructor(readonly capacity = 8192) {
    this.data = new Float32Array(capacity * NODE_FLOATS);
  }

  select(view: LodView, cfg: LodConfig): void {
    this.view = view;
    this.cfg = cfg;
    this.count = 0;
    this.visited = 0;
    this.minLevel = 99;
    this.maxLevel = 0;
    this.leafLevel = leafLevelFor(view.radius, cfg);
    const camDist = view.camera.length();
    this.camDir.copy(view.camera).divideScalar(Math.max(camDist, 1e-9));
    // Horizon: the planet hides everything beyond the angle where the line of
    // sight grazes the lowest ground and comes up again at the highest peak.
    const low = view.radius - view.heightBelow;
    const top = view.radius + view.heightAbove;
    if (view.horizonCull && camDist > top) {
      this.cosHorizon = Math.cos(Math.acos(low / camDist) + Math.acos(Math.min(1, low / top)));
    } else {
      this.cosHorizon = -2;
    }
    for (let face = 0; face < 6; face++) this.visit(face, 0, 0, 0);
    if (this.count === 0) this.minLevel = 0;
  }

  private visit(face: number, level: number, i: number, j: number): void {
    const view = this.view!;
    const R = view.radius;
    this.visited++;
    const n = 2 ** level;
    uvToSphere(face, (i + 0.5) / n, (j + 0.5) / n, centre);
    let cosAlpha = 1;
    for (let c = 0; c < 4; c++) {
      uvToSphere(face, (i + (c & 1)) / n, (j + (c >> 1)) / n, corner);
      cosAlpha = Math.min(cosAlpha, corner.dot(centre));
    }
    const alpha = Math.acos(clamp(cosAlpha, -1, 1)) * 1.02 + 1e-6;

    // Horizon: hidden when the whole cap lies beyond the horizon angle.
    if (this.cosHorizon > -2) {
      const angle = Math.acos(clamp(centre.dot(this.camDir), -1, 1));
      if (Math.cos(Math.max(0, angle - alpha)) < this.cosHorizon) return;
    }
    // Warped horizon: beyond it, the bent ground hides everything below its peaks.
    const wh = view.warpHorizon;
    if (wh) {
      const gap = Math.max(0, Math.acos(clamp(centre.dot(wh.focusDir), -1, 1)) - alpha) * R;
      const reach = Math.sqrt(2 * wh.radiusEff * wh.eyeHeight) + Math.sqrt(2 * wh.radiusEff * Math.max(wh.heightAt(centre, alpha), 0.5));
      if (gap > reach) return;
    }
    // Frustum: a sphere around the cap, tall enough for the highest ground.
    if (view.frustum) {
      sphere.center.copy(centre).multiplyScalar(R + 0.5 * (view.heightAbove - view.heightBelow));
      sphere.radius = 2 * (R + view.heightAbove) * Math.sin(alpha / 2) + 0.5 * (view.heightAbove + view.heightBelow);
      const warp = view.warp;
      if (warp && warp.k !== 0) {
        // The warp moves points along U by k·|t|²; across a sphere of radius r
        // that differs by at most 2|k|·|t|·r + |k|·r², so inflate by that.
        const tx = sphere.center.x - warp.focus.x;
        const ty = sphere.center.y - warp.focus.y;
        const tz = sphere.center.z - warp.focus.z;
        const along = tx * warp.up.x + ty * warp.up.y + tz * warp.up.z;
        const tLen = Math.hypot(tx - along * warp.up.x, ty - along * warp.up.y, tz - along * warp.up.z);
        const k = Math.abs(warp.k);
        warpPoint(warp, sphere.center, sphere.center);
        sphere.radius += 2 * k * tLen * sphere.radius + k * sphere.radius * sphere.radius;
      }
      if (!view.frustum.intersectsSphere(sphere)) return;
    }

    // LOD distance on the base sphere (the vertex shader's morph uses the same).
    const cx = centre.x * R - view.camera.x;
    const cy = centre.y * R - view.camera.y;
    const cz = centre.z * R - view.camera.z;
    const distance = Math.max(0, Math.hypot(cx, cy, cz) - 2 * R * Math.sin(alpha / 2));
    const range = (this.cfg.rangeFactor * faceEdgeLength(R)) / n; // D_L
    if (level < this.leafLevel && distance < range / 2) {
      for (let c = 0; c < 4; c++) this.visit(face, level + 1, 2 * i + (c & 1), 2 * j + (c >> 1));
      return;
    }
    if (this.count >= this.capacity) return;
    const o = this.count++ * NODE_FLOATS;
    const d = this.data;
    d[o] = i / n;
    d[o + 1] = j / n;
    d[o + 2] = 1 / n;
    d[o + 3] = face;
    // Level 0 has no parent grid to morph to.
    d[o + 4] = level === 0 ? 1e30 : MORPH_START * range;
    d[o + 5] = level === 0 ? 2e30 : range;
    d[o + 6] = level;
    d[o + 7] = this.nearHome(alpha, n) ? 1 : 0;
    this.minLevel = Math.min(this.minLevel, level);
    this.maxLevel = Math.max(this.maxLevel, level);
  }

  /** Whether the node about `centre` (angular radius alpha, 1/n of a face across) reaches into the homestead's ground. */
  private nearHome(alpha: number, n: number): boolean {
    const home = this.view!.home;
    if (!home) return true;
    const R = this.view!.radius;
    // the vertex shader reads the ground up to a parent grid step past a vertex (and a gradient step past that)
    const margin = alpha + (3 * Math.PI) / (2 * n * (this.cfg.grid - 1)) + 2 / R;
    for (const a of home) if (Math.acos(clamp(centre.dot(a.dir), -1, 1)) - margin < a.reach / R) return true;
    return false;
  }
}

export type HeightFn = (dir: Vector3) => number;

const nodeA = new Vector3();
const nodeB = new Vector3();

function surfacePoint(face: number, u: number, v: number, radius: number, height: HeightFn, out: Vector3): Vector3 {
  uvToSphere(face, u, v, out);
  return out.multiplyScalar(radius + height(out));
}

/**
 * CPU mirror of the surface vertex shader: grid vertex (gx, gy) of selected
 * node `k` → morphed planet-space position. Used by the crack test and picking.
 */
export function morphedVertex(
  sel: ChunkSelection,
  k: number,
  gx: number,
  gy: number,
  camera: Vector3,
  radius: number,
  grid: number,
  height: HeightFn,
  out: Vector3,
): Vector3 {
  const d = sel.data;
  const o = k * NODE_FLOATS;
  const steps = grid - 1;
  const u0 = d[o];
  const v0 = d[o + 1];
  const size = d[o + 2];
  const face = d[o + 3];
  const at = (x: number, y: number, target: Vector3): Vector3 => surfacePoint(face, u0 + (x / steps) * size, v0 + (y / steps) * size, radius, height, target);
  at(gx, gy, out);
  const ox = gx % 2;
  const oy = gy % 2;
  if (ox + oy === 0) return out;
  uvToSphere(face, u0 + (gx / steps) * size, v0 + (gy / steps) * size, corner);
  const dist = corner.multiplyScalar(radius).distanceTo(camera);
  const kf = clamp((dist - d[o + 4]) / Math.max(d[o + 5] - d[o + 4], 1e-3), 0, 1);
  if (kf === 0) return out;
  at(gx - ox, gy - oy, nodeA);
  at(gx + ox, gy + oy, nodeB);
  return out.lerp(nodeA.add(nodeB).multiplyScalar(0.5), kf);
}
