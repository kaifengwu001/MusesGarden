import { bedAt, layOut } from './garden/placement';
import { FindBeds } from './life/findBeds';
import type { Muse } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { CompanionWorld } from './visit/companions';
import { VisitUi } from './visit/visitUi';
import type { VisitWorld } from './visit/world';
import type { World } from './world';

// The meadow as other Muses come to it: a destination for a friend's owner on a ticket (src/visit/), and, on Momo's
// own garden, a friend's Muse visiting Momo drawn beside it (src/visit/companions.ts). The meadow is a world like the
// others, but it lives in src/, so its adapter lives here beside main.ts. Its Muses wear any look, a body the
// workshop made too (src/life/muse.ts loads it, and wears the original Muse where it can't be had).

/** The meadow as a visit's destination: Momo is the host, the guest a visiting Muse beside it, the finds its beds. */
export function meadowVisit(world: World): VisitWorld {
  const beds = new FindBeds(world.shared);
  world.scene.add(...beds.objects);
  const sample = createGroundSample();
  return {
    planet: 'meadow',
    scene: world,
    host: world.muse,
    dressHost: (look) => world.muse.useModel(look),
    makeGuest: (look) => world.addVisitor(look),
    // (the meadow has no residents of its own)
    hideOthers: () => undefined,
    marks: {
      set: (looks, radius) => beds.set(looks, radius),
      update: (altitude) => beds.update(altitude, true),
      open: (id) => beds.open(id),
    },
    layOut: (baskets, finds) => layOut(world.terrain, baskets, finds).beds,
    bedAt: (laid, dir) => bedAt({ beds: laid }, dir, world.growth.radius),
    ground: (dir) => world.terrain.sample(dir, sample),
    shape: () => world.terrain.layout,
    standable: (dir) => world.muse.life?.standable(dir) ?? true,
    // (the host's home: the cottage, as the painting sees it)
    frameHome: () => world.cameraPreset('homestead', false),
  };
}

/**
 * The visit's interface on the meadow's page, which asks its garden for more than the visit has: the hut's layout
 * gizmo, the hut's own drags and zooms, and its holds. A visitor has none of them: the hut stays shut.
 */
export class MeadowVisitUi extends VisitUi {
  readonly gizmo = false;

  drag(): boolean {
    return false;
  }

  zoom(): boolean {
    return false;
  }

  claims(): boolean {
    return false;
  }
}

/** Momo's meadow as a friend's Muse visits it: Momo, the planet, and a Muse for the friend, made beside Momo. */
export function meadowCompanions(world: World): CompanionWorld<Muse> {
  const sample = createGroundSample();
  return {
    host: world.muse,
    growth: world.growth,
    makeGuest: (look) => world.addVisitor(look),
    dress: (guest, look) => guest.useModel(look),
    ground: (dir) => world.terrain.sample(dir, sample),
    standable: (dir) => world.muse.life?.standable(dir) ?? true,
  };
}
