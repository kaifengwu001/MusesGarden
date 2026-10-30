import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import { hash32, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { tangentToward, travel } from '../planet/geo';
import type { Terrain } from '../planet/terrain';
import fragmentShader from './grass.frag.glsl?raw';
import vertexShader from './bird.vert.glsl?raw';
import shadowFragment from './birdShadow.frag.glsl?raw';
import shadowVertex from './birdShadow.vert.glsl?raw';

// Small flocks of white birds over the meadow, like the egrets and gulls
// that cross painted fields. Every flock belongs to the planet. Most travel:
// each flies a great circle round the world at 6–8 m/s, the circle slowly
// swinging so that over the minutes its route crosses the whole meadow, with
// a long, gentle meander from side to side. Two wheel in steady loops where
// you are most likely to be: over the meadow just behind the cottage (above
// its roof seen across the pond), and over the wetland's edge nearest it. They fly level, a few meters above the
// highest ground (rising over the cottage), in loose V's or clusters, each
// bird keeping its place with only a slight drift, beating steadily with now
// and then a short glide, banking into the turns. Every pose is a
// closed-form function of time, so a frozen frame is a pure function of
// state. Each bird drops a small soft disc into the clouds' shadow map, so
// its shadow falls on the meadow as theirs do.

const MAX_BIRDS = 256;
/** Flocks on an R = 128 m planet; more as it grows (with R, so as many cross a place). */
const FLOCKS = 9;
/** Half wingspan (m) of the bird mesh below. */
const HALF_SPAN = 0.48;
/**
 * Level flight: the hilltops stand at about this share of the terrain's
 * height bound (the bound is four spreads up; the highest ground seen is
 * nearer two and a half), flocks fly this far over them (m), and rise this
 * much more within this far of the cottage (m).
 */
const FLIGHT = { hilltops: 0.62, height: [3.2, 5.2], cottage: 1.5, cottageRadius: 16 } as const;

interface Bird {
  /** Place in the flock (m): ahead, to the side, up. */
  ahead: number;
  side: number;
  up: number;
  /** Drift phases, wingbeat frequency (Hz) and phase, glide rhythm (rad/s), half wingspan (m). */
  phase: [number, number, number];
  beat: number;
  beatPhase: number;
  glide: number;
  span: number;
}

interface Flock {
  /** A travelling flock's route: a great circle (start, axis, rad/s), swinging about another axis. */
  start: Vector3;
  axis: Vector3;
  rate: number;
  swing: Vector3;
  swingRate: number;
  /** Side-to-side meander: amplitude (m), rate (rad/s), phase. */
  meander: [number, number, number];
  /** The cottage flock wheels about a centre instead: centre, radius (m), rate (rad/s). */
  loop: { centre: Vector3; radius: number; rate: number } | null;
  /** Height above the highest ground (m), its slow swell (m, rad/s, phase). */
  height: number;
  swell: [number, number, number];
  birds: Bird[];
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

/**
 * The bird: a teardrop body with a keel and a fanned tail, and two-panel
 * wings (the broad inner panel hinged at the shoulder, the pointed outer one
 * at the elbow); local x right, y up, z forward, half span 0.48 m.
 * aHinge: 0 body, ±1 inner wing, ±2 outer wing.
 */
function birdGeometry(): InstancedBufferGeometry {
  const pos: number[] = [];
  const hinge: number[] = [];
  const tri = (h: number, ...v: number[]): void => {
    pos.push(...v);
    hinge.push(h, h, h);
  };
  // body: head, chest and tail as a flat teardrop, with a keel below
  const nose = [0, 0.012, 0.17];
  const head = [0.032, 0.006, 0.11];
  const chest = [0.058, 0, 0.02];
  const hip = [0.042, 0, -0.1];
  const fan = [0.085, 0, -0.21];
  const mirror = (v: number[]): number[] => [-v[0], v[1], v[2]];
  tri(0, ...nose, ...head, ...mirror(head));
  tri(0, ...head, ...chest, ...mirror(chest));
  tri(0, ...head, ...mirror(chest), ...mirror(head));
  tri(0, ...chest, ...hip, ...mirror(hip));
  tri(0, ...chest, ...mirror(hip), ...mirror(chest));
  tri(0, ...hip, ...fan, 0, 0, -0.18);
  tri(0, ...mirror(hip), 0, 0, -0.18, ...mirror(fan));
  tri(0, ...hip, 0, 0, -0.18, ...mirror(hip));
  tri(0, 0, 0, 0.13, 0, -0.05, 0.01, 0, 0, -0.12);
  for (const s of [1, -1]) {
    const at = (x: number, z: number): number[] => [x * s, 0, z];
    // inner panel: broad, from the shoulder to the elbow
    const sl = at(0.05, 0.085);
    const st = at(0.05, -0.115);
    const el = at(0.25, 0.075);
    const et = at(0.25, -0.13);
    tri(s, ...sl, ...el, ...et);
    tri(s, ...sl, ...et, ...st);
    // outer panel: a curved leading edge out to a pointed, swept-back tip
    const lead = at(0.37, 0.035);
    const tip = at(HALF_SPAN, -0.07);
    const trail = at(0.37, -0.15);
    tri(2 * s, ...el, ...lead, ...tip);
    tri(2 * s, ...el, ...tip, ...trail);
    tri(2 * s, ...el, ...trail, ...et);
  }
  // the elbow vertices sit on the elbow's hinge, so both panels put them in the same place
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aHinge', new BufferAttribute(new Float32Array(hinge), 1));
  return g;
}

function quad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class Birds {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Discs for the clouds' shadow map (Clouds.addShadowCaster). */
  readonly shadowMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Birds flying now (perf stat). */
  count = 0;
  private flocks: Flock[] = [];
  private layoutSeed = Number.NaN;
  private flockCount = 0;
  private flockR = Number.NaN;
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3);
  private readonly frame = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly wing = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly centre = new Vector3();
  private readonly ahead = new Vector3();
  private readonly side = new Vector3();
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly fwd = new Vector3();
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly dir = new Vector3();

  constructor(shared: Record<string, IUniform>) {
    for (const a of [this.pos, this.frame, this.wing]) a.setUsage(DynamicDrawUsage);
    const g = birdGeometry();
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aFrame', this.frame);
    g.setAttribute('aWing', this.wing);
    g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'birds', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;

    const sg = quad();
    sg.setAttribute('aPos', this.pos);
    sg.setAttribute('aWing', this.wing);
    sg.instanceCount = 0;
    this.shadowMesh = new Mesh(
      sg,
      new ShaderMaterial({
        name: 'bird shadows',
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        uniforms: { uCubeFace: shared.uCubeFace, uRadius: shared.uRadius, uSunAngles: shared.uSunAngles },
        side: DoubleSide,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.shadowMesh.frustumCulled = false;
  }

  /** Flocks for a world: two wheeling near the cottage, the rest on routes round the planet. */
  private build(terrain: Terrain, count: number): void {
    const L = terrain.layout;
    const R = terrain.radius;
    const rand = rng(L.seed ^ 0xb12d5);
    // where land and water interlace near the cottage (as the lakes view finds it)
    const marsh = new Vector3();
    const t = new Vector3();
    const q = new Vector3();
    let best = -Infinity;
    for (let k = 0; k < 24; k++) {
      t.copy(L.homeBearing).applyAxisAngle(L.cottage, (k / 24) * Math.PI * 2);
      for (let d = 30; d < 0.6 * Math.PI * R; d += 8) {
        const w = terrain.fields.wetness(travel(L.cottage, t, d / R, q));
        const score = w * (1 - w) - (0.6 * d) / (Math.PI * R);
        if (score > best) {
          best = score;
          marsh.copy(q);
        }
      }
    }
    // and some way into the wetland, over its lakes
    const e = 3 / R;
    const a = tangentToward(marsh, L.homeBearing, new Vector3());
    const b = new Vector3().crossVectors(marsh, a);
    const w0 = terrain.fields.wetness(marsh);
    const into = a
      .clone()
      .multiplyScalar(terrain.fields.wetness(q.copy(marsh).addScaledVector(a, e).normalize()) - w0)
      .addScaledVector(b, terrain.fields.wetness(q.copy(marsh).addScaledVector(b, e).normalize()) - w0);
    if (into.lengthSq() > 1e-12) travel(marsh, into.normalize(), 30 / R, marsh);
    const unitVector = (): Vector3 => {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      return new Vector3(s * Math.cos(a), s * Math.sin(a), z);
    };
    this.flocks = Array.from({ length: count }, (_, f): Flock => {
      const axis = unitVector();
      const start = tangentToward(axis, unitVector(), new Vector3());
      const speed = 6 + 2 * rand();
      const home = f === 0;
      const loopRadius = home ? 12 + 2 * rand() : 18 + 8 * rand();
      const v = rand() < 0.55; // a loose V, or a cluster
      const n = 5 + Math.floor(rand() * 5);
      return {
        start,
        axis,
        rate: (speed / R) * (rand() < 0.5 ? -1 : 1),
        swing: unitVector(),
        swingRate: ((Math.PI * 2) / (600 + 600 * rand())) * (rand() < 0.5 ? -1 : 1),
        meander: [6 + 8 * rand(), (Math.PI * 2) / (28 + 22 * rand()), rand() * Math.PI * 2],
        // (the cottage loop's nearest pass stays 8 m clear of the chimney)
        loop: home ? { centre: travel(L.cottage, L.homeBearing, -22 / R, new Vector3()), radius: loopRadius, rate: speed / loopRadius } : f === 1 ? { centre: marsh.clone(), radius: loopRadius, rate: -speed / loopRadius } : null,
        height: home ? FLIGHT.height[0] - 1 : FLIGHT.height[0] + (FLIGHT.height[1] - FLIGHT.height[0]) * rand(),
        swell: [0.3 + 0.4 * rand(), (Math.PI * 2) / (18 + 14 * rand()), rand() * Math.PI * 2],
        birds: Array.from({ length: n }, (_, k): Bird => {
          const rank = Math.ceil(k / 2);
          const side = k === 0 ? 0 : k % 2 === 1 ? 1 : -1;
          const beat = 2.7 + 0.4 * rand();
          return {
            ahead: v ? -1.3 * rank + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 5,
            side: v ? side * 1.5 * rank + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 5,
            up: v ? 0.12 * rank + (rand() - 0.5) * 0.3 : (rand() - 0.5) * 1.2,
            phase: [rand() * 6.28, rand() * 6.28, rand() * 6.28],
            beat,
            beatPhase: rand() * Math.PI * 2,
            glide: (Math.PI * 2) / (7 + 6 * rand()),
            span: (0.88 + 0.3 * rand()) * HALF_SPAN,
          };
        }),
      };
    });
    this.layoutSeed = L.seed;
    this.flockCount = count;
    this.flockR = R;
  }

  /** Where a flock's centre is at time t (unit direction, planet space). */
  private route(f: Flock, t: number, R: number, out: Vector3): Vector3 {
    if (f.loop) {
      // a wide loop behind the cottage, leaning a little out of round
      const a = f.loop.rate * t;
      const r = f.loop.radius * (1 + 0.12 * Math.sin(2 * a + f.meander[2]));
      tangentToward(f.loop.centre, f.start, this.e1);
      this.e2.crossVectors(f.loop.centre, this.e1);
      this.dir.copy(this.e1).multiplyScalar(Math.cos(a)).addScaledVector(this.e2, Math.sin(a));
      return travel(f.loop.centre, this.dir, r / R, out);
    }
    out.copy(f.start).applyAxisAngle(f.axis, f.rate * t).applyAxisAngle(f.swing, f.swingRate * t);
    // the meander: aside from the great circle, along the axis it turns about
    this.e1.copy(f.axis).applyAxisAngle(f.swing, f.swingRate * t);
    this.e1.addScaledVector(out, -this.e1.dot(out)).normalize();
    return travel(out, this.e1, (f.meander[0] * Math.sin(f.meander[1] * t + f.meander[2])) / R, out);
  }

  /** Fly every bird to where it is at `time` (s). */
  update(time: number, terrain: Terrain): void {
    const R = terrain.radius;
    const count = Math.max(3, Math.round((FLOCKS * R) / 128));
    if (terrain.layout.seed !== this.layoutSeed || count !== this.flockCount || R !== this.flockR) this.build(terrain, count);
    const pos = this.pos.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const wing = this.wing.array as Float32Array;
    const top = FLIGHT.hilltops * terrain.maxHeight;
    const cottage = terrain.layout.cottage;
    const dt = 0.25;
    let n = 0;
    for (const f of this.flocks) {
      // heading and turn from the route a moment either side
      this.route(f, time - dt, R, this.a);
      this.route(f, time, R, this.centre);
      this.route(f, time + dt, R, this.b);
      this.ahead.subVectors(this.b, this.a);
      this.ahead.addScaledVector(this.centre, -this.ahead.dot(this.centre)).normalize();
      this.side.crossVectors(this.centre, this.ahead);
      const back = this.p.subVectors(this.centre, this.a).normalize();
      const fore = this.fwd.subVectors(this.b, this.centre).normalize();
      // coordinated turn: tan(bank) = v·ω / g, drawn a little steeper so it reads
      const turn = Math.asin(clamp(this.q.crossVectors(back, fore).dot(this.centre), -1, 1)) / dt;
      const speed = (this.b.distanceTo(this.a) * R) / (2 * dt);
      const bank = clamp(Math.atan((speed * turn) / 9.81) * 2.2, -0.6, 0.6);
      // level flight over the highest ground, rising over the cottage
      const near = smoothstep(FLIGHT.cottageRadius, FLIGHT.cottageRadius * 0.4, Math.acos(clamp(this.centre.dot(cottage), -1, 1)) * R);
      const lift = R + top + f.height + FLIGHT.cottage * near + f.swell[0] * Math.sin(f.swell[1] * time + f.swell[2]);
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        // a slight drift in place
        const wa = b.ahead + 0.25 * Math.sin(time * 0.31 + b.phase[0]);
        const ws = b.side + 0.25 * Math.sin(time * 0.27 + b.phase[1]);
        const wu = b.up + 0.12 * Math.sin(time * 0.43 + b.phase[2]);
        this.p.copy(this.centre).multiplyScalar(lift + wu).addScaledVector(this.ahead, wa).addScaledVector(this.side, ws);
        const up = this.p.length();
        this.fwd.copy(this.ahead).addScaledVector(this.p, -this.ahead.dot(this.p) / (up * up)).normalize();
        // steady beats, now and then a short glide with the wings held a little raised
        const flap = smoothstep(-0.85, -0.55, Math.sin(time * b.glide + b.phase[2]));
        pos.set([this.p.x, this.p.y, this.p.z], n * 3);
        frame.set([this.fwd.x, this.fwd.y, this.fwd.z, bank], n * 4);
        wing.set([(time * b.beat + b.beatPhase / (Math.PI * 2)) * Math.PI * 2, 0.62 * flap, 0.16 - 0.1 * flap, b.span / HALF_SPAN], n * 4);
        n++;
      }
    }
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.shadowMesh.geometry.instanceCount = n;
    this.pos.needsUpdate = true;
    this.frame.needsUpdate = true;
    this.wing.needsUpdate = true;
  }
}
