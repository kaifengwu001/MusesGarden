import { describe, expect, it } from 'vitest';
import { sampleMuses, sampleVisit } from '../muse/samples';
import { loadVisit, planetOf, returnFromVisit } from './api';

const PAGE = 'http://localhost:5313/environments/lantern-reed-gardens/?visit=inv-wren-hero-1&as=hero';
const P = { invitation: 'inv-wren-hero-1', as: 'hero', garden: 'http://localhost:8811/api/muses/hero' };

/** A fetch that answers `status` (and `body` as JSON), and keeps what it was asked. */
function server(status: number, body: unknown = {}) {
  const asked: { url: string; method: string }[] = [];
  const fetcher = (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? 'GET' });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { asked, fetcher };
}
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('the visit’s requests', () => {
  it('reads the visit as the guest, from the garden’s own host', async () => {
    const s = server(200, sampleVisit);
    expect(await loadVisit(P, PAGE, s.fetcher)).toEqual({ kind: 'open', view: JSON.parse(JSON.stringify(sampleVisit)) as unknown });
    expect(s.asked).toEqual([{ url: 'http://localhost:8811/api/visits/inv-wren-hero-1/world?as=hero', method: 'GET' }]);
  });

  it('calls a 403 or a 404 the end of the visit, and anything else out of reach', async () => {
    for (const status of [403, 404]) expect(await loadVisit(P, PAGE, server(status).fetcher)).toEqual({ kind: 'ended' });
    for (const status of [500, 502]) expect(await loadVisit(P, PAGE, server(status).fetcher)).toEqual({ kind: 'unreachable' });
    expect(await loadVisit(P, PAGE, offline)).toEqual({ kind: 'unreachable' });
  });

  it('comes home early with a POST, taking a 409 or a 403 as a trip already over', async () => {
    const s = server(200, { ok: true });
    expect(await returnFromVisit(P, PAGE, s.fetcher)).toBe(true);
    expect(s.asked).toEqual([{ url: 'http://localhost:8811/api/visits/inv-wren-hero-1/return?as=hero', method: 'POST' }]);
    for (const status of [403, 409]) expect(await returnFromVisit(P, PAGE, server(status).fetcher), String(status)).toBe(true);
    expect(await returnFromVisit(P, PAGE, server(500).fetcher)).toBe(false);
    expect(await returnFromVisit(P, PAGE, offline)).toBe(false);
  });

  it('finds the guest’s own planet in the cast, for the way home', async () => {
    expect(await planetOf(P, PAGE, server(200, sampleMuses).fetcher)).toBe('meadow');
    expect(await planetOf({ ...P, as: 'wren' }, PAGE, server(200, sampleMuses).fetcher)).toBe('lantern-reed-gardens');
    expect(await planetOf({ ...P, as: 'nobody' }, PAGE, server(200, sampleMuses).fetcher)).toBeNull();
    expect(await planetOf(P, PAGE, offline)).toBeNull();
  });
});
