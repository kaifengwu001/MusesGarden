import { BufferAttribute, InstancedBufferGeometry } from 'three';

// Procedural flower templates (meters, y up, bloom head at the top of the
// stem). Per vertex: aPart = 0 stem, 1 petal, 2 centre; aT = position along
// the stem 0..1 (for bending), or 1 for the head. All original designs.

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
 * Pink cup, the hero flower: a tall wiry stem and one nodding cup. The cup is
 * built around +y and tilted in the shader so it streams with the wind.
 * Head-local coordinates are stored relative to the stem top.
 */
export function pinkCup(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.5;
  stem(b, h, 0.014, 4, 0.035);
  // a deep bell: base at the stem top, a waist, and an evenly flared lip
  const n = 7;
  const rings: Array<[number, number]> = [
    [0.018, 0.01],
    [0.041, 0.041],
    [0.051, 0.078],
    [0.064, 0.103],
  ];
  const base = vert(b, 0, h, 0, 1, 1);
  const idx: number[][] = rings.map(([r, y]) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return vert(b, Math.cos(a) * r, h + y, Math.sin(a) * r, 1, 1);
  }));
  for (let k = 0; k < n; k++) b.idx.push(base, idx[0][(k + 1) % n], idx[0][k]);
  for (let ring = 0; ring + 1 < idx.length; ring++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = idx[ring][k];
      const c = idx[ring][k1];
      const d = idx[ring + 1][k];
      const e = idx[ring + 1][k1];
      b.idx.push(a, c, e, a, e, d);
    }
  }
  return finish(b);
}

/** White star: a flat five-pointed star with a yellow centre, mid height. */
export function whiteStar(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.44;
  stem(b, h, 0.012, 3, 0.025);
  const centre = vert(b, 0, h + 0.012, 0, 2, 1);
  const ring: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 0.078 : 0.03;
    ring.push(vert(b, Math.cos(a) * r, h + (k % 2 === 0 ? 0.0 : 0.008), Math.sin(a) * r, 1, 1));
  }
  const disc: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = ((k + 0.5) / 5) * Math.PI * 2;
    disc.push(vert(b, Math.cos(a) * 0.016, h + 0.013, Math.sin(a) * 0.016, 2, 1));
  }
  for (let k = 0; k < 10; k++) b.idx.push(centre, ring[(k + 1) % 10], ring[k]);
  for (let k = 0; k < 5; k++) b.idx.push(centre, disc[(k + 1) % 5], disc[k]);
  return finish(b);
}

/** Button: a wiry stem and a small domed disc just above the grass. */
export function yellowButton(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.34;
  stem(b, h, 0.01, 3, 0.02);
  const centre = vert(b, 0, h + 0.026, 0, 2, 1);
  const ring: number[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    ring.push(vert(b, Math.cos(a) * 0.048, h, Math.sin(a) * 0.048, 1, 1));
  }
  for (let k = 0; k < 7; k++) b.idx.push(centre, ring[(k + 1) % 7], ring[k]);
  return finish(b);
}

/** Small blue clusters: three four-petal florets on a slender stem. */
export function blueCluster(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.38;
  stem(b, h, 0.01, 3, 0.025);
  const florets: Array<[number, number, number]> = [
    [0, h + 0.025, 0],
    [0.038, h - 0.005, 0.02],
    [-0.032, h - 0.012, -0.025],
  ];
  for (const [x, y, z] of florets) {
    const c = vert(b, x, y + 0.007, z, 2, 1);
    const ring: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      ring.push(vert(b, x + Math.cos(a) * 0.025, y, z + Math.sin(a) * 0.025, 1, 1));
    }
    for (let k = 0; k < 4; k++) b.idx.push(c, ring[(k + 1) % 4], ring[k]);
  }
  return finish(b);
}

export const SPECIES = ['pink', 'star', 'yellow', 'blue'] as const;
export const SPECIES_MESH = [pinkCup, whiteStar, yellowButton, blueCluster];
