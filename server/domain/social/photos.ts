import { hash32, salt, unit } from '../../../src/core/hash';
import type { Dir, Draw, Instant, MuseEventBody, MuseId, MuseState, PhotoId, PhotoSpec } from '../../../src/muse/contract';
import { PHOTO_DAILY_CAP } from '../policy/constants';
import { localClock } from './clock';
import { compare } from './profile';

function normalize(x: number, y: number, z: number): Dir {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

export function hashedDir(key: string): Dir {
  const h = salt(key);
  const z = 2 * unit(h) - 1;
  const phi = 2 * Math.PI * unit(hash32(h));
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), z, r * Math.sin(phi)];
}

function tangentAt(dir: Dir, draw: Draw): Dir {
  const [dx, dy, dz] = dir;
  for (let k = 0; k < 4; k++) {
    const v = [0, 1, 2].map((i) => 2 * draw('photo.forward', 3 * k + i) - 1) as [number, number, number];
    const along = v[0] * dx + v[1] * dy + v[2] * dz;
    const t = [v[0] - along * dx, v[1] - along * dy, v[2] - along * dz] as const;
    if (Math.hypot(...t) > 1e-3) return normalize(...t);
  }
  return Math.abs(dy) < 0.9 ? normalize(-dz, 0, dx) : normalize(0, dz, -dy);
}

export function whereIs(s: MuseState): Dir {
  const current = s.episode?.lastKept ? s.discoveries.get(s.episode.lastKept) : undefined;
  if (current) return current.place.dir;
  let latest = null as { at: number; id: string; dir: Dir } | null;
  for (const d of s.discoveries.values()) {
    if (!latest || d.at > latest.at || (d.at === latest.at && compare(d.id, latest.id) > 0)) latest = { at: d.at, id: d.id, dir: d.place.dir };
  }
  return latest ? latest.dir : hashedDir(s.seed.id);
}

export function photoTogether(
  subject: 'friend' | 'new-friend',
  a: MuseId,
  b: MuseId,
  where: Pick<PhotoSpec, 'context' | 'planetOf' | 'dir' | 'zoom'>,
  now: Instant,
  draw: Draw,
): { readonly id: PhotoId; readonly a: MuseEventBody; readonly b: MuseEventBody } {
  const pair = [a, b].sort(compare).join('+');
  const id = `photo:${subject}:${pair}:${now}` as PhotoId;
  const base = { id, at: now, subject, ...where, forward: tangentAt(where.dir, draw) };
  const taken = (companion: MuseId): MuseEventBody => ({ kind: 'photo.taken', photo: { ...base, companions: [companion] } satisfies PhotoSpec });
  return { id, a: taken(b), b: taken(a) };
}

/**
 * Photo slots left on today's delivery day. A hangout or a new friendship always comes with a photo, and Muse sends
 * at most PHOTO_DAILY_CAP a day, so neither starts without a slot for its photo.
 */
export function photoSlotsLeft(s: MuseState, now: Instant): number {
  const sent = s.day.day === localClock(now, s.seed.timezone).day ? s.day.photos : 0;
  return PHOTO_DAILY_CAP - sent;
}
