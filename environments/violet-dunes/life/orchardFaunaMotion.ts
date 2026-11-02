import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { tangentToward } from '../../../src/planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import type { OrchardFaunaKind } from './orchardFaunaGeometry';

export interface OrchardFaunaAnchor {
  readonly id: string;
  readonly kind: OrchardFaunaKind;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly lift?: number;
  readonly perch?: boolean;
}

export const ORCHARD_FAUNA_ANCHORS: readonly OrchardFaunaAnchor[] = [
  { id: 'skipper-1', kind: 'dune-skipper', x: -4.6, z: 5.6, scale: 1.1 },
  { id: 'skipper-2', kind: 'dune-skipper', x: 5.4, z: 9.8, scale: 0.96 },
  { id: 'skipper-3', kind: 'dune-skipper', x: -8, z: 13, scale: 0.88 },
  { id: 'glider-1', kind: 'seed-glider', x: 2.8, z: 7.5, scale: 1, lift: 1.55, perch: true },
  { id: 'glider-2', kind: 'seed-glider', x: 5.5, z: 6.8, scale: 0.92, lift: 1.8, perch: true },
  { id: 'glider-3', kind: 'seed-glider', x: -8.5, z: -3, scale: 0.9, lift: 2.65 },
  { id: 'glider-4', kind: 'seed-glider', x: 9, z: -5, scale: 0.82, lift: 2.8 },
];

export interface OrchardFaunaPose {
  readonly dir: Vector3;
  readonly heading: Vector3;
  x: number;
  z: number;
  height: number;
  groundHeight: number;
  walking: number;
  gait: number;
  forage: number;
  flap: number;
  perched: number;
}

/** Same home-local metre projection as the shelter and authored plant kit. */
export function orchardDirection(terrain: Terrain, x: number, z: number, out = new Vector3()): Vector3 {
  const L = terrain.layout;
  const across = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
  const forward = new Vector3().crossVectors(across, L.cottage).normalize();
  const d = Math.hypot(x, z);
  if (d < 1e-8) return out.copy(L.cottage);
  const a = Math.asin(Math.min(d / terrain.radius, 0.97));
  return out.copy(L.cottage).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a) * x / d).addScaledVector(forward, Math.sin(a) * z / d).normalize();
}

/** Closed, deterministic little habitat loops; steep ground reduces travel. */
export class OrchardFaunaMotion {
  readonly pose: OrchardFaunaPose = { dir: new Vector3(), heading: new Vector3(), x: 0, z: 0, height: 0, groundHeight: 0, walking: 0, gait: 0, forage: 0, flap: 0, perched: 0 };
  private terrain: Terrain | null = null;
  private radius = -1;
  private seed = -1;
  private range = 0;
  private phase = 0;
  private dirty = true;
  private readonly sample = createGroundSample();
  private readonly scratch = new Vector3();

  constructor(readonly anchor: OrchardFaunaAnchor, readonly index: number) {}
  invalidate(): void { this.dirty = true; }

  private prepare(terrain: Terrain): void {
    this.terrain = terrain;
    this.radius = terrain.radius;
    this.seed = terrain.layout.seed;
    this.phase = unit(hash32(this.seed + this.index * 7919 + 3401)) * 23;
    this.dirty = false;
    if (this.anchor.kind === 'seed-glider') { this.range = 0.8; return; }
    this.range = 0;
    for (const desired of [0.6, 0.36, 0.15]) {
      let previous: number | null = null;
      let safe = true;
      for (let k = 0; k <= 40; k++) {
        const a = k / 40 * Math.PI * 2;
        orchardDirection(terrain, this.anchor.x + Math.cos(a) * desired, this.anchor.z + Math.sin(a) * desired * 0.65, this.scratch);
        const s = terrain.sample(this.scratch, this.sample);
        // Max 0.35m/m local rise: stationary foraging is preferable to stepping through a dune bank.
        if (s.water < 0.7 || !Number.isFinite(s.height) || (previous !== null && Math.abs(s.height - previous) > desired * 0.055)) { safe = false; break; }
        previous = s.height;
      }
      if (safe) { this.range = desired; break; }
    }
  }

  perchDirection(terrain: Terrain, out = new Vector3()): Vector3 {
    if (this.dirty || this.terrain !== terrain || this.radius !== terrain.radius || this.seed !== terrain.layout.seed) this.prepare(terrain);
    return orchardDirection(terrain, this.anchor.x + Math.cos(this.phase) * this.range, this.anchor.z + Math.sin(this.phase) * this.range * 0.65, out);
  }

  at(time: number, terrain: Terrain): OrchardFaunaPose {
    if (this.dirty || this.terrain !== terrain || this.radius !== terrain.radius || this.seed !== terrain.layout.seed) this.prepare(terrain);
    const p = this.pose, flyer = this.anchor.kind === 'seed-glider';
    const cycle = flyer ? 20 : 30;
    const movingTime = flyer && !this.anchor.perch ? cycle : flyer ? 13 : 19;
    const elapsed = Math.max(0, time + this.phase), phase = elapsed % cycle;
    const u = Math.min(1, phase / movingTime), progress = u * u * (3 - 2 * u);
    const angle = progress * Math.PI * 2 + this.phase;
    const move = phase < movingTime ? Math.sin(Math.PI * u) : 0;
    p.x = this.anchor.x + Math.cos(angle) * this.range;
    p.z = this.anchor.z + Math.sin(angle) * this.range * 0.65;
    orchardDirection(terrain, p.x, p.z, p.dir);
    orchardDirection(terrain, p.x - Math.sin(angle), p.z + Math.cos(angle) * 0.65, this.scratch);
    tangentToward(p.dir, this.scratch, p.heading);
    p.groundHeight = terrain.height(p.dir);
    p.height = p.groundHeight;
    p.walking = this.range > 0 ? move : 0;
    p.gait = elapsed * (flyer ? 11 : 5.5);
    const stopped = smoothstep(movingTime - 0.5, movingTime + 0.8, phase) * (1 - smoothstep(cycle - 1, cycle, phase));
    p.forage = flyer ? 0 : stopped * (0.45 + 0.45 * Math.sin((phase - movingTime) * 2.1));
    p.perched = flyer && this.anchor.perch ? stopped : 0;
    p.flap = flyer ? Math.sin(elapsed * 15.5) * (1 - p.perched) : 0;
    if (flyer) p.height += (this.anchor.lift ?? 2) + this.anchor.scale * 0.055 + move * (0.28 + 0.14 * Math.sin(angle * 2));
    return p;
  }
}
