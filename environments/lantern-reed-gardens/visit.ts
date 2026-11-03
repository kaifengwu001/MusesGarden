import type { MuseLook } from '../../src/muse/contract';
import type { VisitWorld } from '../../src/visit/world';
import { bedAt, layOut } from './garden/placement';
import { FindBeds } from './life/findBeds';
import { FindForms } from './life/findForms';
import { Muse, type MuseModel } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { World } from './world';

// Lantern Reed Gardens as a visit's destination (src/visit/): the host is this world's own Muse, the guest a second
// one made as the residents are (the shared uniforms without the grass press, no props of its own), the finds grow in
// this world's beds and specimens, and the residents keep out of sight while a friend's owner is here.

/**
 * The body a look is drawn in here. TODO(dressed muses): this world's Muse (life/muse.ts) takes only the original
 * bodies until the dressed-muse port lands; then a dressed look passes straight through, as src/life/muse.ts takes it.
 */
function model(look: MuseLook): MuseModel {
  return look === 'tpose6' ? look : 'tpose6';
}

export function lanternVisit(world: World): VisitWorld {
  const beds = new FindBeds(world.shared);
  const forms = new FindForms(world.shared, beds);
  world.scene.add(...beds.meshes, ...forms.objects);
  const sample = createGroundSample();
  return {
    planet: 'lantern-reed-gardens',
    scene: world,
    host: world.muse,
    dressHost: (look) => world.muse.useModel(model(look)),
    makeGuest: (look) => {
      // A guest must never press the host's grass: the shared uniforms, less the press (as residents.ts).
      const isolated = Object.fromEntries(Object.entries(world.shared).filter(([key]) => key !== 'uMusePress' && key !== 'uMusePressK'));
      const guest = new Muse(isolated, { homeProps: false });
      guest.useModel(model(look));
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
  };
}
