import { Vector3 } from 'three';
import { hash32 } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { tangentToward, travel } from '../../../src/planet/geo';
import { Answers, rampIntegral } from '../../../src/life/museLife';
import { PLOP, RISE, STEP } from '../../../src/life/museRig';
import { RELIEF_OCTAVES } from '../planet/fields';
import { createGroundSample, type Terrain } from '../planet/terrain';
import type { Roaming } from './museRoam';

export interface ResidentIdentity {
  readonly id: string;
  name: string;
  readonly coat: string;
  readonly role: string;
}

/** Local inhabitants, independent of the account's relationship or presence data. */
export const DEFAULT_RESIDENTS: readonly ResidentIdentity[] = [
  { id: 'pip', name: 'Pip', coat: '#ffe1ce', role: 'Sail gardener' },
  { id: 'juniper', name: 'Juniper', coat: '#d7f1dd', role: 'Canyon listener' },
  { id: 'marlo', name: 'Marlo', coat: '#dce7ff', role: 'Cloud watcher' },
];
export const RESIDENT_STORAGE_KEY = 'muses-garden.scarlet-sail-canyon.residents.v1';
export type ResidentStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function residentName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const name = Array.from(value).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim();
  const shortened = Array.from(name).slice(0, 24).join('');
  return shortened || fallback;
}

export function loadResidents(storage?: ResidentStorage): ResidentIdentity[] {
  let saved: unknown;
  try { saved = JSON.parse(storage?.getItem(RESIDENT_STORAGE_KEY) ?? 'null'); } catch { saved = null; }
  return DEFAULT_RESIDENTS.map((original) => {
    const row: unknown = Array.isArray(saved) ? saved.find((entry: unknown) => typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === original.id) : null;
    return { ...original, name: residentName(row && typeof row === 'object' && 'name' in row ? row.name : null, original.name) };
  });
}

/** The three gardens occupy disjoint lanes, in the open clearing before the shelter. */
const HOMES = [{ x: -7.2, z: 12 }, { x: 0, z: 17 }, { x: 7.2, z: 12 }] as const;
const POINTS = 24;
const RAMP = 0.12;
const H = 1.65;

/** Convert the shelter's local metre coordinates to the planet, matching cottageLocal. */
export function residentDirection(terrain: Terrain, x: number, z: number, out = new Vector3()): Vector3 {
  const up = terrain.layout.cottage;
  const side = new Vector3().crossVectors(up, terrain.layout.homeBearing).normalize();
  const d = Math.hypot(x, z);
  if (d < 1e-6) return out.copy(up);
  side.multiplyScalar(x / d).addScaledVector(terrain.layout.homeBearing, z / d);
  return travel(up, side, Math.asin(Math.min(d / terrain.radius, 0.95)), out);
}

/** No rendering/browser dependencies: a resident's deterministic safe walk and responses. */
export class ResidentLife {
  readonly living: Roaming = {
    dir: new Vector3(), height: 0, heading: new Vector3(), home: true, lookAt: null,
    action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 1, moves: [] },
    cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
  };
  activity = 'Settling in';
  private answers = new Answers();
  private terrain: Terrain | null = null;
  private seed = -1;
  private radius = -1;
  private readonly fieldShape = new Float64Array(RELIEF_OCTAVES * 2 + 2).fill(Number.NaN);
  private points: Vector3[] = [];
  private distances: number[] = [];
  private tangents: Vector3[] = [];
  private length = 0;
  private shift = 0;
  private lastTime = -Infinity;
  private readonly ground = createGroundSample();
  private readonly toCamera = new Vector3();
  private readonly scratch = new Vector3();

  constructor(readonly index: number) {
    if (index < 0 || index >= HOMES.length) throw new Error('Unknown canyon resident lane.');
  }

  /** Verify every 20 cm, including dry clearance and the slope between samples. */
  private clear(terrain: Terrain, from: Vector3, to: Vector3): boolean {
    const length = from.angleTo(to) * terrain.radius;
    const steps = Math.max(1, Math.ceil(length / 0.2));
    let previous = 0;
    for (let i = 0; i <= steps; i++) {
      this.scratch.copy(from).lerp(to, i / steps).normalize();
      const g = terrain.sample(this.scratch, this.ground);
      if (g.water < 1 || !Number.isFinite(g.height)) return false;
      if (i && Math.abs(g.height - previous) > (length / steps) * 0.48 + 0.015) return false;
      previous = g.height;
    }
    return true;
  }

  private rebuild(terrain: Terrain): void {
    this.terrain = terrain;
    this.seed = terrain.layout.seed;
    this.radius = terrain.radius;
    const home = HOMES[this.index];
    const turn = (hash32(this.seed + this.index * 7919) / 0xffffffff) * Math.PI * 2;
    const centre = residentDirection(terrain, home.x, home.z);
    this.points = [centre, centre.clone()];
    // Shrink inside the resident's own lane if a changed seed makes a slope steep.
    for (const scale of [1, 0.75, 0.5, 0.25]) {
      const points = Array.from({ length: POINTS + 1 }, (_, k) => {
        const a = turn + (k / POINTS) * Math.PI * 2;
        return residentDirection(terrain, home.x + 2.25 * scale * Math.cos(a), home.z + 1.8 * scale * Math.sin(a));
      });
      if (points.slice(1).every((p, i) => this.clear(terrain, points[i], p))) {
        this.points = points;
        break;
      }
    }
    // Even on an edited terrain with no safe loop, remain grounded at the safest
    // dry point in this lane instead of walking through a cliff or a water body.
    if (this.points.length === 2 && !this.clear(terrain, centre, centre)) {
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const p = residentDirection(terrain, home.x + Math.cos(a) * 2.2, home.z + Math.sin(a) * 1.8);
        if (this.clear(terrain, p, p)) { this.points = [p, p.clone()]; break; }
      }
    }
    this.distances = [0];
    this.length = 0;
    for (let k = 1; k < this.points.length; k++) {
      this.length += this.points[k - 1].angleTo(this.points[k]) * terrain.radius;
      this.distances.push(this.length);
    }
    const n = this.points.length - 1;
    this.tangents = this.points.map((point, k) => {
      if (n < 2) return tangentToward(point, terrain.layout.cottage, new Vector3());
      const tangent = this.points[(k + 1) % n].clone().sub(this.points[(k + n - 1) % n]);
      return tangent.addScaledVector(point, -tangent.dot(point)).normalize();
    });
    this.shift = (hash32(this.seed + this.index * 104729 + 19) / 0xffffffff) * 25;
  }

  tap(time: number): void { this.answers.tap(time, false); }
  hold(time: number, side: number): void { this.answers.hold(time, side, false); }
  letGo(time: number): void { this.answers.letGo(time, false); }

  /** A flat home point can hide a change to the slopes elsewhere on a loop. */
  private shapeChanged(terrain: Terrain): boolean {
    const fields = terrain.fields;
    let changed = false;
    for (let i = 0; i < this.fieldShape.length; i++) {
      const value = i < RELIEF_OCTAVES ? fields.relief[i]
        : i < RELIEF_OCTAVES * 2 ? fields.hummock[i - RELIEF_OCTAVES]
          : i === RELIEF_OCTAVES * 2 ? fields.grainK : fields.lift;
      if (this.fieldShape[i] !== value) changed = true;
      this.fieldShape[i] = value;
    }
    return changed;
  }

  at(time: number, terrain: Terrain, camera: Vector3): Roaming {
    const shapeChanged = this.shapeChanged(terrain);
    if (this.terrain !== terrain || this.seed !== terrain.layout.seed || this.radius !== terrain.radius || shapeChanged) {
      this.rebuild(terrain);
    }
    if (time < this.lastTime) this.answers = new Answers();
    this.lastTime = time;
    const pace = 0.43 + this.index * 0.025;
    const walkTime = Math.max(1, this.length / (pace * (1 - RAMP)));
    const restTime = 16 + this.index * 3;
    const cycle = walkTime + restTime;
    const elapsed = Math.max(0, time + this.shift - this.answers.heldBack(time));
    const phase = elapsed % cycle;
    const walking = phase < walkTime && this.length > 0.01;
    const u = Math.min(1, phase / walkTime);
    const distance = Math.min(this.length, (rampIntegral(u, 0, RAMP) - rampIntegral(u, 1 - RAMP, 1)) / (1 - RAMP) * this.length);
    let k = 1;
    while (k < this.distances.length - 1 && this.distances[k] < distance) k++;
    const span = this.distances[k] - this.distances[k - 1];
    const out = this.living;
    const fraction = span ? (distance - this.distances[k - 1]) / span : 0;
    out.dir.copy(this.points[k - 1]).lerp(this.points[k], fraction).normalize();
    out.height = terrain.height(out.dir);
    out.heading.copy(this.tangents[k - 1]).lerp(this.tangents[k], fraction);
    out.heading.addScaledVector(out.dir, -out.heading.dot(out.dir)).normalize();
    const a = out.action;
    a.time = time;
    a.walk = walking ? smoothstep(0, RAMP, u) * smoothstep(0, RAMP, 1 - u) : 0;
    a.stride = 1;
    a.gait = (Math.floor(elapsed / cycle) * this.length + distance) / (2 * STEP.length * H);
    a.wave = -1;
    a.look = 1;
    a.lookYaw = 0.22 * Math.sin(time * 0.4 + this.index);
    a.lookPitch = -0.03 + 0.06 * Math.sin(time * 0.3);
    a.moves.length = 0;
    out.lookAt = null;
    out.cues.petted = -1;
    out.cues.hum = 0;
    this.activity = walking ? ['Tending the sails', 'Exploring the clearing', 'Watching the cloud ribbons'][this.index] : 'Resting in the shade';
    if (!walking && this.length > 0.01) {
      const t = Math.max(0, phase - walkTime);
      if (t < PLOP) a.moves.push({ kind: 'plop', time: t, amount: 1 });
      else if (t > restTime - RISE) a.moves.push({ kind: 'rise', time: t - (restTime - RISE), amount: 1 });
      else a.moves.push({ kind: 'sit', time: t - PLOP, amount: 1 });
    }
    const attention = this.answers.attending(time);
    if (attention > 0) {
      tangentToward(out.dir, camera, this.toCamera);
      out.heading.lerp(this.toCamera, attention).normalize();
      a.walk *= 1 - attention;
      a.stride *= 1 - attention;
      this.activity = 'Saying hello';
    }
    this.answers.settle(time);
    if (this.answers.apply(time, a, out.cues)) {
      out.lookAt = camera;
      a.lookYaw = 0;
      a.lookPitch = 0.08;
      if (out.cues.petted >= 0) this.activity = 'Enjoying a little affection';
    }
    return out;
  }
}
