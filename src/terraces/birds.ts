import { DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, ShaderMaterial, Vector3, type InstancedBufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { birdGeometry, HALF_SPAN, MAX_BIRDS, WINGBEAT, type Bird } from '../life/birds';
import fragmentShader from '../life/grass.frag.glsl?raw';
import vertexShader from '../life/bird.vert.glsl?raw';
import { travel } from '../planet/geo';
import { gradientFrame } from './fields';
import { createTerraceSample, type TerraceTerrain } from './terrain';

// White flocks circling between the valleys (Kai's brief; the egrets over the
// fields in the ink painting). Every flock belongs to the planet: each wheels
// round a point over a valley floor, between the hills and the peaks, its
// loop leaning out of round and drifting slowly about, some meters to a
// dozen and more over the floor, so from the terraces you see them against
// the hills and the peaks, and from above against the fields. Loose V's and
// clusters, the slow deep beats and long glides of the meadow's birds
// (life/birds.ts, whose mesh and shader they share), banking into the turn.
// Every pose is a closed-form function of time.

const FLOCKS = { count: 7, apart: 70, radius: [14, 32], height: [7, 17], speed: [4.0, 5.2], drift: [6, 14] } as const;

interface Flock {
  readonly centre: Vector3;
  readonly floor: number;
  readonly radius: number;
  /** Angular rate round the loop (rad/s, signed), how far out of round it leans, its phase. */
  readonly rate: number;
  readonly lean: number;
  readonly phase: number;
  /** The loop's slow drift about its centre: how far (m), how fast (rad/s), its phase. */
  readonly drift: [number, number, number];
  /** Height over the floor (m) and its slow swell (m, rad/s, phase). */
  readonly height: number;
  readonly swell: [number, number, number];
  readonly birds: Bird[];
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

export class TerraceBirds {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  count = 0;
  private flocks: Flock[] = [];
  private builtFor = '';
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3);
  private readonly frame = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly wing = new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly ahead = new Vector3();
  private readonly side = new Vector3();
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly fwd = new Vector3();
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly t = new Vector3();

  constructor(shared: Record<string, IUniform>) {
    for (const attr of [this.pos, this.frame, this.wing]) attr.setUsage(DynamicDrawUsage);
    const g = birdGeometry();
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aFrame', this.frame);
    g.setAttribute('aWing', this.wing);
    g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'terraces birds', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** The flocks for a planet at its size: over valley floors, far apart, each its own loop and formation. */
  private build(terrain: TerraceTerrain): void {
    const R = terrain.radius;
    const rand = rng(terrain.layout.noiseSeed ^ 0x51ab1e);
    const s = createTerraceSample();
    const golden = Math.PI * (3 - Math.sqrt(5));
    const n = 1600;
    const centres: Array<{ dir: Vector3; floor: number }> = [];
    const d = new Vector3();
    for (let i = 0; i < n && centres.length < FLOCKS.count; i++) {
      // a scrambled order, so the flocks are spread round the planet whatever the count
      const k = (i * 997) % n;
      const z = 1 - (2 * (k + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      d.set(r * Math.cos(golden * k), r * Math.sin(golden * k), z);
      terrain.terraceAt(d, s);
      if (s.natural > 2.5 || s.slope > 0.2) continue;
      if (centres.some((o) => o.dir.distanceTo(d) * R < FLOCKS.apart)) continue;
      centres.push({ dir: d.clone(), floor: s.height });
    }
    this.flocks = centres.map((c): Flock => {
      const radius = FLOCKS.radius[0] + (FLOCKS.radius[1] - FLOCKS.radius[0]) * rand();
      const speed = FLOCKS.speed[0] + (FLOCKS.speed[1] - FLOCKS.speed[0]) * rand();
      const v = rand() < 0.5;
      const count = 5 + Math.floor(rand() * 6);
      return {
        centre: c.dir,
        floor: c.floor,
        radius,
        rate: (speed / radius) * (rand() < 0.5 ? -1 : 1),
        lean: 0.08 + 0.14 * rand(),
        phase: rand() * Math.PI * 2,
        drift: [FLOCKS.drift[0] + (FLOCKS.drift[1] - FLOCKS.drift[0]) * rand(), (Math.PI * 2) / (90 + 90 * rand()), rand() * Math.PI * 2],
        height: FLOCKS.height[0] + (FLOCKS.height[1] - FLOCKS.height[0]) * rand(),
        swell: [0.4 + 0.6 * rand(), (Math.PI * 2) / (16 + 12 * rand()), rand() * Math.PI * 2],
        birds: Array.from({ length: count }, (_, k): Bird => {
          const rank = Math.ceil(k / 2);
          const sideOf = k === 0 ? 0 : k % 2 === 1 ? 1 : -1;
          return {
            ahead: v ? -1.3 * rank + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 5,
            side: v ? sideOf * 1.5 * rank + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 5,
            up: v ? 0.12 * rank + (rand() - 0.5) * 0.3 : (rand() - 0.5) * 1.2,
            phase: [rand() * 6.28, rand() * 6.28, rand() * 6.28],
            beat: WINGBEAT.hz[0] + (WINGBEAT.hz[1] - WINGBEAT.hz[0]) * rand(),
            beatPhase: rand() * Math.PI * 2,
            glide: (Math.PI * 2) / (WINGBEAT.cycle[0] + (WINGBEAT.cycle[1] - WINGBEAT.cycle[0]) * rand()),
            span: (0.88 + 0.3 * rand()) * HALF_SPAN,
          };
        }),
      };
    });
  }

  /** Where a flock's centre is at time t (unit direction): round its loop, the loop drifting about its centre. */
  private route(f: Flock, time: number, R: number, out: Vector3): Vector3 {
    gradientFrame(f.centre, this.e1, this.e2);
    const w = f.drift[1] * time + f.drift[2];
    this.t.copy(this.e1).multiplyScalar(Math.cos(w)).addScaledVector(this.e2, Math.sin(w));
    travel(f.centre, this.t, f.drift[0] / R, this.c);
    gradientFrame(this.c, this.e1, this.e2);
    const a = f.rate * time + f.phase;
    const r = f.radius * (1 + f.lean * Math.sin(2 * a + f.phase));
    this.t.copy(this.e1).multiplyScalar(Math.cos(a)).addScaledVector(this.e2, Math.sin(a));
    return travel(this.c, this.t, r / R, out);
  }

  update(time: number, terrain: TerraceTerrain): void {
    const R = terrain.radius;
    const key = `${terrain.layout.noiseSeed}/${R.toFixed(2)}`;
    if (key !== this.builtFor) {
      this.build(terrain);
      this.builtFor = key;
    }
    const pos = this.pos.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const wing = this.wing.array as Float32Array;
    const dt = 0.25;
    let n = 0;
    for (const f of this.flocks) {
      // heading and turn from the route a moment either side
      this.route(f, time - dt, R, this.a);
      const centre = this.route(f, time, R, this.q).clone();
      this.route(f, time + dt, R, this.b);
      this.ahead.subVectors(this.b, this.a);
      this.ahead.addScaledVector(centre, -this.ahead.dot(centre)).normalize();
      this.side.crossVectors(centre, this.ahead);
      const back = this.p.subVectors(centre, this.a).normalize();
      const fore = this.fwd.subVectors(this.b, centre).normalize();
      const turn = Math.asin(clamp(this.q.crossVectors(back, fore).dot(centre), -1, 1)) / dt;
      const speed = (this.b.distanceTo(this.a) * R) / (2 * dt);
      const bank = clamp(Math.atan((speed * turn) / 9.81) * 2.2, -0.6, 0.6);
      const lift = R + f.floor + f.height + f.swell[0] * Math.sin(f.swell[1] * time + f.swell[2]);
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        const wa = b.ahead + 0.25 * Math.sin(time * 0.31 + b.phase[0]);
        const ws = b.side + 0.25 * Math.sin(time * 0.27 + b.phase[1]);
        const wu = b.up + 0.12 * Math.sin(time * 0.43 + b.phase[2]);
        this.p.copy(centre).multiplyScalar(lift + wu).addScaledVector(this.ahead, wa).addScaledVector(this.side, ws);
        const up = this.p.length();
        this.fwd.copy(this.ahead).addScaledVector(this.p, -this.ahead.dot(this.p) / (up * up)).normalize();
        // slow, deep beats, and about a third of the time a glide on wings held a little raised
        const glide = smoothstep(WINGBEAT.glide[0], WINGBEAT.glide[1], Math.sin(time * b.glide + b.phase[2]));
        pos.set([this.p.x, this.p.y, this.p.z], n * 3);
        frame.set([this.fwd.x, this.fwd.y, this.fwd.z, bank], n * 4);
        wing.set([(time * b.beat + b.beatPhase / (Math.PI * 2)) * Math.PI * 2, WINGBEAT.swing * glide, 0.16 - 0.1 * glide, b.span / HALF_SPAN], n * 4);
        n++;
      }
    }
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.pos.needsUpdate = true;
    this.frame.needsUpdate = true;
    this.wing.needsUpdate = true;
  }

  /** A flock's loop (its centre and radius in m), for a view of it. */
  loop(k: number): { centre: Vector3; radius: number; floor: number; height: number } | null {
    const f = this.flocks[k];
    return f ? { centre: f.centre, radius: f.radius, floor: f.floor, height: f.height } : null;
  }
}
