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
} from '../../../src/muse/contract';
import { localClock } from './clock';
import { SOCIAL } from './constants';
import { invite } from './invitations';
import { photoSlotsLeft, photoTogether, whereIs } from './photos';
import { compare, findOverlap, publicProfile, similarity, stretch } from './profile';
import { areFriends, chemistry, ending, isUnpleasant, relationshipWith, toleratedStreak } from './relationships';

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

export function chooseVisit(s: MuseState, free: readonly { readonly state: MuseState }[], now: Instant, draw: Draw): Visit {
  const left = socialLeftMs(s, now);
  if (left <= 0 || photoSlotsLeft(s, now) <= 0) return null;
  const friends = free
    .map((f) => f.state)
    .filter((f) => areFriends(s, f) && socialLeftMs(f, now) > 0 && photoSlotsLeft(f, now) > 0)
    .sort((x, y) => compare(x.seed.id, y.seed.id));
  if (friends.length === 0) return null;

  const rapport = friends.map((f) => relationshipWith(s, f.seed.id)?.rapport ?? 0);
  const closest = Math.max(...rapport);
  const mine = publicProfile(s);
  const weights = friends.map((f, i) => {
    const closeness = (closest > 0 ? rapport[i] / closest : 0) * similarity(mine, publicProfile(f));
    return Math.exp(closeness / SOCIAL.closenessTemperature);
  });
  const friend = pick(friends, weights, draw('visit.friend'));

  const wasGuest = relationshipWith(s, friend.seed.id)?.lastRole === 'guest';
  const role = draw('visit.direction') < (wasGuest ? SOCIAL.goAfterBeingGuest : SOCIAL.goUsually) ? 'guest' : 'host';
  const length = Math.min(visitMs(draw), left, socialLeftMs(friend, now));
  return { other: friend.seed.id, role, until: (now + Math.floor(length)) as Instant };
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
  const rapport = (rel?.rapport ?? 0) + pleasantness;
  if (isUnpleasant(pleasantness, rel) && (rel?.unpleasantStreak ?? 0) + 1 >= toleratedStreak(rapport)) {
    const ended = ending(host, guest, 'drifted-apart');
    return { host: [...hostLog, ...ended.self], guest: [...guestLog, ...ended.other] };
  }

  const sinceInvite = (rel?.rapportSinceInvite ?? 0) + pleasantness;
  const needed = SOCIAL.inviteRapportBase + SOCIAL.inviteRapportSpan * (1 - host.temperament.sociability);
  const cooled = rel?.lastInviteAt == null || now - rel.lastInviteAt >= SOCIAL.inviteCooldownMs;
  const invitation = sinceInvite >= needed && cooled ? invite(host, guest, now) : null;
  return invitation ? { host: [...hostLog, invitation], guest: [...guestLog, invitation] } : { host: hostLog, guest: guestLog };
}
