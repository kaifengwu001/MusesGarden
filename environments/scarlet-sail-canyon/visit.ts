import type { VisitWorld } from '../../src/visit/world';
import { bedAt, layOut } from './garden/placement';
import { FindBeds } from './life/findBeds';
import { FindForms } from './life/findForms';
import { Muse } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { World } from './world';

// Scarlet Sail Canyon as a visit's destination (src/visit/): the host is this world's own Muse, the guest a second
// one made as the residents are (the shared uniforms without the grass press, no props of its own), the finds grow in
// this world's beds and specimens, and the residents keep out of sight while a friend's owner is here. Each Muse is
// drawn in its own look: the original Muse, or one of the muses in clothes (life/muse.ts takes either).

export function scarletVisit(world: World): VisitWorld {
  const beds = new FindBeds(world.shared);
  const forms = new FindForms(world.shared, beds);
  world.scene.add(...beds.meshes, ...forms.objects);
  const sample = createGroundSample();
  return {
    planet: 'scarlet-sail-canyon',
    scene: world,
    host: world.muse,
    dressHost: (look) => world.muse.useModel(look),
    makeGuest: (look) => {
      // A guest must never press the host's grass: the shared uniforms, less the press (as residents.ts).
      const isolated = Object.fromEntries(Object.entries(world.shared).filter(([key]) => key !== 'uMusePress' && key !== 'uMusePressK'));
      const guest = new Muse(isolated, { homeProps: false });
      guest.useModel(look);
      world.addVisitor(guest);
      return guest;
    },
    hideOthers: () => {
      for (const resident of world.residents.members) resident.muse.direct({ kind: 'hidden' });
    },
    marks: {
      set: (looks, radius) => {
        beds.set(looks, radius, new Set());
        forms.set(looks, world.terrain, new Set());
      },
      update: (altitude) => {
        beds.update(altitude);
        forms.update(altitude, true);
      },
      open: (id) => {
        beds.highlight(id);
        forms.open(id);
      },
    },
    layOut: (baskets, finds) => layOut(world.terrain, baskets, finds).beds,
    bedAt: (laid, dir) => bedAt({ beds: laid }, dir, world.growth.radius),
    ground: (dir) => world.terrain.sample(dir, sample),
    shape: () => world.terrain.layout,
    // (the director's benches and stoves, lit by this world's own uniforms: src/director/)
    stage: { add: (...objects) => world.scene.add(...objects), remove: (...objects) => world.scene.remove(...objects), shared: world.shared },
    // (the host's home: its homestead view)
    frameHome: () => world.cameraPreset('homestead', false),
  };
}
