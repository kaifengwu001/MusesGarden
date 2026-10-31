// Photos: a Poisson process per activity, scaled by whimsy, inside a daily cap that leaves room for the
// hangout photos the social policy guarantees.
import type { Activity, Dir, Draw, MuseState, PhotoSpec, PhotoSubject, Place } from '../../../src/muse/contract';
import { homePlace, placeNow } from '../atlas';
import { instant, photoId } from '../ids';
import { categorical, exponential } from '../rng';
import { HOUR_MS, localDay } from '../time';
import { socialBudget } from './life';
import { PHOTO_DAILY_CAP, PHOTO_RATE_PER_HOUR, VISIT_MEDIAN_MS } from './constants';

type Context = Activity | 'work';

const SUBJECTS: Record<Context, readonly (readonly [PhotoSubject, number])[]> = {
  beyond: [
    ['selfie', 0.4],
    ['scenery', 0.6],
  ],
  travel: [
    ['find', 0.35],
    ['scenery', 0.3],
    ['creature', 0.2],
    ['selfie', 0.15],
  ],
  rest: [
    ['scenery', 0.4],
    ['creature', 0.3],
    ['selfie', 0.3],
  ],
  work: [['selfie', 1]],
  visit: [],
};

const ZOOM: Record<PhotoSubject, number> = { selfie: 0.9, find: 0.95, creature: 0.85, scenery: 0.4, friend: 0.8, 'new-friend': 0.8 };
/** Beyond the planet, the photo looks back at the whole of it. */
const BEYOND_ZOOM = 0.05;

function photosOn(s: MuseState, day: string): number {
  return s.photos.filter((p) => localDay(p.at, s.seed.timezone) === day).length;
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
  const subjects = SUBJECTS[context].filter(([subject]) => subject !== 'find' || lastKept !== null);
  const taken = new Map<string, number>();
  const out: PhotoSpec[] = [];
  // The kind carries `from` so successive intervals of one episode draw fresh photo times.
  const kind = `photo@${from}`;
  let at = from;
  for (let k = 0; k < 1000; k++) {
    at += exponential(draw(kind, k), rate) * HOUR_MS;
    if (at >= to) break;
    const day = localDay(at, s.seed.timezone);
    if ((taken.get(day) ?? 0) >= allowance(s, day)) continue;
    taken.set(day, (taken.get(day) ?? 0) + 1);
    const subject = subjects[Math.max(0, categorical(draw(`${kind}.subject`, k), subjects.map(([, w]) => w)))][0];
    const when = Math.floor(at);
    out.push({
      id: photoId(s.seed.id, s.episode?.n ?? 0, when, k),
      at: instant(when),
      subject,
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
