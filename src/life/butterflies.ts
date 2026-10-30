import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, mix, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { travel } from '../planet/geo';
import type { Terrain } from '../planet/terrain';
import fragmentShader from './butterfly.frag.glsl?raw';
import vertexShader from './butterfly.vert.glsl?raw';

// Butterflies about the flowers, once you are down in the meadow. They come
// from a lattice fixed to the planet (cells about CELL meters across, each
// holding at most one, kept more often where the meadow is in flower, never
// homed on the water), so they stay where they are as you move. The lattice
// is laid in direction space, one per octave of R: while the planet grows
// the same homes are kept, each keeping or losing its butterfly by rank as
// the density per m² would change, so they come and go one at a time (and
// the lattice changes only at an octave); those within REACH of
// where you stand fly, fading out toward its edge and as you rise. Each one's
// flight is closed-form in time: a slow, wandering loop about the height of
// the flowers' tops to eye level, in bursts of a few slow, full wingbeats
// (the body bobbing up on each downstroke and climbing through the burst)
// and glides on wings held in a shallow V, sinking a little; and every so
// often it settles on a flower, its wings slowly fanning, before taking off
// again. Six kinds, by their colours: whites, sulphurs, orange-tips, blues,
// tortoiseshells and peacocks (patterns painted in butterfly.frag.glsl), the
// whites fluttering on longest, the tortoiseshells and peacocks gliding most.

const MAX_BUTTERFLIES = 96;
/** Lattice cell (m), reach of the flying set about the focus (m), share of cells holding one at full bloom. */
const CELL = 5;
const REACH = 20;
const SHARE = 0.8;
/** Camera heights (m) between which they fade out. */
const SEEN = [8, 13] as const;
/** The kinds and how common each is (cumulative). */
const KINDS = [0.3, 0.55, 0.7, 0.85, 0.95, 1] as const;
/** Each kind's flight: wingbeat (Hz), beats in a burst, and the glide after it (s). */
const FLIGHTS = [
  { beat: 3.6, beats: [4, 6], glide: [0.3, 0.6] },
  { beat: 3.4, beats: [3, 5], glide: [0.4, 0.8] },
  { beat: 3.6, beats: [3, 5], glide: [0.3, 0.7] },
  { beat: 4, beats: [3, 5], glide: [0.3, 0.6] },
  { beat: 3, beats: [2, 3], glide: [0.7, 1.3] },
  { beat: 2.8, beats: [2, 3], glide: [0.8, 1.5] },
] as const;
/** Wing angle (rad up from flat): the glide's shallow V, and a full beat's swing about it (to near closed above, below flat). */
const WINGS = { glide: 0.42, swing: 0.88 } as const;
/** The landing cycle: flying, settling, perched, taking off (shares of a cycle). */
const PERCH = { settle: [0.72, 0.78], off: [0.95, 1] } as const;

interface Home {
  /** Direction of its home on the planet, and how the flowers there suit it (0 none … 1 thick). */
  dir: Vector3;
  flowers: number;
  seed: number;
  /** Its rank: it flies while this is under its share (SHARE, the flowers, and the lattice's cell size at this R). */
  rank: number;
}

/** ∫₀ᵘ smoothstep(a, b, x) dx. */
function rampIntegral(u: number, a: number, b: number): number {
  if (u <= a) return 0;
  if (u >= b) return (b - a) / 2 + (u - b);
  const x = (u - a) / (b - a);
  return (b - a) * (x * x * x - (x * x * x * x) / 2);
}

/** How far into a perch (0 flying … 1 settled) at cycle phase u, and the time spent settled so far in this cycle (× the period). */
function perch(u: number): [number, number] {
  const settled = smoothstep(PERCH.settle[0], PERCH.settle[1], u) - smoothstep(PERCH.off[0], PERCH.off[1], u);
  return [settled, rampIntegral(u, PERCH.settle[0], PERCH.settle[1]) - rampIntegral(u, PERCH.off[0], PERCH.off[1])];
}
const PERCHED_SHARE = perch(1)[1];

/**
 * The butterfly: a slim body and four wings, each a quad whose outline and
 * pattern are painted in the fragment shader; local x right, y up, z
 * forward, about 12 cm across. aPart: 0 body, ±1 forewing, ±2 hindwing.
 */
function butterflyGeometry(): InstancedBufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const part: number[] = [];
  const quad = (p: number, a: number[], b: number[], c: number[], d: number[]): void => {
    for (const [v, t] of [
      [a, [0, 0]],
      [b, [1, 0]],
      [c, [1, 1]],
      [a, [0, 0]],
      [c, [1, 1]],
      [d, [0, 1]],
    ] as const) {
      pos.push(...v);
      uv.push(...t);
      part.push(p);
    }
  };
  quad(0, [-0.004, 0, 0.032], [0.004, 0, 0.032], [0.004, 0, -0.034], [-0.004, 0, -0.034]);
  for (const s of [1, -1]) {
    // u along the span (body → tip), v across (leading → trailing edge)
    quad(s, [0.004 * s, 0, 0.026], [0.062 * s, 0, 0.03], [0.058 * s, 0, -0.012], [0.004 * s, 0, -0.006]);
    quad(2 * s, [0.004 * s, 0, 0.0], [0.046 * s, 0, -0.004], [0.04 * s, 0, -0.046], [0.004 * s, 0, -0.036]);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  return g;
}

export class Butterflies {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Butterflies flying now (perf stat). */
  count = 0;
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX_BUTTERFLIES * 3), 3);
  private readonly heading = new InstancedBufferAttribute(new Float32Array(MAX_BUTTERFLIES * 4), 4);
  private readonly look = new InstancedBufferAttribute(new Float32Array(MAX_BUTTERFLIES * 4), 4);
  /** Candidate homes near the focus, kept while the focus stays in its cell; and every cell judged so far. */
  private homes: Home[] = [];
  /** The lattice's cell (m) at the current R. */
  private cell = CELL;
  private homesKey = '';
  private readonly cells = new Map<string, Home | null>();
  private readonly c = new Vector3();
  private readonly t1 = new Vector3();
  private readonly t2 = new Vector3();
  private readonly p = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly flora = new Float32Array(4);

  constructor(shared: Record<string, IUniform>) {
    for (const a of [this.pos, this.heading, this.look]) a.setUsage(DynamicDrawUsage);
    const g = butterflyGeometry();
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aHeading', this.heading);
    g.setAttribute('aLook', this.look);
    g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'butterflies', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * The candidate homes in the lattice cells about the focus (cells are
   * judged once, then remembered). The lattice lives in direction space, at
   * the octave of R: cells CELL meters across at the octave's R, from
   * CELL/√2 to CELL·√2 within it.
   */
  private gather(terrain: Terrain, focus: Vector3): void {
    const level = Math.round(Math.log2(terrain.radius / 128));
    const scale = 128 * 2 ** level; // the lattice's R
    this.cell = (CELL * terrain.radius) / scale;
    const f = this.c.copy(focus).multiplyScalar(scale);
    const key = `${terrain.layout.seed}/${level}/${Math.floor(f.x / CELL)},${Math.floor(f.y / CELL)},${Math.floor(f.z / CELL)}`;
    if (key === this.homesKey) return;
    this.homesKey = key;
    if (this.cells.size > 20000) this.cells.clear();
    const fields = terrain.fields;
    const mean = fields.speciesDensity[0] + fields.speciesDensity[1] + fields.speciesDensity[2] + fields.speciesDensity[3];
    this.homes = [];
    // reach in the lattice's meters, wide enough for the smallest cells of the octave
    const reach = REACH * Math.SQRT2 + CELL;
    const lo = [Math.floor((f.x - reach) / CELL), Math.floor((f.y - reach) / CELL), Math.floor((f.z - reach) / CELL)];
    const hi = [Math.floor((f.x + reach) / CELL), Math.floor((f.y + reach) / CELL), Math.floor((f.z + reach) / CELL)];
    for (let i = lo[0]; i <= hi[0]; i++) {
      for (let j = lo[1]; j <= hi[1]; j++) {
        for (let k = lo[2]; k <= hi[2]; k++) {
          const cx = (i + 0.5) * CELL;
          const cy = (j + 0.5) * CELL;
          const cz = (k + 0.5) * CELL;
          // only cells the surface passes through, within reach
          if (Math.abs(Math.hypot(cx, cy, cz) - scale) > 0.87 * CELL || Math.hypot(cx - f.x, cy - f.y, cz - f.z) > reach) continue;
          const id = `${terrain.layout.seed}/${level}/${i},${j},${k}`;
          let home = this.cells.get(id);
          if (home === undefined) {
            home = null;
            const h = mix(mix(mix(mix(terrain.layout.seed, level), i), j), k);
            const dir = new Vector3(cx + (unit(hash32(h + 1)) - 0.5) * CELL, cy + (unit(hash32(h + 2)) - 0.5) * CELL, cz + (unit(hash32(h + 3)) - 0.5) * CELL).normalize();
            // its home must be inside this cell (each place on the surface belongs to one cell), on land
            const at = this.p.copy(dir).multiplyScalar(scale);
            if (Math.floor(at.x / CELL) === i && Math.floor(at.y / CELL) === j && Math.floor(at.z / CELL) === k && terrain.height0(dir) > 0.08) {
              fields.flora(dir, fields.wetness(dir), this.flora);
              const flowers = mean > 0 ? smoothstep(0.1, 1.2, (this.flora[0] + this.flora[1] + this.flora[2] + this.flora[3]) / mean) : 0;
              home = { dir, flowers, seed: h, rank: unit(hash32(h + 4)) };
            }
            this.cells.set(id, home);
          }
          if (home) this.homes.push(home);
        }
      }
    }
  }

  /**
   * Fly them for this frame: about `focus` (unit, planet space), shown fully
   * below the first of SEEN camera heights, where the meadow is in bloom
   * (within `bloomAngle` of the cottage).
   */
  update(time: number, terrain: Terrain, focus: Vector3, cameraHeight: number, bloomAngle: number): void {
    const shown = 1 - smoothstep(SEEN[0], SEEN[1], cameraHeight);
    this.mesh.visible = shown > 0;
    if (!this.mesh.visible) {
      this.count = 0;
      return;
    }
    this.gather(terrain, focus);
    const R = terrain.radius;
    const cottage = terrain.layout.cottage;
    const pos = this.pos.array as Float32Array;
    const heading = this.heading.array as Float32Array;
    const look = this.look.array as Float32Array;
    let n = 0;
    // the same number per m² whatever the cell size within the octave
    const density = SHARE * (this.cell / CELL) ** 2;
    for (const home of this.homes) {
      if (n >= MAX_BUTTERFLIES) break;
      if (home.rank >= density * (0.4 + 0.6 * home.flowers)) continue;
      const d = Math.acos(Math.min(1, home.dir.dot(focus))) * R;
      const fade = shown * smoothstep(REACH, REACH - 6, d) * smoothstep(bloomAngle, bloomAngle - 0.05, Math.acos(Math.min(1, home.dir.dot(cottage))));
      if (fade <= 0) continue;
      const h = home.seed;
      const r = (k: number): number => unit(hash32(h + k * 7919));
      // the landing cycle: the path's own clock stands still while it is settled
      const period = 14 + 10 * r(10);
      const cycle = time / period + r(11);
      const u = cycle - Math.floor(cycle);
      const [settled, stopped] = perch(u);
      const s = time - period * (Math.floor(cycle) * PERCHED_SHARE + stopped);
      // the wandering loop in the home's tangent plane, and a heading along it
      this.t1.set(0, 1, 0).addScaledVector(home.dir, -home.dir.y);
      if (this.t1.lengthSq() < 1e-6) this.t1.set(1, 0, 0);
      this.t1.normalize();
      this.t2.crossVectors(home.dir, this.t1);
      const where = (t: number, out: Vector3): Vector3 => {
        const x = (1.6 + 1.2 * r(1)) * Math.sin((0.22 + 0.16 * r(2)) * t + 6.3 * r(3)) + 0.5 * Math.sin((0.7 + 0.3 * r(4)) * t + 6.3 * r(5));
        const y = (1.6 + 1.2 * r(6)) * Math.cos((0.2 + 0.16 * r(7)) * t + 6.3 * r(8)) + 0.5 * Math.sin((0.8 + 0.3 * r(9)) * t + 6.3 * r(12));
        out.copy(this.t1).multiplyScalar(x).addScaledVector(this.t2, y);
        return travel(home.dir, out.normalize(), Math.hypot(x, y) / R, out);
      };
      where(s - 0.1, this.a);
      where(s + 0.1, this.b);
      where(s, this.p);
      // a slow sway aside, then up above the grass (or down onto a flower)
      const flutter = 0.06 * Math.sin(time * 2.2 + 9 * r(13)) * (1 - settled);
      this.a.subVectors(this.b, this.a);
      this.a.addScaledVector(this.p, -this.a.dot(this.p));
      if (this.a.lengthSq() < 1e-14) this.a.copy(this.t1);
      this.a.normalize();
      this.b.crossVectors(this.p, this.a);
      // the bursts: `beats` full beats (easing in and out over half a beat), then a glide
      const kindRoll = r(17);
      const kind = KINDS.findIndex((k) => kindRoll < k);
      const fl = FLIGHTS[kind];
      const hz = fl.beat * (0.92 + 0.16 * r(14));
      const flapping = Math.round(fl.beats[0] + (fl.beats[1] - fl.beats[0]) * r(20)) / hz;
      const burst = flapping + fl.glide[0] + (fl.glide[1] - fl.glide[0]) * r(21);
      const tau = (((time + burst * r(22)) % burst) + burst) % burst;
      const ease = 0.5 / hz;
      const env = smoothstep(0, ease, tau) * (1 - smoothstep(flapping - ease, flapping, tau));
      const stroke = env * Math.sin(Math.PI * 2 * hz * tau);
      // the body bobs up on each downstroke, climbs through the burst and sinks a little gliding
      const climb = (0.12 + 0.1 * r(23)) * ((tau < flapping ? smoothstep(0, flapping, tau) : 1 - smoothstep(flapping, burst, tau)) - 0.5);
      const lift = 0.8 + 0.7 * (0.5 + 0.5 * Math.sin(0.5 * time + 6.3 * r(15))) - 0.03 * stroke + climb;
      const ground = Math.max(terrain.height0(this.p), 0);
      const above = lift + (0.34 - lift) * settled;
      this.p.multiplyScalar(R + ground + above).addScaledVector(this.b, flutter);
      // wings: slow full beats and held glides in flight, a slow fan when settled
      const glide = WINGS.glide + 0.05 * (1 - env) * Math.sin(0.9 * time + 6.3 * r(24));
      const flap = (1 - settled) * (glide + WINGS.swing * stroke) + settled * (0.55 + 0.5 * Math.sin(time * 1.3 + 6.3 * r(16)));
      pos.set([this.p.x, this.p.y, this.p.z], n * 3);
      heading.set([this.a.x, this.a.y, this.a.z, flap], n * 4);
      look.set([kind, (1.25 + 0.4 * r(18)) * fade, (0.12 + 0.14 * env) * (1 - settled), r(19)], n * 4);
      n++;
    }
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.pos.needsUpdate = true;
    this.heading.needsUpdate = true;
    this.look.needsUpdate = true;
  }
}
