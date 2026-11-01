import { Vector3 } from 'three';
import { gnoise, latticeHash } from '../planet/noise';
import { CELLS, cellFrequency, gradientFrame, type TerraceBase, type TerraceFields } from './fields';

// The terraces' cells on the CPU (cells.glsl's twin, which the bake runs):
// the planet in cells some 45–90 m across, a Voronoi tiling in direction
// space whose edges wander, the lattice chosen per octave of R. Each cell is
// a system of terraces of its own: its key picks its walls, cuts and plots,
// its frame (its contours' way and its slope's at its middle) lays them out,
// its slope there sets its riser and its season leans its paddies earlier
// or later. Change both together.

export interface CellSample {
  /** Its lattice cell and key (0 … 1023). */
  x: number;
  y: number;
  z: number;
  key: number;
  /** Its middle (unit direction) and the distance to its edge (m). */
  centre: Vector3;
  edge: number;
  /** Its frame at its middle: the way along its contours and up its slope (unit tangents), its slope and its season there. */
  along: Vector3;
  up: Vector3;
  slope: number;
  season: number;
  /** Where the direction lies from its middle (m): along its way and up its slope. */
  v: number;
  w: number;
}

export function createCellSample(): CellSample {
  return { x: 0, y: 0, z: 0, key: 0, centre: new Vector3(), edge: 0, along: new Vector3(1, 0, 0), up: new Vector3(0, 0, 1), slope: 0, season: 0, v: 0, w: 0 };
}

interface Frame {
  readonly along: Vector3;
  readonly up: Vector3;
  readonly slope: number;
  readonly season: number;
}

const p = new Vector3();
const f = new Vector3();
const f1 = new Vector3();
const n = new Vector3();
const a = new Vector3();
const b = new Vector3();
const q = new Vector3();
const ringBase: TerraceBase = { natural: 0, slope: 0, wild: 0, flat: 0 };

export class TerraceCells {
  frequency = 2;
  private readonly frames = new Map<string, Frame>();
  private framesFor = '';

  constructor(
    private readonly fields: TerraceFields,
    private readonly seed: number,
  ) {}

  /** Refresh for R (and forget the frames when anything they read has changed: key, everything the fields depend on). */
  update(radius: number, key: string): void {
    this.frequency = cellFrequency(radius);
    if (key !== this.framesFor) {
      this.framesFor = key;
      this.frames.clear();
    }
  }

  private feature(cx: number, cy: number, cz: number, out: Vector3): Vector3 {
    const h = latticeHash(cx, cy, cz, (this.seed + 811) >>> 0);
    return out.set(cx + 0.15 + (0.7 * (h & 1023)) / 1023, cy + 0.15 + (0.7 * ((h >>> 10) & 1023)) / 1023, cz + 0.15 + (0.7 * ((h >>> 20) & 1023)) / 1023);
  }

  /** The cell a direction lies in (mirrors cellAt and terraceLayout in cells.glsl). */
  at(dir: Vector3, out: CellSample): CellSample {
    const F = this.frequency;
    const R = this.fields.radius;
    p.copy(dir).multiplyScalar(F);
    const qx = p.x * 1.9;
    const qy = p.y * 1.9;
    const qz = p.z * 1.9;
    const s = this.seed;
    const wx = gnoise(qx, qy, qz, (s + 821) >>> 0);
    const wy = gnoise(qx + 17.3, qy - 4.1, qz + 8.7, (s + 822) >>> 0);
    const wz = gnoise(qx - 9.1, qy + 13.5, qz - 2.3, (s + 823) >>> 0);
    p.x += wx * CELLS.warp;
    p.y += wy * CELLS.warp;
    p.z += wz * CELLS.warp;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    let d1 = 1e9;
    let cx = bx;
    let cy = by;
    let cz = bz;
    for (let z = -1; z <= 1; z++) {
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
          this.feature(bx + x, by + y, bz + z, f);
          const d = f.distanceToSquared(p);
          if (d < d1) {
            d1 = d;
            cx = bx + x;
            cy = by + y;
            cz = bz + z;
            f1.copy(f);
          }
        }
      }
    }
    let edge = 1e9;
    for (let z = -1; z <= 1; z++) {
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
          if (bx + x === cx && by + y === cy && bz + z === cz) continue;
          this.feature(bx + x, by + y, bz + z, f);
          n.subVectors(f, f1);
          const len = n.length();
          q.addVectors(f, f1).multiplyScalar(0.5).sub(p);
          edge = Math.min(edge, q.dot(n) / len);
        }
      }
    }
    out.x = cx;
    out.y = cy;
    out.z = cz;
    out.key = (latticeHash(cx, cy, cz, (s + 812) >>> 0) >>> 8) & 1023;
    out.centre.copy(f1).normalize();
    out.edge = (Math.max(edge, 0) / F) * R;
    const fr = this.frame(out);
    out.along.copy(fr.along);
    out.up.copy(fr.up);
    out.slope = fr.slope;
    out.season = fr.season;
    q.subVectors(dir, out.centre).multiplyScalar(R);
    out.v = q.dot(out.along);
    out.w = q.dot(out.up);
    return out;
  }

  /** A cell's slope: the mean over its terraceable ground round its middle, in two rings (mirrors cellSlope). */
  private meanSlope(centre: Vector3): number {
    gradientFrame(centre, a, b);
    const R = this.fields.radius;
    const size = R / this.frequency;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 12; i++) {
      const r = (i < 4 ? 0.18 : 0.4) * size;
      const th = (i < 4 ? i / 4 : (i - 4) / 8 + 0.0625) * 2 * Math.PI;
      q.copy(centre)
        .addScaledVector(a, (Math.cos(th) * r) / R)
        .addScaledVector(b, (Math.sin(th) * r) / R)
        .normalize();
      const t = this.fields.base(q, ringBase);
      if (t.flat < 0.5 && t.wild < 0.5) {
        sum += t.slope;
        count++;
      }
    }
    return count > 0 ? sum / count : this.fields.base(centre, ringBase).slope;
  }

  /** A cell's frame at its middle (mirrors cellFrameAt), kept per cell. */
  private frame(c: CellSample): Frame {
    const id = `${c.x},${c.y},${c.z}`;
    const known = this.frames.get(id);
    if (known) return known;
    gradientFrame(c.centre, a, b);
    const e = CELLS.frame / this.fields.radius;
    const nat = (dx: Vector3, k: number): number => this.fields.natural(q.copy(c.centre).addScaledVector(dx, k * e).normalize());
    const gx = (nat(a, 1) - nat(a, -1)) / (2 * CELLS.frame);
    const gy = (nat(b, 1) - nat(b, -1)) / (2 * CELLS.frame);
    const slope = Math.hypot(gx, gy);
    const up = new Vector3();
    if (slope > 1e-3) up.copy(a).multiplyScalar(gx).addScaledVector(b, gy).normalize();
    else {
      const th = (2 * Math.PI * c.key) / 1024;
      up.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    }
    const along = new Vector3().crossVectors(c.centre, up).normalize();
    const fr = { along, up, slope: this.meanSlope(c.centre), season: this.fields.season(c.centre) };
    this.frames.set(id, fr);
    return fr;
  }
}
