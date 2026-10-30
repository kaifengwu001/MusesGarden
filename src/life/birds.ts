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

// Small flocks of white birds over the meadow, like the egrets and doves that
// cross painted fields. Most flocks travel: each follows a great circle round
// the planet at eight or nine meters a second, the circle swinging slowly
// about another axis so the route meanders and, lap after lap, crosses the
// whole meadow (one route runs over the cottage). One flock stays home,
// circling the cottage's pond in a wide, lazy loop. A flock keeps a loose V
// or cluster that drifts slowly; its birds bank into the turns, beat their
// wings steadily with the odd glide, and lift over the cottage. Every pose
// is a closed-form function of time, so a frozen frame is a pure function of
// state, and everything is tied to the planet, never to the view. Each bird
// drops a small disc into the clouds' sun-space shadow map, so its shadow
// falls on the meadow as theirs do.

const MAX_BIRDS = 160;
/** Travelling flocks on an R = 128 m planet; more as it grows (∝ R^0.75), so they pass as often. */
const ROUTES = 5;
const MAX_ROUTES = 14;
/** Half wingspan (m) of the bird mesh below. */
const HALF_SPAN = 0.48;
/** Time step (s) of the finite differences that give a flock its heading and turn. */
const DT = 0.12;
/** Gravity (m/s²), for the bank of a turn. */
const G = 9.8;

interface Bird {
  /** Place in the flock (m): ahead, to the side, up. */
  ahead: number;
  side: number;
  up: number;
  /** Drift phases, wingbeat phase, glide phase. */
  phase: [number, number, number, number];
  /** Wingbeats per second, and how often it glides (rad/s). */
  beat: number;
  glide: number;
  /** Size (× the mesh). */
  size: number;
}

interface Flock {
  /** A travelling flock: its great circle (e1 → e2), the axis it swings about, swing amplitude (rad), period (s) and phase. */
  route: boolean;
  e1: Vector3;
  e2: Vector3;
  swing: Vector3;
  swingAmp: number;
  swingPeriod: number;
  /** Speed (m/s), phase (rad), height above the ground (m). */
  speed: number;
  phase: number;
  height: number;
  /** The home flock: the loop's centre (unit) and half extents (m). */
  centre: Vector3;
  ax: number;
  ay: number;
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
  private routeCount = 0;
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3);
  private readonly frame = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly wing = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly centre = new Vector3();
  private readonly next = new Vector3();
  private readonly prev = new Vector3();
  private readonly ahead = new Vector3();
  private readonly side = new Vector3();
  private readonly p = new Vector3();
  private readonly fwd = new Vector3();

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
        uniforms: { uCloudSunA: shared.uCloudSunA, uCloudSunB: shared.uCloudSunB },
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.shadowMesh.frustumCulled = false;
  }

  /** The flocks for a world: one at home over the cottage's pond, the others on routes round the planet. */
  private build(terrain: Terrain, routes: number): void {
    const L = terrain.layout;
    const R = terrain.radius;
    const rand = rng(L.seed ^ 0xb12d5);
    const birds = (count: number, v: boolean): Bird[] =>
      Array.from({ length: count }, (_, k): Bird => {
        // a loose V (the leader first, the others back along two arms) or a cluster
        const arm = k === 0 ? 0 : k % 2 === 0 ? 1 : -1;
        const rank = Math.ceil(k / 2);
        return {
          ahead: v ? -rank * (1.1 + 0.3 * rand()) : (rand() - 0.5) * 4.5,
          side: v ? arm * rank * (1.0 + 0.35 * rand()) : (rand() - 0.5) * 4.5,
          up: (rand() - 0.5) * 0.8,
          phase: [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28],
          beat: 2.7 + 0.8 * rand(),
          glide: 0.22 + 0.16 * rand(),
          size: 0.85 + 0.3 * rand(),
        };
      });
    const flocks: Flock[] = [];
    // at home: a wide loop round the pond, high enough to clear the chimney
    const pond = travel(L.cottage, L.homeBearing, terrain.pondCentre / R, new Vector3());
    const e1 = L.homeBearing.clone();
    flocks.push({
      route: false,
      e1,
      e2: new Vector3().crossVectors(pond, e1).normalize(),
      swing: new Vector3(),
      swingAmp: 0.25,
      swingPeriod: 70 + 30 * rand(),
      speed: 6 + rand(),
      phase: rand() * Math.PI * 2,
      height: 7.5 + rand(),
      centre: pond,
      ax: 24 + 6 * rand(),
      ay: 14 + 4 * rand(),
      birds: birds(5 + Math.floor(rand() * 4), false),
    });
    for (let f = 0; f < routes; f++) {
      // the first route runs over the cottage; the others anywhere
      let a = L.cottage.clone();
      if (f > 0) {
        const z = rand() * 2 - 1;
        const t = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        a = new Vector3(r * Math.cos(t), r * Math.sin(t), z);
      }
      const b = tangentToward(a, new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), new Vector3());
      const swing = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      flocks.push({
        route: true,
        e1: a,
        e2: b,
        swing,
        swingAmp: 0.25 + 0.2 * rand(),
        swingPeriod: 80 + 60 * rand(),
        speed: 7.5 + 2.5 * rand(),
        phase: rand() * Math.PI * 2,
        height: 4 + 5 * rand(),
        centre: new Vector3(),
        ax: 0,
        ay: 0,
        birds: birds(4 + Math.floor(rand() * 6), rand() < 0.6),
      });
    }
    this.flocks = flocks;
    this.layoutSeed = L.seed;
    this.routeCount = routes;
  }

  /** Where a flock is at time t (unit direction). */
  private flockAt(f: Flock, t: number, radius: number, out: Vector3): Vector3 {
    const swing = f.swingAmp * Math.sin((2 * Math.PI * t) / f.swingPeriod + f.phase * 1.7);
    if (f.route) {
      const phi = f.phase + (f.speed * t) / (radius + f.height);
      out.copy(f.e1).multiplyScalar(Math.cos(phi)).addScaledVector(f.e2, Math.sin(phi));
      return out.applyAxisAngle(f.swing, swing).normalize();
    }
    // the home loop: an ellipse whose axes turn a little with the swing
    const perimeter = Math.PI * (3 * (f.ax + f.ay) - Math.sqrt((3 * f.ax + f.ay) * (f.ax + 3 * f.ay)));
    const tau = f.phase + (2 * Math.PI * f.speed * t) / perimeter;
    const c = Math.cos(swing);
    const sn = Math.sin(swing);
    const x = f.ax * Math.cos(tau);
    const y = f.ay * Math.sin(tau);
    return out
      .copy(f.centre)
      .addScaledVector(f.e1, (c * x - sn * y) / radius)
      .addScaledVector(f.e2, (sn * x + c * y) / radius)
      .normalize();
  }

  /** Fly every bird to where it is at `time` (s). */
  update(time: number, terrain: Terrain): void {
    const R = terrain.radius;
    const routes = clamp(Math.round(ROUTES * Math.pow(R / 128, 0.75)), 3, MAX_ROUTES);
    if (terrain.layout.seed !== this.layoutSeed || routes !== this.routeCount) this.build(terrain, routes);
    const cottage = terrain.layout.cottage;
    const pos = this.pos.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const wing = this.wing.array as Float32Array;
    let n = 0;
    for (const f of this.flocks) {
      // heading and turn from the path a moment before and after
      this.flockAt(f, time, R, this.centre);
      this.flockAt(f, time + DT, R, this.next);
      this.flockAt(f, time - DT, R, this.prev);
      this.ahead.subVectors(this.next, this.prev);
      this.ahead.addScaledVector(this.centre, -this.ahead.dot(this.centre)).normalize();
      this.side.crossVectors(this.centre, this.ahead);
      // sideways acceleration (m/s²) → the bank of a coordinated turn
      const lateral = this.p.copy(this.next).add(this.prev).addScaledVector(this.centre, -2).dot(this.side) * (R / (DT * DT));
      const bank = clamp(Math.atan(lateral / G) * 1.5, -0.7, 0.7);
      // a few meters over the meadow, rising over the cottage
      const ground = Math.max(terrain.height0(this.centre), 0);
      const nearHome = smoothstep(32 / R, 10 / R, this.centre.distanceTo(cottage));
      const lift = R + ground + f.height + 6 * nearHome * (f.route ? 1 : 0) + 0.6 * Math.sin(time * 0.55 + f.phase);
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        // places in the flock drift a little, slowly
        const wa = b.ahead + 0.3 * Math.sin(time * 0.31 + b.phase[0]);
        const ws = b.side + 0.3 * Math.sin(time * 0.23 + b.phase[1]);
        const wu = b.up + 0.18 * Math.sin(time * 0.37 + b.phase[2]);
        this.p.copy(this.centre).multiplyScalar(lift + wu).addScaledVector(this.ahead, wa).addScaledVector(this.side, ws);
        this.fwd.copy(this.ahead).addScaledVector(this.side, 0.04 * Math.cos(time * 0.23 + b.phase[1]));
        const up = this.p.length();
        this.fwd.addScaledVector(this.p, -this.fwd.dot(this.p) / (up * up)).normalize();
        // steady wingbeats, now and then a short glide on raised wings
        const flap = 1 - smoothstep(0.6, 0.85, Math.sin(time * b.glide + b.phase[3]));
        pos.set([this.p.x, this.p.y, this.p.z], n * 3);
        frame.set([this.fwd.x, this.fwd.y, this.fwd.z, bank + 0.04 * Math.sin(time * 0.5 + b.phase[2])], n * 4);
        wing.set([(time * b.beat + b.phase[3]) * Math.PI * 2, 0.62 * flap, 0.16 - 0.08 * flap, b.size], n * 4);
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
