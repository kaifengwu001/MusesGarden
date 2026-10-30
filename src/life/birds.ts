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
// cross painted fields. Each flock flies a loose figure of eight about its
// home a few meters up: one over the cottage's pond, a few over the
// wetlands, and one about a point a little ahead of wherever you are looking,
// so there are usually birds in view. Its birds keep loose places in it, each with its own wobble,
// bank into the turns and beat their wings in bursts between glides. Every
// pose is a closed-form function of time, so a frozen frame is a pure
// function of state. Each bird drops a small disc into the clouds' sun-space
// shadow map, so its shadow falls on the meadow as theirs do.

const MAX_BIRDS = 96;
/** Flocks on an R = 128 m planet; more as it grows (with √R). */
const FLOCKS = 4;
/** Half wingspan (m) of the bird mesh below. */
const HALF_SPAN = 0.48;

interface Bird {
  /** Place in the flock (m): ahead, to the side, up. */
  ahead: number;
  side: number;
  up: number;
  /** Wobble phases, wingbeat frequency (Hz), burst rhythm (rad/s), half wingspan (m). */
  phase: [number, number, number, number];
  beat: number;
  burst: number;
  span: number;
}

interface Flock {
  home: Vector3;
  /** Tangent frame at home. */
  e1: Vector3;
  e2: Vector3;
  /** Figure-of-eight half extents (m), period (s), phase, height above the ground (m). */
  ax: number;
  ay: number;
  period: number;
  phase: number;
  height: number;
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
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3);
  private readonly frame = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly wing = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly centre = new Vector3();
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

  /** Flocks for a world: homes over the cottage's pond and the wettest of a few spots each. */
  private build(terrain: Terrain, count: number): void {
    const L = terrain.layout;
    const R = terrain.radius;
    const rand = rng(L.seed ^ 0xb12d5);
    const homes: Vector3[] = [travel(L.cottage, L.homeBearing, terrain.pondCentre / R, new Vector3())];
    const d = new Vector3();
    // (the last flock's home follows the view: set every frame in update)
    while (homes.length < count + 1) {
      let best = new Vector3(0, 1, 0);
      let wettest = -Infinity;
      for (let k = 0; k < 10; k++) {
        const z = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - z * z);
        d.set(s * Math.cos(a), s * Math.sin(a), z);
        // wet, and away from the other flocks
        const score = terrain.fields.wetness(d) - 0.6 * Math.max(...homes.map((h) => h.dot(d)));
        if (score > wettest) {
          wettest = score;
          best = d.clone();
        }
      }
      homes.push(best);
    }
    this.flocks = homes.map((home, f): Flock => {
      const e1 = tangentToward(home, Math.abs(home.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), new Vector3()).applyAxisAngle(home, rand() * Math.PI * 2);
      const n = 5 + Math.floor(rand() * 7);
      // the flock that keeps you company stays in a tighter loop, low over the meadow
      const company = f === count;
      return {
        home,
        e1,
        e2: new Vector3().crossVectors(home, e1),
        ax: company ? 9 + 3 * rand() : 18 + 12 * rand(),
        ay: company ? 5 + 2 * rand() : 11 + 9 * rand(),
        period: 34 + 20 * rand(),
        phase: rand() * Math.PI * 2,
        // the cottage flock clears its chimney
        height: f === 0 ? 6.2 + rand() : company ? 2.6 + rand() : 3.2 + 2.5 * rand(),
        birds: Array.from({ length: n }, (): Bird => ({
          ahead: (rand() - 0.5) * 6,
          side: (rand() - 0.5) * 6,
          up: (rand() - 0.5) * 1.4,
          phase: [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28],
          beat: 2.6 + 1.1 * rand(),
          burst: 0.35 + 0.3 * rand(),
          span: (0.85 + 0.35 * rand()) * HALF_SPAN,
        })),
      };
    });
    this.layoutSeed = L.seed;
    this.flockCount = count;
  }

  /** Fly every bird to where it is at `time` (s); `focus` and `forward` place the flock that keeps you company. */
  update(time: number, terrain: Terrain, focus: Vector3, forward: Vector3): void {
    const R = terrain.radius;
    const count = Math.max(2, Math.round(FLOCKS * Math.sqrt(R / 128)));
    if (terrain.layout.seed !== this.layoutSeed || count !== this.flockCount) this.build(terrain, count);
    const company = this.flocks[this.flocks.length - 1];
    travel(focus, forward, 24 / R, company.home);
    tangentToward(company.home, forward, company.e1);
    company.e2.crossVectors(company.home, company.e1);
    const pos = this.pos.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const wing = this.wing.array as Float32Array;
    let n = 0;
    for (const f of this.flocks) {
      // the figure of eight in the home's tangent plane, and its heading and turn
      const tau = (time / f.period) * Math.PI * 2 + f.phase;
      const w = (Math.PI * 2) / f.period;
      const x = f.ax * Math.sin(tau);
      const y = f.ay * Math.sin(2 * tau);
      const vx = f.ax * Math.cos(tau) * w;
      const vy = 2 * f.ay * Math.cos(2 * tau) * w;
      const axx = -f.ax * Math.sin(tau) * w * w;
      const ayy = -4 * f.ay * Math.sin(2 * tau) * w * w;
      const speed2 = vx * vx + vy * vy;
      const bank = clamp(((vx * ayy - vy * axx) / Math.max(speed2, 1e-6)) * 1.4, -0.65, 0.65);
      this.centre.copy(f.home).addScaledVector(f.e1, x / R).addScaledVector(f.e2, y / R).normalize();
      this.ahead.copy(f.e1).multiplyScalar(vx).addScaledVector(f.e2, vy);
      this.ahead.addScaledVector(this.centre, -this.ahead.dot(this.centre)).normalize();
      this.side.crossVectors(this.centre, this.ahead);
      const ground = Math.max(terrain.height0(this.centre), 0);
      const lift = R + ground + f.height + 0.8 * Math.sin(tau * 1.7 + f.phase);
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        const wa = b.ahead + 0.6 * Math.sin(time * 0.53 + b.phase[0]);
        const ws = b.side + 0.7 * Math.sin(time * 0.41 + b.phase[1]);
        const wu = b.up + 0.3 * Math.sin(time * 0.87 + b.phase[2]);
        this.p.copy(this.centre).multiplyScalar(lift + wu).addScaledVector(this.ahead, wa).addScaledVector(this.side, ws);
        // heading: the flock's, turned a little by the wobble across
        this.fwd.copy(this.ahead).addScaledVector(this.side, 0.12 * Math.cos(time * 0.41 + b.phase[1]));
        const up = this.p.length();
        this.fwd.addScaledVector(this.p, -this.fwd.dot(this.p) / (up * up)).normalize();
        // wingbeats in bursts, glides between
        const flap = smoothstep(-0.25, 0.35, Math.sin(time * b.burst + b.phase[3]));
        pos.set([this.p.x, this.p.y, this.p.z], n * 3);
        frame.set([this.fwd.x, this.fwd.y, this.fwd.z, bank + 0.15 * Math.sin(time * 0.9 + b.phase[2])], n * 4);
        wing.set([(time * b.beat + b.phase[3]) * Math.PI * 2, 0.78 * flap, 0.2 - 0.12 * flap, b.span / HALF_SPAN], n * 4);
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
