import type { PlanetId } from '../muse/contract';
import { isPlanetId, planetOf } from '../muse/planets';

// A visit is reached by its URL alone, `<the host's planet>/?visit=<ticket>&as=<guest>&garden=<base>`, so a reload is
// the same visit. Home is the guest's own planet with its garden: `<the guest's planet>/?garden=<base>`. A page opened
// with the dev tools (`&dev`) keeps them there and back.

export interface VisitParams {
  /** The ticket (an invitation id) the owner travels on. */
  readonly invitation: string;
  /** The owner's own Muse, the guest: every request asks as it. */
  readonly as: string;
  /** The owner's garden backend (`?garden=`), as the garden pages take it: home again, and the API's host. */
  readonly garden: string;
  /** Set when the page has the dev tools (`&dev`): the visit and home again have them too. */
  readonly dev?: true;
}

/** The query a visit's page or home takes, `dev` last and only when set. */
function query(fields: Record<string, string>, dev: boolean | undefined): string {
  const q = new URLSearchParams(fields);
  if (dev) q.set('dev', '');
  return q.toString();
}

/** Whether a planet takes visits: one of the planets, and one its entry in src/muse/planets.ts marks `visitable`. */
export function visitable(planet: string): planet is PlanetId {
  return isPlanetId(planet) && planetOf(planet).visitable;
}

/** The visit a page's query names, or null when it names none. Without `garden`, the guest's own on this host. */
export function readVisit(search: string): VisitParams | null {
  const q = new URLSearchParams(search);
  const invitation = q.get('visit');
  const as = q.get('as');
  if (!invitation || !as) return null;
  return { invitation, as, garden: q.get('garden') || `/api/muses/${encodeURIComponent(as)}`, ...(q.has('dev') ? { dev: true as const } : {}) };
}

/** The visit's page on a planet. */
export function visitUrl(planet: PlanetId, p: VisitParams): string {
  return `${planetOf(planet).path}?${query({ visit: p.invitation, as: p.as, garden: p.garden }, p.dev)}`;
}

/** Home: the guest's own planet, with its garden; the meadow's page for a planet that has no garden page yet. */
export function homeUrl(planet: PlanetId, p: Pick<VisitParams, 'garden' | 'dev'>): string {
  return `${planetOf(visitable(planet) ? planet : 'meadow').path}?${query({ garden: p.garden }, p.dev)}`;
}

/** An API route (an absolute path, from src/muse/routes.ts) on the garden backend's host, which `garden` may put on another origin. */
export function apiUrl(garden: string, route: string, page: string): string {
  return new URL(route, new URL(garden, page)).href;
}

const MINUTE = 60_000;

/** The time a visit has left, as the banner says it: "1 h 42 left", "42 min left", "a minute left". */
export function leftPhrase(ms: number): string {
  const minutes = Math.ceil(Math.max(0, ms) / MINUTE);
  if (minutes <= 1) return ms > 0 ? 'a minute left' : 'time to go home';
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h left` : `${h} h ${String(m).padStart(2, '0')} left`;
}
