// The Muse API's one route table. The server registers a handler for every entry (a missing one won't compile), and
// the overlay builds every URL from it, so the two can't drift apart.

export const ROUTES = {
  muses: { method: 'GET', pattern: '/api/muses' },
  now: { method: 'GET', pattern: '/api/muses/:id/now' },
  world: { method: 'GET', pattern: '/api/muses/:id/world' },
  plant: { method: 'GET', pattern: '/api/muses/:id/plants/:pid' },
  baskets: { method: 'GET', pattern: '/api/muses/:id/baskets' },
  photos: { method: 'GET', pattern: '/api/muses/:id/photos' },
  shelf: { method: 'GET', pattern: '/api/muses/:id/home/shelf' },
  invitations: { method: 'GET', pattern: '/api/muses/:id/invitations' },
  sharing: { method: 'GET', pattern: '/api/muses/:id/settings/sharing' },
  basketTime: { method: 'POST', pattern: '/api/muses/:id/settings/basket-time' },
  hidden: { method: 'POST', pattern: '/api/muses/:id/settings/hidden' },
  introduce: { method: 'POST', pattern: '/api/muses/:id/settings/introductions' },
  unshare: { method: 'POST', pattern: '/api/muses/:id/settings/unshare' },
  withdraw: { method: 'POST', pattern: '/api/invitations/:id/withdraw' },
  visit: { method: 'GET', pattern: '/api/visits/:id/world' },
  hostWork: { method: 'POST', pattern: '/api/host/:id/work' },
  hostSoul: { method: 'POST', pattern: '/api/host/:id/soul' },
  hostMemory: { method: 'POST', pattern: '/api/host/:id/memory' },
  advance: { method: 'POST', pattern: '/api/dev/advance' },
  setClock: { method: 'POST', pattern: '/api/dev/clock' },
  clock: { method: 'GET', pattern: '/api/dev/clock' },
  mind: { method: 'GET', pattern: '/api/dev/:id/mind' },
  metrics: { method: 'GET', pattern: '/api/dev/:id/metrics' },
  soulMd: { method: 'GET', pattern: '/api/dev/:id/soul.md' },
  journalMd: { method: 'GET', pattern: '/api/dev/:id/journal.md' },
  garden: { method: 'GET', pattern: '/api/muses/:id/garden' },
  gardenEvents: { method: 'GET', pattern: '/api/muses/:id/garden/events' },
  gardenReactions: { method: 'POST', pattern: '/api/muses/:id/garden/reactions' },
  media: { method: 'GET', pattern: '/api/media/:mid' },
  postcardImage: { method: 'GET', pattern: '/api/postcards/:name' },
} as const satisfies Record<string, { readonly method: 'GET' | 'POST'; readonly pattern: string }>;

export type RouteName = keyof typeof ROUTES;

/** The `:name` segments of a pattern, as a union of names. */
type ParamsOf<P extends string> = P extends `${string}:${infer K}/${infer Rest}`
  ? K | ParamsOf<`/${Rest}`>
  : P extends `${string}:${infer K}`
    ? K
    : never;

export type RouteParams<N extends RouteName> = Record<ParamsOf<(typeof ROUTES)[N]['pattern']>, string>;

/** A route's URL with its params filled in (URI-encoded) and any non-null query values appended. */
export function path<N extends RouteName>(
  name: N,
  params: RouteParams<N>,
  query: Readonly<Record<string, string | number | null | undefined>> = {},
): string {
  const values = params as Readonly<Record<string, string>>;
  const filled = ROUTES[name].pattern.replace(/:([A-Za-z]+)/g, (_, key: string) => encodeURIComponent(values[key]));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined) search.set(key, String(value));
  const qs = search.toString();
  return qs ? `${filled}?${qs}` : filled;
}
