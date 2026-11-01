import type { MuseId } from '../../src/muse/contract';
import { id } from './parse';

/**
 * Who is asking: the owner of the Muse named by `?as=<museId>`. The demo has no auth, so this trusts the query,
 * and the routes under /api/muses/:id, /api/host/:id and /api/dev/:id trust their :id the same way. Real auth
 * replaces this function and checks every :id against the owner it returns.
 */
export function requestingOwner(query: URLSearchParams): MuseId {
  return id<MuseId>(query.get('as'), 'as');
}
