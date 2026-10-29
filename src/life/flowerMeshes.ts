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
  const h = 0.62;
  stem(b, h, 0.016, 5, 0.04);
  const top = h;
  const n = 6;
  const base = vert(b, 0, top, 0, 1, 1);
  const rim: number[] = [];
  const lip: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 0.055;
    rim.push(vert(b, Math.cos(a) * r, top + 0.06, Math.sin(a) * r, 1, 1));
    // petal tips flare slightly and alternate in height: a soft scalloped lip
    const a2 = a + Math.PI / n;
    lip.push(vert(b, Math.cos(a2) * 0.075, top + 0.105 + (k % 2) * 0.012, Math.sin(a2) * 0.075, 1, 1));
  }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.idx.push(base, rim[k1], rim[k]);
    b.idx.push(rim[k], rim[k1], lip[k]);
  }
  return finish(b);
}

/** White star: a flat five-pointed star with a yellow centre, mid height. */
export function whiteStar(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.34;
  stem(b, h, 0.012, 3, 0.025);
  const centre = vert(b, 0, h + 0.012, 0, 2, 1);
  const ring: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 0.07 : 0.028;
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

/** Yellow button: a short stem and a small domed disc at ground level. */
export function yellowButton(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.16;
  stem(b, h, 0.01, 2, 0.015);
  const centre = vert(b, 0, h + 0.022, 0, 2, 1);
  const ring: number[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    ring.push(vert(b, Math.cos(a) * 0.038, h, Math.sin(a) * 0.038, 1, 1));
  }
  for (let k = 0; k < 7; k++) b.idx.push(centre, ring[(k + 1) % 7], ring[k]);
  return finish(b);
}

/** Small blue clusters: three tiny four-petal florets on a short stem. */
export function blueCluster(): InstancedBufferGeometry {
  const b = builder();
  const h = 0.2;
  stem(b, h, 0.01, 2, 0.02);
  const florets: Array<[number, number, number]> = [
    [0, h + 0.02, 0],
    [0.03, h - 0.005, 0.015],
    [-0.025, h - 0.01, -0.02],
  ];
  for (const [x, y, z] of florets) {
    const c = vert(b, x, y + 0.006, z, 2, 1);
    const ring: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      ring.push(vert(b, x + Math.cos(a) * 0.02, y, z + Math.sin(a) * 0.02, 1, 1));
    }
    for (let k = 0; k < 4; k++) b.idx.push(c, ring[(k + 1) % 4], ring[k]);
  }
  return finish(b);
}

export const SPECIES = ['pink', 'star', 'yellow', 'blue'] as const;
export const SPECIES_MESH = [pinkCup, whiteStar, yellowButton, blueCluster];
