import { BufferAttribute, InstancedBufferGeometry } from 'three';

// Procedural flower templates (meters, y up, bloom head at the top of the
// stem). Per vertex: aPart = 0 stem, 1 petal, 2 centre, 3 leaf at the foot;
// aT = position along the stem 0..1 (for bending), or 1 for the head.

interface Builder {
  pos: number[];
  part: number[];
  t: number[];
  idx: number[];
}

function builder(): Builder {
  return { pos: [], part: [], t: [], idx: [] };
}

function vert(b: Builder, x: number, y: number, z: number, part: number, t: number): number {
  b.pos.push(x, y, z);
  b.part.push(part);
  b.t.push(t);
  return b.pos.length / 3 - 1;
}

/** A thin stem ribbon from the ground to height h, with a gentle S curve. */
function stem(b: Builder, h: number, width: number, segments: number, curve: number): void {
  let prev: [number, number] | null = null;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const x = curve * Math.sin(t * Math.PI * 0.9) * t;
    const w = width * (1 - 0.4 * t);
    const a = vert(b, x - w / 2, t * h, 0, 0, t);
    const c = vert(b, x + w / 2, t * h, 0, 0, t);
    if (prev) b.idx.push(prev[0], prev[1], c, prev[0], c, a);
    prev = [a, c];
  }
}

function finish(b: Builder): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(b.part), 1));
  g.setAttribute('aT', new BufferAttribute(new Float32Array(b.t), 1));
  g.setIndex(b.idx);
  return g;
}

/**
 * P02 ivory starflower: a slender red-brown stem, five thin petals cupped a
 * little upward round a small ochre centre, and two or three narrow leaves
 * arching from its foot (aPart 3: placed and bent like the stem). Stem top
 * 0.38 m: sizes 0.65–1.45 give the brief's 0.25–0.55 m; the flower is about
 * 0.11 m across (0.08–0.15). Head-local coordinates sit at the stem top.
 */
export function starflower(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.38;
  stem(b, h, 0.009, 4, 0.03);
  // five thin petals: narrow, widest a little past the middle, their tips lifted
  const length = 0.064;
  const width = 0.03;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const ax = Math.cos(a);
    const az = Math.sin(a);
    const rows: Array<[number, number]> = [];
    for (const u of [0, 0.3, 0.6, 0.85, 1]) {
      const r = 0.006 + u * length;
      const half = (width / 2) * Math.sin(Math.PI * Math.pow(u, 0.8)) + (u === 0 ? 0.002 : 0);
      const y = h + 0.004 + 0.014 * u * u;
      const l = vert(b, ax * r - az * half, y, az * r + ax * half, 1, 1);
      const rr = vert(b, ax * r + az * half, y, az * r - ax * half, 1, 1);
      rows.push([l, rr]);
    }
    for (let i = 0; i + 1 < rows.length; i++) b.idx.push(rows[i][0], rows[i][1], rows[i + 1][1], rows[i][0], rows[i + 1][1], rows[i + 1][0]);
  }
  // the ochre centre, a little domed
  const centre = vert(b, 0, h + 0.012, 0, 2, 1);
  const disc: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    disc.push(vert(b, Math.cos(a) * 0.012, h + 0.007, Math.sin(a) * 0.012, 2, 1));
  }
  for (let k = 0; k < 6; k++) b.idx.push(centre, disc[(k + 1) % 6], disc[k]);
  // narrow leaves arching out from the foot, and two up the stem
  for (const [a, len] of [
    [0.4, 0.17],
    [1.6, 0.13],
    [2.5, 0.15],
    [3.5, 0.12],
    [4.4, 0.2],
    [5.4, 0.14],
  ] as const) {
    const ax = Math.cos(a);
    const az = Math.sin(a);
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      const r = 0.01 + len * 0.75 * u;
      const y = 0.01 + len * (0.9 * u - 0.55 * u * u);
      const half = 0.009 * Math.sin(Math.PI * Math.pow(u, 0.7)) + 0.001;
      const l = vert(b, ax * r - az * half, y, az * r + ax * half, 3, y / h);
      const rr = vert(b, ax * r + az * half, y, az * r - ax * half, 3, y / h);
      if (prev) b.idx.push(prev[0], prev[1], rr, prev[0], rr, l);
      prev = [l, rr];
    }
  }
  return finish(b);
}

export const SPECIES = ['starflower'] as const;
export const SPECIES_MESH = [starflower];
