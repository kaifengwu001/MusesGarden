import type { VisitWorld } from '../../src/visit/world';
import { bedAt, layOut } from './garden/placement';
import { FindBeds } from './life/findBeds';
import { Muse } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { World } from './world';

// Violet Dunes as a visit's destination (src/visit/): the host is this world's own Muse, keeping to its day at the
// shelter; the guest a second one (the shared uniforms without the grass press: this world has no grass, nor props
// for its Muse), out on the sand beside it; and the finds grow in beds round the shelter, as Golden Rye's grow
// (life/findBeds.ts, garden/placement.ts, from there). No one else lives here to keep out of sight. Each Muse is drawn
// in its own look: the original Muse, or one of the muses in clothes (life/muse.ts takes either).

export function violetVisit(world: World): VisitWorld {
  const beds = new FindBeds(world.shared);
  world.scene.add(...beds.objects);
  const sample = createGroundSample();
  return {
    planet: 'violet-dunes',
    scene: world,
    host: world.muse,
    dressHost: (look) => world.muse.useModel(look),
    makeGuest: (look) => {
      const isolated = Object.fromEntries(Object.entries(world.shared).filter(([key]) => key !== 'uMusePress' && key !== 'uMusePressK'));
      const guest = new Muse(isolated);
      guest.useModel(look);
      world.addVisitor(guest);
      return guest;
    },
    hideOthers: () => undefined,
    marks: {
      set: (looks, radius) => beds.set(looks, radius, new Set()),
      update: (altitude) => beds.update(altitude, true),
      open: (id) => beds.open(id),
    },
    layOut: (baskets, finds) => layOut(world.terrain, baskets, finds).beds,
    bedAt: (laid, dir) => bedAt({ beds: laid }, dir, world.growth.radius),
    ground: (dir) => world.terrain.sample(dir, sample),
    shape: () => world.terrain.layout,
  };
}
