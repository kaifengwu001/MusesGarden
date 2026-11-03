import { describe, expect, it } from 'vitest';
import { Bands } from '../../terraces/build/bands';
import { BUILD, buildTerraces, PART } from '../../terraces/build/construct';
import { FIELD, PlanetField, type Plains } from '../../terraces/build/field';
import { SphereGrid, type Field } from '../../terraces/build/sphere';
import { TerraceRig } from '../../terraces/camera';
import { ribbonMesh } from '../../terraces/mistRibbons';
import { makeStrokes } from '../../terraces/mistStrokes';
import { CameraRig } from '../../view/camera';

// The terraces' planet is mathematics (build/field.ts) and its terraces the
// paddy lab's construction on it (build/): the field's gradient is its own
// (not differences of heights), and stays so where plains hold it level, the
// cube faces' grid shares every edge, every outline's point lies on its
// level's field (found on the field itself, never interpolated), and a small
// planet builds paddies, banks, cuts, woods and a plain from it, with a bank
// along every step between two farmed floors.

const seed = 0x51ce7a;
const field = new PlanetField({ ...FIELD, radius: 40, seed });
const dirs: Array<[number, number, number]> = [];
for (let i = 0; i < 400; i++) {
  const z = 1 - (2 * (i + 0.5)) / 400;
  const r = Math.sqrt(1 - z * z);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  dirs.push([r * Math.cos(a), r * Math.sin(a), z]);
}

describe("the terraces' mathematics", () => {
  it("gives the hills' and the terrace field's gradients exactly (against centimetre differences)", () => {
    const g = new Float64Array(3);
    const e = 0.01 / field.R;
    let worst = 0;
    for (const [x, y, z] of dirs) {
      for (const f of [(px: number, py: number, pz: number, out?: Float64Array) => field.height(px, py, pz, out), (px: number, py: number, pz: number, out?: Float64Array) => field.terrace(px, py, pz, out)]) {
        f(x, y, z, g);
        // (along two tangents: the difference over a centimetre either way)
        const t1 = [-z, 0, x];
        const l1 = Math.hypot(...t1) || 1;
        const a = t1.map((v) => v / l1);
        const b = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]];
        for (const t of [a, b]) {
          const at = (s: number): number => {
            const px = x + t[0] * s;
            const py = y + t[1] * s;
            const pz = z + t[2] * s;
            const l = Math.hypot(px, py, pz);
            return f(px / l, py / l, pz / l);
          };
          const diff = (at(e) - at(-e)) / 0.02;
          worst = Math.max(worst, Math.abs(diff - (g[0] * t[0] + g[1] * t[1] + g[2] * t[2])));
        }
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('carries the gradient through the plains (held level, eased back over a collar), the woods\' ground with it', () => {
    // (a plain round a direction: held wholly within 0.25 rad of it, its hold falling to nothing by 0.45)
    const held = new PlanetField({ ...FIELD, radius: 40, seed });
    const c = [0.6, 0.48, 0.64];
    const cl = Math.hypot(...c);
    const C = c.map((v) => v / cl);
    const plains: Plains = {
      count: 1,
      near: () => true,
      weight: (_p, x, y, z, g) => {
        const a = Math.acos(Math.min(Math.max(x * C[0] + y * C[1] + z * C[2], -1), 1));
        const u = Math.min(Math.max((a - 0.25) / 0.2, 0), 1);
        if (g) {
          // (dw/da times a's gradient: away from the middle along the planet, per meter)
          const dw = (-6 * u * (1 - u)) / 0.2 / held.R;
          const s = Math.sin(a) || 1;
          const dot = x * C[0] + y * C[1] + z * C[2];
          g[0] = (dw * (x * dot - C[0])) / s;
          g[1] = (dw * (y * dot - C[1])) / s;
          g[2] = (dw * (z * dot - C[2])) / s;
        }
        return 1 - u * u * (3 - 2 * u);
      },
      level: Float64Array.of(3),
    };
    held.plains = plains;
    const g = new Float64Array(3);
    const e = 0.01 / held.R;
    let worst = 0;
    let flat = 0;
    for (const [x, y, z] of dirs) {
      for (const f of [(px: number, py: number, pz: number, out?: Float64Array) => held.terrace(px, py, pz, out), (px: number, py: number, pz: number, out?: Float64Array) => held.ground(px, py, pz, out)]) {
        f(x, y, z, g);
        const t1 = [-z, 0, x];
        const l1 = Math.hypot(...t1) || 1;
        const a = t1.map((v) => v / l1);
        const b = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]];
        for (const t of [a, b]) {
          const at = (s: number): number => {
            const px = x + t[0] * s;
            const py = y + t[1] * s;
            const pz = z + t[2] * s;
            const l = Math.hypot(px, py, pz);
            return f(px / l, py / l, pz / l);
          };
          worst = Math.max(worst, Math.abs((at(e) - at(-e)) / 0.02 - (g[0] * t[0] + g[1] * t[1] + g[2] * t[2])));
        }
      }
      // (held level where the plain holds it wholly)
      if (x * C[0] + y * C[1] + z * C[2] > Math.cos(0.24)) flat = Math.max(flat, Math.abs(held.terrace(x, y, z) - 3));
    }
    expect(worst).toBeLessThan(1e-4);
    expect(flat).toBe(0);
  });

  it("finds every outline's point on its level's field, the faces' shared edges and all", () => {
    const grid = new SphereGrid(40, 0.9);
    const T = new Float64Array(grid.V);
    const D = grid.dir;
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < grid.V; v++) {
      T[v] = field.terrace(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      lo = Math.min(lo, T[v]);
      hi = Math.max(hi, T[v]);
    }
    const levels = field.levels(lo, hi);
    const G = (k: number, x: number, y: number, z: number, t: number): number => t - levels[k] - field.wander(k, x, y, z);
    const Gv = (k: number, v: number): number => G(k, D[3 * v], D[3 * v + 1], D[3 * v + 2], T[v]);
    const terrace: Field = (x, y, z) => field.terrace(x, y, z);
    const bands = new Bands(grid, levels, G, Gv, T, terrace, 100);
    const chains = bands.trace();
    expect(chains.length).toBeGreaterThan(50);
    const p = [0, 0, 0];
    let worst = 0;
    let points = 0;
    for (const c of chains) {
      const H = bands.H(c.level)[0];
      for (const id of c.pts) {
        grid.point(id, p);
        worst = Math.max(worst, Math.abs(H(p[0], p[1], p[2])));
        points++;
      }
    }
    expect(points).toBeGreaterThan(5000);
    // (half a millimetre along an edge, the root's own tolerance: at most this far off the level in height)
    expect(worst).toBeLessThan(5e-4);
  });

  it('builds a small planet: paddies, banks, cuts, woods and a plain divided into fields', { timeout: 60000 }, () => {
    // (a planet of R 50 whose seed gives it a plain)
    const out = buildTerraces({ seed: 7, field: { ...FIELD, radius: 50 }, params: BUILD });
    expect(out.stats.plains).toBeGreaterThan(0);
    expect(out.stats.fields).toBeGreaterThan(1);
    expect(out.stats.grooves).toBeGreaterThan(0);
    expect(out.stats.paddies).toBeGreaterThan(200);
    expect(out.stats.banks).toBeGreaterThan(20);
    expect(out.stats.cutLines).toBeGreaterThan(100);
    // (every step between two farmed floors has a bank along it, within 12 cm: none left bare)
    expect(out.bare.length).toBe(0);
    const parts = new Set<number>();
    for (const c of out.chunks) if (c) for (let i = 0; i < c.part.length; i++) parts.add(c.part[i]);
    for (const part of [PART.floor, PART.riser, PART.bund, PART.ridge]) expect(parts.has(part)).toBe(true);
    // (every vertex on the planet, within its hills' relief)
    for (const c of out.chunks) {
      if (!c) continue;
      for (let i = 0; i < c.position.length; i += 3) {
        const r = Math.hypot(c.position[i], c.position[i + 1], c.position[i + 2]);
        expect(Math.abs(r - 50)).toBeLessThan(FIELD.relief + 2);
      }
    }
  });
});

// The terraces' mist is strokes (terraces/mistStrokes.ts): the same strokes for a seed, the fewer the first of the
// more, none where no cloud's height ever clears the ground, and every segment on the sphere with a breadth of its
// own, broad bodies and thin necks both; each cloud at its own height within the range, its strokes with it. Drawn as
// ribbons (terraces/mistRibbons.ts): on the sphere, never folded over, every chunk of the strokes' shapes among them,
// the clouds in order of height both ways.
describe("the terraces' mist strokes", () => {
  const P = { strokes: 24, range: 3, half: 2.4, length: [30, 80] as const, wavelength: [24, 40] as const, sinuosity: [0.35, 1.4] as const, curl: 0.4, branch: 0.35, stack: 0.3, lobe: 2.8, steer: 0.04, twist: 0.6 };
  const axis: [number, number, number] = [0.9, 0, -0.44];
  const open = (): number => 5;
  it('makes the same strokes for a seed, the fewer the first of the more', () => {
    const a = makeStrokes(P, 7, 128, axis, open);
    const b = makeStrokes(P, 7, 128, axis, open);
    const c = makeStrokes({ ...P, strokes: 12 }, 7, 128, axis, open);
    expect(a.count).toBeGreaterThan(0);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    expect(c.count).toBeLessThan(a.count);
    expect(Array.from(c.data)).toEqual(Array.from(a.data.subarray(0, c.data.length)));
  });
  it('keeps no stroke where no cloud would clear the ground', () => {
    // (the layer's sphere under the ground by more than any cloud is raised from it)
    expect(makeStrokes(P, 7, 128, axis, () => -P.range - 1).count).toBe(0);
  });
  it('lays every segment on the sphere, its breadth swelling and pinching', () => {
    const s = makeStrokes(P, 11, 128, axis, open);
    let thin = 0;
    let broad = 0;
    for (let i = 0; i < s.count; i++) {
      const o = 8 * i;
      for (const k of [0, 3]) expect(Math.abs(Math.hypot(s.data[o + k], s.data[o + k + 1], s.data[o + k + 2]) - 1)).toBeLessThan(1e-5);
      // (a step's length on the planet: half a meter, give or take a scallop's shift)
      const step = 128 * Math.hypot(s.data[o + 3] - s.data[o], s.data[o + 4] - s.data[o + 1], s.data[o + 5] - s.data[o + 2]);
      expect(step).toBeLessThan(1.2);
      expect(s.data[o + 6]).toBeGreaterThanOrEqual(0);
      if (s.data[o + 6] < 0.5 * P.half) thin++;
      if (s.data[o + 6] > 1.25 * P.half) broad++;
    }
    expect(thin).toBeGreaterThan(0.05 * s.count);
    expect(broad).toBeGreaterThan(0.05 * s.count);
  });
  it('makes as many clouds as asked for, each at its own height within the range, its strokes with it', () => {
    const s = makeStrokes(P, 11, 128, axis, open);
    expect(s.clouds).toBe(P.strokes);
    const heights = new Map<number, number>();
    for (const r of s.ribbons) {
      expect(Math.abs(r.offset)).toBeLessThanOrEqual(P.range);
      if (heights.has(r.cloud)) expect(r.offset).toBe(heights.get(r.cloud));
      heights.set(r.cloud, r.offset);
    }
    expect(heights.size).toBe(P.strokes);
    expect(new Set(heights.values()).size).toBe(P.strokes);
  });
  it('draws each stroke as a ribbon on the sphere, never folded, its chunks those of its shapes, the clouds in order', () => {
    const R = 128;
    const s = makeStrokes(P, 11, R, axis, open);
    const m = ribbonMesh(s, R, 0.6);
    const n = m.position.length / 3;
    for (let i = 0; i < n; i++) expect(Math.abs(Math.hypot(m.position[3 * i], m.position[3 * i + 1], m.position[3 * i + 2]) - 1)).toBeLessThan(1e-5);
    // (every triangle turned the same way against the sphere: none folded back over its ribbon)
    let flipped = 0;
    const V = (i: number): number[] => [m.position[3 * i], m.position[3 * i + 1], m.position[3 * i + 2]];
    for (let t = 0; t < m.ascending.length; t += 3) {
      const [a, b, c] = [V(m.ascending[t]), V(m.ascending[t + 1]), V(m.ascending[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      if ((u[1] * v[2] - u[2] * v[1]) * a[0] + (u[2] * v[0] - u[0] * v[2]) * a[1] + (u[0] * v[1] - u[1] * v[0]) * a[2] >= 0) flipped++;
    }
    expect(flipped).toBe(0);
    // (each segment's chunk and height among the ribbons' vertices)
    const owners = new Set<string>();
    for (let i = 0; i < n; i++) owners.add(`${m.owner[2 * i]}/${m.owner[2 * i + 1]}`);
    expect(m.segments.length).toBe(2 * s.count);
    for (let i = 0; i < s.count; i++) expect(owners.has(`${m.segments[2 * i]}/${m.segments[2 * i + 1]}`)).toBe(true);
    // (the clouds lowest first one way, highest first the other, the same triangles in each)
    for (let i = 1; i < m.heights.length; i++) expect(m.heights[i]).toBeGreaterThanOrEqual(m.heights[i - 1]);
    expect(m.counts.reduce((a, b) => a + b, 0)).toBe(m.ascending.length);
    expect(Array.from(m.descending).sort((a, b) => a - b)).toEqual(Array.from(m.ascending).sort((a, b) => a - b));
    const last = m.ascending.length - m.counts[m.counts.length - 1];
    expect(Array.from(m.descending.subarray(0, m.counts[m.counts.length - 1]))).toEqual(Array.from(m.ascending.subarray(last)));
  });
});

describe("the terraces' camera", () => {
  it("tilts up further round the bird's-eye height, as the shared rig's elsewhere, and only ever up on the way in", () => {
    const shared = new CameraRig();
    const rig = new TerraceRig();
    let last = 0;
    for (let i = 0; i <= 200; i++) {
      const z = i / 200;
      const a = shared.framing(z);
      const b = rig.framing(z);
      expect(b.altitude).toBe(a.altitude);
      expect(b.fov).toBe(a.fov);
      if (z <= 0.1 || z >= 0.65) expect(b.tilt).toBeCloseTo(a.tilt, 9);
      else expect(b.tilt).toBeGreaterThanOrEqual(a.tilt - 1e-12);
      expect(b.tilt).toBeGreaterThanOrEqual(last - 1e-12);
      last = b.tilt;
    }
    // (the bird's-eye stop, 70 m up: 38.5° from straight down, from 14.4°)
    const z = rig.zoomForAltitude(70.2);
    expect((rig.framing(z).tilt * 180) / Math.PI).toBeCloseTo(38.5, 0);
    expect((shared.framing(z).tilt * 180) / Math.PI).toBeCloseTo(14.4, 0);
    expect(rig.lift(z)).toBeCloseTo(rig.framing(z).tilt - shared.framing(z).tilt, 12);
  });
});
