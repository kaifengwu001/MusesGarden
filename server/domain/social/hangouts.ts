import type {
  Draw,
  Instant,
  MuseEventBody,
  MuseId,
  MuseState,
  PhotoId,
  PublicDiscovery,
  PublicProfile,
  SocialPolicy,
  VisitOffer,
} from '../../../src/muse/contract';
import { localClock } from './clock';
import { SOCIAL } from './constants';
import { invite } from './invitations';
import { photoSlotsLeft, photoTogether, whereIs } from './photos';
import { compare, findOverlap, publicProfile, similarity, stretch } from './profile';
import { areFriends, chemistry, ending, isUnpleasant, relationshipWith } from './relationships';

type Visit = ReturnType<SocialPolicy['chooseVisit']>;

export function socialLeftMs(s: MuseState, now: Instant): number {
  const used = s.day.day === localClock(now, s.seed.timezone).day ? s.day.socialMs : 0;
  return Math.max(0, Math.floor(SOCIAL.budgetMsAtFullSociability * s.temperament.sociability - used));
}

function pick<T>(items: readonly T[], weights: readonly number[], u: number): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let x = u * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

function visitMs(draw: Draw): number {
  const z = Math.sqrt(-2 * Math.log(1 - draw('visit.length', 0))) * Math.cos(2 * Math.PI * draw('visit.length', 1));
  return SOCIAL.visitMedianMs * Math.exp(SOCIAL.visitSigma * z);
}

/**
 * Free friends with a photo slot on both sides, since every hangout brings a photo. Friends never met yet are first:
 * they meet whatever social time is left. Everyone else needs social time on both sides.
 */
function visitable(s: MuseState, free: readonly { readonly state: MuseState }[], now: Instant): { readonly first: MuseState[]; readonly friends: MuseState[] } {
  if (photoSlotsLeft(s, now) <= 0) return { first: [], friends: [] };
  const ready = free
    .map((f) => f.state)
    .filter((f) => areFriends(s, f) && photoSlotsLeft(f, now) > 0)
    .sort((x, y) => compare(x.seed.id, y.seed.id));
  return {
    first: ready.filter((f) => relationshipWith(s, f.seed.id)?.lastMetAt === null),
    friends: socialLeftMs(s, now) > 0 ? ready.filter((f) => socialLeftMs(f, now) > 0) : [],
  };
}

export function visitOffer(s: MuseState, free: readonly { readonly state: MuseState }[], now: Instant): VisitOffer {
  const { first, friends } = visitable(s, free, now);
  return first.length > 0 ? 'first-meeting' : friends.length > 0 ? 'friend' : 'none';
}

export function chooseVisit(s: MuseState, free: readonly { readonly state: MuseState }[], now: Instant, draw: Draw): Visit {
  const { first, friends } = visitable(s, free, now);
  const role = (lastRole: 'host' | 'guest' | null | undefined) =>
    draw('visit.direction') < (lastRole === 'guest' ? SOCIAL.goAfterBeingGuest : SOCIAL.goUsually) ? 'guest' : 'host';
  if (first.length > 0) return { other: first[0].seed.id, role: role(null), until: (now + SOCIAL.firstMeetingMs) as Instant };
  if (friends.length === 0) return null;
  const left = socialLeftMs(s, now);

  const rapport = friends.map((f) => relationshipWith(s, f.seed.id)?.rapport ?? 0);
  const closest = Math.max(...rapport);
  const mine = publicProfile(s);
  const weights = friends.map((f, i) => {
    const closeness = (closest > 0 ? rapport[i] / closest : 0) * similarity(mine, publicProfile(f));
    return Math.exp(closeness / SOCIAL.closenessTemperature);
  });
  const friend = pick(friends, weights, draw('visit.friend'));
  if (draw('visit.distant') < (relationshipWith(s, friend.seed.id)?.distance ?? 0)) return null;

  const length = Math.min(visitMs(draw), left, socialLeftMs(friend, now));
  return { other: friend.seed.id, role: role(relationshipWith(s, friend.seed.id)?.lastRole), until: (now + Math.floor(length)) as Instant };
}

export function chooseGift(giver: PublicProfile, receiver: MuseState, receiverProfile: PublicProfile): PublicDiscovery | null {
  let best: { find: PublicDiscovery; score: number } | null = null;
  for (const find of giver.discoveries) {
    if (receiver.collected.has(find.canonicalUrl)) continue;
    const score = stretch(findOverlap(find, receiverProfile));
    if (!best || score > best.score || (score === best.score && compare(find.id, best.find.id) < 0)) best = { find, score };
  }
  return best ? best.find : null;
}

function hangoutEvent(
  other: MuseId,
  role: 'host' | 'guest',
  pleasantness: number,
  photo: PhotoId,
  gave: PublicDiscovery | null,
  received: PublicDiscovery | null,
): MuseEventBody {
  return {
    kind: 'hangout',
    other,
    role,
    pleasantness,
    photo,
    ...(gave ? { gave: gave.id } : {}),
    ...(received ? { received } : {}),
  };
}

export function hangout(host: MuseState, guest: MuseState, now: Instant, draw: Draw): { readonly host: readonly MuseEventBody[]; readonly guest: readonly MuseEventBody[] } {
  if (!areFriends(host, guest)) return { host: [], guest: [] };
  const hostProfile = publicProfile(host);
  const guestProfile = publicProfile(guest);
  const fromHost = chooseGift(hostProfile, guest, guestProfile);
  const fromGuest = chooseGift(guestProfile, host, hostProfile);
  const { pleasantness } = chemistry(host, guest);

  const where = { planetOf: host.seed.id, dir: whereIs(host), zoom: SOCIAL.hangoutZoom };
  const photo = photoTogether('friend', host.seed.id, guest.seed.id, where, now, draw);
  const hostLog: MuseEventBody[] = [photo.a, hangoutEvent(guest.seed.id, 'host', pleasantness, photo.id, fromHost, fromGuest)];
  const guestLog: MuseEventBody[] = [photo.b, hangoutEvent(host.seed.id, 'guest', pleasantness, photo.id, fromGuest, fromHost)];

  const rel = relationshipWith(host, guest.seed.id);
  if (isUnpleasant(pleasantness, rel) && (rel?.unpleasantStreak ?? 0) + 1 >= SOCIAL.endingStreak) {
    const ended = ending(host, guest, 'drifted-apart');
    return { host: [...hostLog, ...ended.self], guest: [...guestLog, ...ended.other] };
  }

  const sinceInvite = (rel?.rapportSinceInvite ?? 0) + pleasantness;
  const needed = SOCIAL.inviteRapportBase + SOCIAL.inviteRapportSpan * (1 - host.temperament.sociability);
  const cooled = rel?.lastInviteAt == null || now - rel.lastInviteAt >= SOCIAL.inviteCooldownMs;
  const invitation = sinceInvite >= needed && cooled ? invite(host, guest, now) : null;
  return invitation ? { host: [...hostLog, invitation], guest: [...guestLog, invitation] } : { host: hostLog, guest: guestLog };
}
