import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { tangentToward } from '../../../src/planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import type { FaunaKind } from './canyonFaunaGeometry';
import { residentDirection } from './residentLife';

export interface FaunaAnchor { readonly id: string; readonly kind: FaunaKind; readonly x: number; readonly z: number; readonly scale: number; readonly lift?: number; readonly perch?: boolean }
export const FAUNA_ANCHORS: readonly FaunaAnchor[] = [
  { id: 'chalkstep-1', kind: 'chalkstep', x: -12.2, z: 15.5, scale: 0.94 },
  { id: 'chalkstep-2', kind: 'chalkstep', x: 11.8, z: 20.5, scale: 0.86 },
  { id: 'chalkstep-3', kind: 'chalkstep', x: 4.5, z: 24.5, scale: 0.78 },
  { id: 'sifter-1', kind: 'fern-sifter', x: -12.2, z: 7, scale: 1.18 },
  { id: 'sifter-2', kind: 'fern-sifter', x: -12.8, z: 19.5, scale: 1.05 },
  { id: 'sifter-3', kind: 'fern-sifter', x: 12.8, z: 22, scale: 0.97 },
  { id: 'dewwing-1', kind: 'dewwing', x: -5, z: 8, scale: 0.96, lift: 2.1, perch: true },
  { id: 'dewwing-2', kind: 'dewwing', x: 4, z: 7.5, scale: 0.86, lift: 1.75, perch: true },
  { id: 'dewwing-3', kind: 'dewwing', x: -13, z: -3, scale: 0.9, lift: 4.2 },
  { id: 'dewwing-4', kind: 'dewwing', x: -16, z: -5, scale: 0.8, lift: 4.6 },
  { id: 'dewwing-5', kind: 'dewwing', x: 16, z: 28, scale: 0.78, lift: 3.3 },
];

export interface FaunaPose {
  readonly dir: Vector3;
  readonly heading: Vector3;
  height: number;
  walking: number;
  gait: number;
  forage: number;
  flap: number;
  perched: number;
}

/** Small habitat loops, authored away from houses and the Muse residents' routes. */
export class FaunaMotion {
  readonly pose: FaunaPose = { dir: new Vector3(), heading: new Vector3(), height: 0, walking: 0, gait: 0, forage: 0, flap: 0, perched: 0 };
  private terrain: Terrain | null = null;
  private radius = -1;
  private seed = -1;
  private range = 0;
  private phase = 0;
  private dirty = true;
  private readonly ground = createGroundSample();
  private readonly scratch = new Vector3();

  constructor(readonly anchor: FaunaAnchor, readonly index: number) {}
  invalidate(): void { this.dirty = true; }

  perchDirection(terrain: Terrain, out = new Vector3()): Vector3 {
    if (this.dirty || this.terrain !== terrain || this.radius !== terrain.radius || this.seed !== terrain.layout.seed) this.prepare(terrain);
    return residentDirection(terrain, this.anchor.x + Math.cos(this.phase) * this.range, this.anchor.z + Math.sin(this.phase) * this.range * 0.65, out);
  }

  private prepare(terrain: Terrain): void {
    this.terrain = terrain;
    this.radius = terrain.radius;
    this.seed = terrain.layout.seed;
    this.phase = unit(hash32(this.seed + this.index * 7919 + 73)) * 26;
    this.dirty = false;
    if (this.anchor.kind === 'dewwing') { this.range = 1.25; return; }
    const desired = this.anchor.kind === 'chalkstep' ? 0.9 : 0.33;
    this.range = 0;
    // Validate whole loops against the new heightfield, not just their endpoints.
    // A steep terrace makes an animal forage in place rather than clip a riser.
    for (const factor of [1, 0.6, 0.3]) {
      let previous: number | null = null;
      let safe = true;
      for (let k = 0; k <= 80; k++) {
        const angle = (k / 80) * Math.PI * 2;
        residentDirection(terrain, this.anchor.x + Math.cos(angle) * desired * factor, this.anchor.z + Math.sin(angle) * desired * factor * 0.65, this.scratch);
        const sample = terrain.sample(this.scratch, this.ground);
        if (sample.water < 0.7 || !Number.isFinite(sample.height) || (previous !== null && Math.abs(sample.height - previous) > desired * factor * 0.06)) { safe = false; break; }
        previous = sample.height;
      }
      if (safe) { this.range = desired * factor; break; }
    }
  }

  at(time: number, terrain: Terrain): FaunaPose {
    if (this.dirty || this.terrain !== terrain || this.radius !== terrain.radius || this.seed !== terrain.layout.seed) this.prepare(terrain);
    const out = this.pose;
    const flyer = this.anchor.kind === 'dewwing';
    const cycle = flyer ? 22 : this.anchor.kind === 'chalkstep' ? 32 : 43;
    const movingTime = flyer ? (this.anchor.perch ? 15 : cycle) : this.anchor.kind === 'chalkstep' ? 21 : 27;
    const elapsed = Math.max(0, time + this.phase);
    const phase = elapsed % cycle;
    const u = Math.min(1, phase / movingTime);
    const progress = u * u * (3 - 2 * u);
    const angle = progress * Math.PI * 2 + this.phase;
    const move = phase < movingTime ? Math.sin(Math.PI * u) : 0;
    const x = this.anchor.x + Math.cos(angle) * this.range;
    const z = this.anchor.z + Math.sin(angle) * this.range * 0.65;
    residentDirection(terrain, x, z, out.dir);
    residentDirection(terrain, x - Math.sin(angle), z + Math.cos(angle) * 0.65, this.scratch);
    tangentToward(out.dir, this.scratch, out.heading);
    out.height = terrain.height(out.dir);
    out.walking = this.range > 0 ? move : 0;
    out.gait = elapsed * (this.anchor.kind === 'chalkstep' ? 5.1 : 7.2);
    const stopped = smoothstep(movingTime - 0.5, movingTime + 0.8, phase) * (1 - smoothstep(cycle - 1, cycle, phase));
    out.forage = stopped * (0.5 + 0.5 * Math.sin((phase - movingTime) * 2.1));
    out.perched = flyer ? stopped : 0;
    out.flap = flyer ? Math.sin(elapsed * 14.5) * (1 - out.perched) : 0;
    if (flyer) out.height += (this.anchor.lift ?? 2) + move * (0.45 + 0.2 * Math.sin(angle * 2));
    return out;
  }
}
