import type { Muse } from './life/muse';
import { createGroundSample } from './planet/terrain';
import type { CompanionWorld } from './visit/companions';
import type { World } from './world';

// The meadow as other Muses come to it: on Momo's own garden, a friend's Muse visiting Momo drawn beside it
// (src/visit/companions.ts). The meadow is a world like the others, but it lives in src/, so its adapter lives here
// beside main.ts.

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
