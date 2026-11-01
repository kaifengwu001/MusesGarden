import { Vector3, type IUniform } from 'three';
import { PEAKS } from './fields';
import { ModelSet, type Placement } from './models';
import type { TerraceTerrain } from './terrain';

// The karst towers: Kai's five mountain models (scripts/terraces-models.mjs
// made them light: src/assets/terraces/mountain*.glb, a unit tall, two levels
// of detail each), one standing on each tower's site (fields.ts places the
// sites and gathers a low mound of ground round each foot), turned and
// stretched a little so no two read alike, its height the site's. Drawn
// rigid, not bent round the planet (a tall tower bent with it would flare
// at its top): its base sunk into its mound so its edges never float. Near
// ones in full detail, far ones in their lighter copy.

const URLS = [1, 2, 3, 4, 5].map((k) => new URL(`../assets/terraces/mountain${k}.glb`, import.meta.url).href);
/**
 * Its base: under the lowest ground round its foot (sampled on two rings out to this far, × its height: the
 * models' footprints reach about half their height across), sunk this much more (× its height); and out to
 * where a tower is drawn in full detail (m, plus its height).
 */
export const TOWER = { foot: [0.25, 0.45, 0.62], sink: 0.08, near: 140, squash: 0.8 } as const;

export class Towers {
  private readonly set_: ModelSet;
  readonly group;

  constructor(shared: Record<string, IUniform>) {
    this.set_ = new ModelSet('towers', URLS, shared, PEAKS.max, TOWER.near, TOWER.squash);
    this.group = this.set_.group;
  }

  /** The towers on the planet's sites, each on its mound (call when the fields change). */
  set(terrain: TerraceTerrain): void {
    const placements: Placement[] = terrain.fields.peaks.map((peak) => {
      const up = peak.dir.clone();
      // its turn about the up, from a fixed tangent
      const a = new Vector3().crossVectors(up, Math.abs(up.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      const b = new Vector3().crossVectors(up, a);
      const e1 = a.multiplyScalar(Math.cos(peak.turn)).addScaledVector(b, Math.sin(peak.turn)).normalize();
      // (Kai: some floated, or showed a gap under them: the ground falls away round a foot on a slope)
      let base = terrain.fields.natural(up);
      const q = new Vector3();
      const e2 = new Vector3().crossVectors(up, e1);
      for (const ring of TOWER.foot) {
        for (let k = 0; k < 12; k++) {
          const t = e1.clone().multiplyScalar(Math.cos((k * Math.PI) / 6)).addScaledVector(e2, Math.sin((k * Math.PI) / 6));
          q.copy(up).addScaledVector(t, (ring * peak.height * peak.stretch) / terrain.radius).normalize();
          base = Math.min(base, terrain.fields.natural(q));
        }
      }
      return { model: peak.model, up, e1, base: base - TOWER.sink * TOWER.squash * peak.height, height: peak.height, stretch: peak.stretch };
    });
    this.set_.set(placements, terrain.radius);
  }

  /** Each tower in full detail or its lighter copy by its distance from the camera (planet space). */
  update(camera: Vector3): void {
    this.set_.update(camera);
  }
}
