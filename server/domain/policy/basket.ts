// Baskets for the owner: due with 3 finds waiting, or 1 waiting after 3 days; at most one per owner-day and 7
// finds, Muse's best by keep score. Every basket stays in the history.
import type { Basket, Instant, MuseState } from '../../../src/muse/contract';
import { basketId } from '../ids';
import { localDay, localHour, localInstant, nextDay, parseClock } from '../time';
import { BASKET_MAX_ITEMS, BASKET_MIN_ITEMS, BASKET_STALE_MS } from './constants';

export function basket(s: MuseState, now: Instant): Basket | null {
  const pending = s.pendingBasket.flatMap((id) => s.discoveries.get(id) ?? []);
  if (pending.length === 0) return null;
  const tz = s.seed.timezone;
  const today = localDay(now, tz);
  const last = s.baskets.at(-1);
  if (last && localDay(last.at, tz) === today) return null;
  const chosen = s.basketTime === null ? null : parseClock(s.basketTime);
  if (chosen !== null && localHour(now, tz) * 60 < chosen) return null;
  const since = last?.at ?? Math.min(...pending.map((d) => d.at));
  if (pending.length < BASKET_MIN_ITEMS && now - since < BASKET_STALE_MS) return null;
  const items = [...pending]
    .sort((a, b) => b.keepScore - a.keepScore || a.at - b.at)
    .slice(0, BASKET_MAX_ITEMS)
    .map((d) => d.id);
  return { id: basketId(s.seed.id, today), at: now, items };
}

/** The owner's chosen time, next after `now`; null without one, so the engine checks after each new find. */
export function nextBasketCheck(s: MuseState, now: Instant): Instant | null {
  if (s.basketTime === null || parseClock(s.basketTime) === null) return null;
  const tz = s.seed.timezone;
  const today = localInstant(localDay(now, tz), s.basketTime, tz);
  return today > now ? today : localInstant(nextDay(localDay(now, tz)), s.basketTime, tz);
}
