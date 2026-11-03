// Photos: a Poisson process per activity, scaled by whimsy, inside a daily cap that leaves room for the
// hangout photos the social policy guarantees.
import type { Activity, Dir, Draw, MuseState, PhotoSpec, PhotoSubject, Place, Temperament } from '../../../src/muse/contract';
import { homePlace, placeNow } from '../atlas';
import { instant, photoId } from '../ids';
import { categorical, exponential } from '../rng';
import { HOUR_MS, localDay } from '../time';
import { socialBudget } from './life';
import { PHOTO_DAILY_CAP, PHOTO_RATE_PER_HOUR, VISIT_MEDIAN_MS } from './constants';

type Context = Activity | 'work';

/** What Muse photographs in each context before its temperament tips the balance (TASTE). */
const SUBJECTS: Record<Context, readonly (readonly [PhotoSubject, number])[]> = {
  beyond: [
    ['scenery', 0.5],
    ['sky', 0.2],
    ['selfie', 0.3],
  ],
  travel: [
    ['find', 0.3],
    ['scenery', 0.2],
    ['sky', 0.12],
    ['closeup', 0.15],
    ['creature', 0.1],
    ['selfie', 0.13],
  ],
  rest: [
    ['home', 0.25],
    ['scenery', 0.15],
    ['sky', 0.2],
    ['closeup', 0.15],
    ['creature', 0.12],
    ['selfie', 0.13],
  ],
  work: [
    ['work', 0.7],
    ['selfie', 0.15],
    ['home', 0.15],
  ],
  visit: [],
};

/** What two Muses photograph when they spend time together: mostly the two of them, sometimes what they looked at. */
const TOGETHER: readonly (readonly [PhotoSubject, number])[] = [
  ['friend', 0.5],
  ['scenery', 0.15],
  ['sky', 0.12],
  ['closeup', 0.08],
  ['creature', 0.08],
  ['home', 0.07],
];

/** How strongly a subject draws a Muse of this temperament, in [0, 1]; a subject's weight is scaled by 0.4 + 1.2 × it. */
const TASTE: Readonly<Record<PhotoSubject, (t: Temperament) => number>> = {
  scenery: (t) => t.novelty,
  sky: (t) => (t.whimsy + t.novelty) / 2,
  closeup: (t) => (t.focus + t.curiosity) / 2,
  creature: (t) => t.curiosity,
  find: (t) => t.curiosity,
  selfie: (t) => (t.whimsy + t.sociability) / 2,
  work: (t) => t.focus,
  home: (t) => 1 - t.novelty,
  friend: (t) => t.sociability,
  'new-friend': (t) => t.sociability,
};

/** The subjects a Muse of temperament `t` photographs in `context`, weighted by its taste. */
export function subjectMix(t: Temperament, mix: readonly (readonly [PhotoSubject, number])[]): (readonly [PhotoSubject, number])[] {
  return mix.map(([subject, w]) => [subject, w * (0.4 + 1.2 * TASTE[subject](t))] as const);
}

/** What a hangout's photo shows, by both Muses' tastes: one photo, the same in both logs. */
export function togetherSubject(a: Temperament, b: Temperament, u: number): PhotoSubject {
  const both = subjectMix(a, TOGETHER).map(([subject, w], i) => [subject, w + subjectMix(b, TOGETHER)[i][1]] as const);
  return both[Math.max(0, categorical(u, both.map(([, w]) => w)))][0];
}

const ZOOM: Record<PhotoSubject, number> = {
  selfie: 0.9,
  find: 0.95,
  creature: 0.85,
  scenery: 0.4,
  sky: 0.3,
  closeup: 0.98,
  work: 0.9,
  home: 0.6,
  friend: 0.8,
  'new-friend': 0.8,
};
/** Beyond the planet, the photo looks back at the whole of it. */
const BEYOND_ZOOM = 0.05;

/** Photos already delivered on `day`: the event day, which is when the owner receives them. */
function photosOn(s: MuseState, day: string): number {
  return s.day.day === day ? s.day.photos : 0;
}

/** Slots left on `day` for photos of Muse's own, after one is set aside for each hangout today's social time still allows. */
function allowance(s: MuseState, day: string): number {
  const hasFriend = [...s.social.relationships.values()].some((r) => r.status === 'friends');
  const socialLeft = Math.max(0, socialBudget(s) - (s.day.day === day ? s.day.socialMs : 0));
  const reserved = hasFriend ? Math.ceil(socialLeft / VISIT_MEDIAN_MS) : 0;
  return PHOTO_DAILY_CAP - reserved - photosOn(s, day);
}

function tangent(dir: Dir, angle: number): Dir {
  const [x, y, z] = dir;
  const ref: Dir = Math.abs(y) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const tx = y * ref[2] - z * ref[1];
  const ty = z * ref[0] - x * ref[2];
  const tz = x * ref[1] - y * ref[0];
  const tl = Math.hypot(tx, ty, tz);
  const t: Dir = [tx / tl, ty / tl, tz / tl];
  const b: Dir = [y * t[2] - z * t[1], z * t[0] - x * t[2], x * t[1] - y * t[0]];
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return [c * t[0] + sn * b[0], c * t[1] + sn * b[1], c * t[2] + sn * b[2]];
}

function where(s: MuseState, context: Context, draw: Draw): Place | null {
  if (context === 'beyond') return homePlace(s.seed.worldSeed);
  return placeNow(s, draw);
}

/** Photos taken while doing `context` over [from, to). Hangout and new-friend photos come from the social policy. */
export function photosDuring(s: MuseState, context: Context, from: number, to: number, draw: Draw): readonly PhotoSpec[] {
  const rate = PHOTO_RATE_PER_HOUR[context] * s.temperament.whimsy;
  const place = rate > 0 && to > from ? where(s, context, draw) : null;
  if (!place) return [];
  const lastKept = s.episode?.lastKept ?? null;
  const subjects = subjectMix(s.temperament, SUBJECTS[context]).filter(([subject]) => subject !== 'find' || lastKept !== null);
  const taken = new Map<string, number>();
  const out: PhotoSpec[] = [];
  // The kind carries `from` so successive intervals of one episode draw fresh photo times.
  const kind = `photo@${from}`;
  let at = from;
  for (let k = 0; k < 1000; k++) {
    at += exponential(draw(kind, k), rate) * HOUR_MS;
    if (at >= to) break;
    const day = localDay(to, s.seed.timezone);
    if ((taken.get(day) ?? 0) >= allowance(s, day)) continue;
    taken.set(day, (taken.get(day) ?? 0) + 1);
    const subject = subjects[Math.max(0, categorical(draw(`${kind}.subject`, k), subjects.map(([, w]) => w)))][0];
    const when = Math.floor(at);
    out.push({
      id: photoId(s.seed.id, s.episode?.n ?? 0, when, k),
      at: instant(when),
      subject,
      context: context === 'beyond' ? 'beyond' : 'planet',
      planetOf: s.seed.id,
      dir: place.dir,
      forward: tangent(place.dir, 2 * Math.PI * draw(`${kind}.facing`, k)),
      zoom: context === 'beyond' ? BEYOND_ZOOM : ZOOM[subject],
      companions: [],
      ...(subject === 'find' && lastKept ? { discoveryId: lastKept } : {}),
    });
  }
  return out;
}
