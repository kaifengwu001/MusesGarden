// Brand constructors and parsers: the one place the domain casts primitives to branded ids.
import type {
  BasketId,
  CanonicalUrl,
  DiscoveryId,
  EventRef,
  Instant,
  MuseId,
  PhotoId,
  QuestionId,
  RegionKey,
  TopicKey,
} from '../../src/muse/contract';

export const museId = (s: string): MuseId => s as MuseId;
export const topicKey = (s: string): TopicKey => s as TopicKey;
export const canonicalUrl = (s: string): CanonicalUrl => s as CanonicalUrl;
export const discoveryId = (s: string): DiscoveryId => s as DiscoveryId;
export const questionId = (s: string): QuestionId => s as QuestionId;
export const instant = (ms: number): Instant => ms as Instant;

export const eventRef = (muse: MuseId, seq: number): EventRef => `${muse}#${seq}` as EventRef;

export function parseRef(ref: string): { readonly museId: MuseId; readonly seq: number } | null {
  const at = ref.lastIndexOf('#');
  if (at <= 0) return null;
  const seq = Number(ref.slice(at + 1));
  if (!Number.isInteger(seq) || seq < 1) return null;
  return { museId: museId(ref.slice(0, at)), seq };
}

export const regionKey = (face: number, i: number, j: number): RegionKey => `${face}:${i}:${j}` as RegionKey;

export function parseRegion(key: RegionKey): { readonly face: number; readonly i: number; readonly j: number } {
  const [face, i, j] = key.split(':').map(Number);
  return { face, i, j };
}

export const photoId = (muse: MuseId, n: number, at: number, k: number): PhotoId => `p:${muse}:${n}:${at}:${k}` as PhotoId;

/** At most one basket per owner-local day, so the day names it. */
export const basketId = (muse: MuseId, day: string): BasketId => `b:${muse}:${day}` as BasketId;

const GIFT = 'gift:';

/** A gift keeps the giver in its id: the contract's Discovery has no giver field. */
export const giftId = (giver: MuseId, received: DiscoveryId): DiscoveryId => `${GIFT}${giver}:${received}` as DiscoveryId;

export function giverOf(id: DiscoveryId): MuseId | null {
  if (!id.startsWith(GIFT)) return null;
  const rest = id.slice(GIFT.length);
  const colon = rest.indexOf(':');
  return colon > 0 ? museId(rest.slice(0, colon)) : null;
}
