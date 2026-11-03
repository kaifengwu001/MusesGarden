// The planets a Muse can live on, for the server (names, the cast's validation) and the page (where to go). Pure
// data: the server imports it as it imports routes.ts. Each world's title is its page's <title>.
import type { PlanetId } from './contract';

export interface Planet {
  /** The planet's name, as a ticket prints it. */
  readonly title: string;
  /** Its page: the meadow at the root, every other world under /environments/<id>/. */
  readonly path: string;
}

export const PLANETS: Readonly<Record<PlanetId, Planet>> = {
  meadow: { title: 'The Meadow', path: '/' },
  'lantern-reed-gardens': { title: 'Lantern Reed Gardens', path: '/environments/lantern-reed-gardens/' },
  'scarlet-sail-canyon': { title: 'Scarlet Sail Canyon', path: '/environments/scarlet-sail-canyon/' },
  'cobalt-windfields': { title: 'Cobalt Windfields', path: '/environments/cobalt-windfields/' },
  'tulip-windmill-meadows': { title: 'Tulipwind Meadows', path: '/environments/tulip-windmill-meadows/' },
  'golden-rye': { title: 'Golden Rye', path: '/environments/golden-rye/' },
  'cherry-blossom-waterways': { title: 'Cherry Blossom Waterways', path: '/environments/cherry-blossom-waterways/' },
  'sequoia-shrine': { title: 'Sequoia Shrine', path: '/environments/sequoia-shrine/' },
  'violet-dunes': { title: 'Violet Dunes', path: '/environments/violet-dunes/' },
};

export const PLANET_IDS = Object.keys(PLANETS) as readonly PlanetId[];

export function isPlanetId(v: unknown): v is PlanetId {
  return typeof v === 'string' && Object.hasOwn(PLANETS, v);
}
