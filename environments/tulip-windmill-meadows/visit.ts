import type { VisitWorld } from '../../src/visit/world';
import { bedAt, layOut } from './garden/placement';
import { FindBeds } from './life/findBeds';
import { Muse } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { World } from './world';

// Tulip Windmill Meadows as a visit's destination (src/visit/): the host is this world's own Muse, the guest a second
// one (the shared uniforms without the grass press, none of the home's props), and the finds grow in this world's
// beds. No one else lives here to keep out of sight. Each Muse is drawn in its own look: the original Muse, or one of
// the muses in clothes (life/muse.ts takes either).

export function tulipVisit(world: World): VisitWorld {
  const beds = new FindBeds(world.shared);
  world.scene.add(...beds.objects);
  const sample = createGroundSample();
  return {
    planet: 'tulip-windmill-meadows',
    scene: world,
    host: world.muse,
    dressHost: (look) => world.muse.useModel(look),
    makeGuest: (look) => {
      // A guest must never press the host's grass: the shared uniforms, less the press.
      const isolated = Object.fromEntries(Object.entries(world.shared).filter(([key]) => key !== 'uMusePress' && key !== 'uMusePressK'));
      const guest = new Muse(isolated, { homeProps: false });
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
    // (the director's benches and stoves, lit by this world's own uniforms: src/director/)
    stage: { add: (...objects) => world.scene.add(...objects), remove: (...objects) => world.scene.remove(...objects), shared: world.shared },
    // (the host's home: its homestead view)
    frameHome: () => world.cameraPreset('homestead', false),
    // (from over the tulips, which stand to the two Muses' shoulders)
    musesView: { distance: 5, height: 4.6, aim: 0.7 },
  };
}
