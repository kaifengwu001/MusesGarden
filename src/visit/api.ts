import type { MemberInfo, MuseId, PlanetId, VisitWorldView } from '../muse/contract';
import { path } from '../muse/routes';
import { apiUrl, type VisitParams } from './params';

// A visit's two requests: the host's planet as the guest may see it (GET /api/visits/:id/world?as=), and coming home
// early (POST /api/visits/:id/return?as=). Both on the garden backend's own host.

/** The visit as the server has it: open, over (403: the trip ended, or it was never this guest's; 404: no such ticket), or out of reach. */
export type VisitLoad =
  | { readonly kind: 'open'; readonly view: VisitWorldView }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unreachable' };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function loadVisit(p: VisitParams, page: string = location.href, fetcher: Fetch = fetch): Promise<VisitLoad> {
  const url = apiUrl(p.garden, path('visit', { id: p.invitation }, { as: p.as }), page);
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, credentials: 'include' });
    if (response.ok) return { kind: 'open', view: (await response.json()) as VisitWorldView };
    return response.status === 403 || response.status === 404 ? { kind: 'ended' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * Come home early. True once the trip is over on the server: returned now, or already (a 409: it ended or was never
 * taken; a 403: it was never this guest's). False when the server could not be reached.
 */
export async function returnFromVisit(p: VisitParams, page: string = location.href, fetcher: Fetch = fetch): Promise<boolean> {
  const url = apiUrl(p.garden, path('returnFromVisit', { id: p.invitation }, { as: p.as }), page);
  try {
    const response = await fetcher(url, { method: 'POST', credentials: 'include' });
    return response.ok || response.status === 403 || response.status === 409;
  } catch {
    return false;
  }
}

/** The guest's own planet, from the cast (GET /api/muses), for the way home when the visit's own view can't say. */
export async function planetOf(p: VisitParams, page: string = location.href, fetcher: Fetch = fetch): Promise<PlanetId | null> {
  try {
    const response = await fetcher(apiUrl(p.garden, path('muses', {}), page), { headers: { accept: 'application/json' }, credentials: 'include' });
    if (!response.ok) return null;
    const muses = (await response.json()) as readonly ({ readonly museId: MuseId } & Partial<MemberInfo>)[];
    return muses.find((m) => m.museId === p.as)?.planet ?? null;
  } catch {
    return null;
  }
}
