// The planets a Muse can live on, for the server (names, the cast's validation) and the page (where to go). Pure
// data: the server imports it as it imports routes.ts. Each world's title is its page's <title>, shortened where the
// page's is longer.
import type { GeneratedPlanet, KnownPlanet, PlanetId } from './contract';

export interface Planet {
  /** The planet's name, as a ticket prints it. */
  readonly title: string;
  /** Its page: the meadow at the root, every other world under /environments/<id>/. */
  readonly path: string;
  /**
   * Whether a visit can go there yet. Rice Terraces is a standalone viewer with no engine link; Ukiyo-e Pine Hamlet
   * is only in an open pull request, not on main.
   */
  readonly visitable: boolean;
}

export const PLANETS: Readonly<Record<KnownPlanet, Planet>> = {
  meadow: { title: 'The Meadow', path: '/', visitable: true },
  'lantern-reed-gardens': { title: 'Lantern Reed Gardens', path: '/environments/lantern-reed-gardens/', visitable: true },
  'scarlet-sail-canyon': { title: 'Scarlet Sail Canyon', path: '/environments/scarlet-sail-canyon/', visitable: true },
  'cobalt-windfields': { title: 'Cobalt Windfields', path: '/environments/cobalt-windfields/', visitable: true },
  'tulip-windmill-meadows': { title: 'Tulipwind Meadows', path: '/environments/tulip-windmill-meadows/', visitable: true },
  'golden-rye': { title: 'Golden Rye', path: '/environments/golden-rye/', visitable: true },
  'cherry-blossom-waterways': { title: 'Cherry Blossom Waterways', path: '/environments/cherry-blossom-waterways/', visitable: true },
  'sequoia-shrine': { title: 'Sequoia Shrine', path: '/environments/sequoia-shrine/', visitable: true },
  'violet-dunes': { title: 'Violet Dunes', path: '/environments/violet-dunes/', visitable: true },
  'rice-terraces': { title: 'Rice Terraces', path: '/environments/rice-terraces/', visitable: false },
  'ukiyoe-pine-hamlet': { title: 'Ukiyo-e Pine Hamlet', path: '/environments/ukiyoe-pine-hamlet/', visitable: false },
};

export const PLANET_IDS = Object.keys(PLANETS) as readonly KnownPlanet[];

/** A planet the workshop built for one Muse: environments/muse-<id>/ (lowercase letters, digits, hyphens). */
const GENERATED_ID = /^muse-[a-z0-9][a-z0-9-]*$/;

/** Generated planets by id, as the workshop registers them (from environments/generated.json, or on approval). */
const GENERATED = new Map<GeneratedPlanet, Planet>();

export function isKnownPlanet(v: unknown): v is KnownPlanet {
  return typeof v === 'string' && Object.hasOwn(PLANETS, v);
}

export function isGeneratedPlanet(v: unknown): v is GeneratedPlanet {
  return typeof v === 'string' && GENERATED_ID.test(v);
}

export function isPlanetId(v: unknown): v is PlanetId {
  return isKnownPlanet(v) || isGeneratedPlanet(v);
}

/** Adds or renames a generated planet. Its page is /environments/<id>/; it takes visits once its world opts in. */
export function registerPlanet(id: GeneratedPlanet, title: string, visitable = false): void {
  GENERATED.set(id, { title, path: `/environments/${id}/`, visitable });
}

/** Any planet's name, page and visits: a known one from PLANETS, a generated one as registered (or by its id until then). */
export function planetOf(id: PlanetId): Planet {
  if (isKnownPlanet(id)) return PLANETS[id];
  return GENERATED.get(id) ?? { title: id, path: `/environments/${id}/`, visitable: false };
}
