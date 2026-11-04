// What Muse puts on the back of a postcard: the kind of back and its drawing, from what the photo shows and Muse's
// temperament. The mind writes the words (Mind.writePostcard); nothing here reads them back.
import type { Doodle, Draw, MuseState, PhotoSpec, PhotoSubject, PostcardBackKind, PostcardPlan, Temperament } from '../../../src/muse/contract';
import { categorical } from '../rng';

/** Each kind's pull for a Muse of this temperament, or 0 when the photo can't carry it. */
const PULL: Readonly<Record<PostcardBackKind, (t: Temperament, p: PhotoSpec) => number>> = {
  line: (t) => 1.2 + t.sociability,
  doodle: (t) => 0.4 + 1.6 * t.whimsy,
  map: (t, p) => (p.context === 'planet' && p.companions.length === 0 ? 0.2 + 1.4 * t.novelty : 0),
  note: (t) => 0.3 + 1.2 * t.focus,
  list: (t, p) => (p.subject === 'work' || p.subject === 'home' ? 0.6 + 1.6 * t.focus : 0.2 + 0.8 * t.focus),
  pressed: (t, p) => (p.discoveryId ? 1 + 2 * t.curiosity : 0),
  ticket: (_t, p) => (p.context === 'beyond' ? 3 : 0),
  game: (t, p) => (p.companions.length > 0 ? 0.6 + 2 * t.sociability : 0),
  riddle: (t) => 0.1 + 1.2 * t.whimsy * t.curiosity,
  tally: (t, p) => (p.subject === 'sky' || p.subject === 'creature' || p.subject === 'closeup' ? 0.3 + t.curiosity : 0.1),
  poem: (t) => 0.2 + 0.9 * (1 - t.sociability) * (0.5 + t.whimsy),
};

const KINDS = Object.keys(PULL) as PostcardBackKind[];

/** The drawings that fit each subject; a photo from beyond the planet draws the planet or the stars. */
const DOODLES: Readonly<Record<PhotoSubject, readonly Doodle[]>> = {
  selfie: ['muse', 'heart', 'sun'],
  scenery: ['sun', 'house', 'boat', 'cloud', 'leaf'],
  sky: ['cloud', 'sun', 'bird', 'rain', 'stars'],
  closeup: ['flower', 'leaf', 'heart'],
  creature: ['bird', 'fish', 'heart'],
  find: ['flower', 'leaf', 'heart', 'stars'],
  work: ['laptop', 'muse', 'stars'],
  home: ['house', 'fish', 'heart', 'cloud'],
  friend: ['heart', 'muse', 'sun'],
  'new-friend': ['heart', 'muse', 'stars'],
};
const BEYOND_DOODLES: readonly Doodle[] = ['planet', 'stars', 'muse'];

const pickOf = <T>(items: readonly T[], u: number): T => items[Math.min(items.length - 1, Math.floor(u * items.length))];

/** A finished game of noughts and crosses, 'x' being Muse: a few moves each, then a line or a full board. */
export function gameBoard(u: (k: number) => number): string {
  const cells = Array.from({ length: 9 }, () => '.');
  const free = (): number[] => cells.flatMap((c, i) => (c === '.' ? [i] : []));
  for (let move = 0; move < 9; move++) {
    const open = free();
    if (open.length === 0 || won(cells)) break;
    cells[pickOf(open, u(move))] = move % 2 === 0 ? 'x' : 'o';
  }
  return cells.join('');
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

function winner(cells: readonly string[]): string | null {
  const line = LINES.find(([a, b, c]) => cells[a] !== '.' && cells[a] === cells[b] && cells[b] === cells[c]);
  return line ? cells[line[0]] : null;
}

const won = (cells: readonly string[]): boolean => winner(cells) !== null;

/** How a board ended for Muse, who plays 'x'. */
export function gameOutcome(board: string): 'won' | 'lost' | 'draw' {
  const w = winner([...board]);
  return w === 'x' ? 'won' : w === 'o' ? 'lost' : 'draw';
}

/** The back of `photo`: its kind by the photo and Muse's temperament, and what the kind needs settled. */
export function postcardPlan(s: MuseState, photo: PhotoSpec, draw: Draw): PostcardPlan {
  const key = `back:${photo.id}`;
  const weights = KINDS.map((k) => PULL[k](s.temperament, photo));
  const kind = KINDS[Math.max(0, categorical(draw(key, 0), weights))];
  return planOf(kind, s, photo, draw);
}

/** The kinds of back `photo` can carry: a map needs Muse alone on a planet, a pressed find a find, a game a friend. */
export function kindsFor(photo: PhotoSpec): readonly PostcardBackKind[] {
  const anyone: Temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };
  return KINDS.filter((k) => PULL[k](anyone, photo) > 0);
}

/** What a back of `kind` needs settled for `photo`; a kind the photo can't carry falls back to a line. */
export function planOf(kind: PostcardBackKind, s: MuseState, photo: PhotoSpec, draw: Draw): PostcardPlan {
  const key = `back:${photo.id}`;
  switch (kind) {
    case 'doodle':
      return { kind, doodle: pickOf(photo.context === 'beyond' ? BEYOND_DOODLES : DOODLES[photo.subject], draw(key, 1)) };
    case 'map':
      return { kind, dir: photo.dir };
    case 'pressed':
      return photo.discoveryId ? { kind, find: photo.discoveryId } : { kind: 'line' };
    case 'ticket':
      return { kind, from: `${s.seed.name}’s planet`, to: 'Outside the planet' };
    case 'game': {
      const friend = photo.companions.at(0);
      return friend ? { kind, friend, board: gameBoard((k) => draw(key, 10 + k)) } : { kind: 'line' };
    }
    default:
      return { kind };
  }
}
