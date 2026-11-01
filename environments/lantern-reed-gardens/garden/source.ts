import { gardenSource as connectedSource, type GardenSource } from '../../../src/garden/source';
import type { GardenSnapshot } from '../../../src/garden/types';

/** An unconnected habitat starts with its own life, without the meadow's sample flower beds. */
export function gardenSource(search = location.search): GardenSource {
  if (new URLSearchParams(search).get('garden')) return connectedSource(search);
  const snapshot: GardenSnapshot = {
    muse: { name: 'Muse', soul: 'At home among the lantern reeds.', status: { home: true } },
    interests: [], friends: [], baskets: [], finds: [], postcards: [],
  };
  return { load: () => Promise.resolve(snapshot), subscribe: () => () => undefined, react: () => Promise.resolve() };
}
