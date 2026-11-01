import type { IUniform, Vector3 } from 'three';
import { ModelSet } from './models';
import { MAX_HOUSES, type Village } from './villages';

// The villages' houses (villages.ts places them): Kai's five house models
// (src/assets/terraces/house*.glb: white plaster, dark tiled roofs, each on
// its own yard with a tree or a wall), stood on the floor under each, its
// front facing down the valley's fall, a little larger or smaller each. Near
// ones in full detail, far ones in their lighter copy.

const URLS = [1, 2, 3, 4, 5].map((k) => new URL(`../assets/terraces/house${k}.glb`, import.meta.url).href);
/** How far a house sinks into the ground (m: its yard's edge meets the floor), and out to where it is drawn in full detail (m). */
export const HOUSE = { sink: 0.3, near: 60 } as const;

export class Houses {
  private readonly models: ModelSet;
  readonly mesh;

  constructor(shared: Record<string, IUniform>) {
    this.models = new ModelSet('houses', URLS, shared, MAX_HOUSES, HOUSE.near);
    this.mesh = this.models.group;
  }

  set(villages: readonly Village[], R: number): void {
    this.models.set(
      villages.flatMap((v) => v.houses.map((h) => ({ model: h.model, up: h.dir, e1: h.along, base: h.floor - HOUSE.sink, height: h.height, stretch: 1 }))),
      R,
    );
  }

  /** Each house in full detail or its lighter copy by its distance from the camera (planet space). */
  update(camera: Vector3): void {
    this.models.update(camera);
  }
}
