import { Vector3 } from 'three';
import closeUrl from '../assets/postcards/close.jpg';
import cottageUrl from '../assets/postcards/cottage.jpg';
import meadowUrl from '../assets/postcards/meadow.jpg';
import pierUrl from '../assets/postcards/pier.jpg';
import terraceUrl from '../assets/postcards/terrace.jpg';
import { tangentToward, travel } from '../planet/geo';
import { art, MOTIF_ASPECT, type Motif } from './art';
import type { GardenSource } from './source';
import type { Basket, Find, GardenEvent, GardenSnapshot, Interest, Media, MediaKind, MuseFriend, Postcard, Reach } from './types';

// The example gallery the garden shows until a backend is plugged in
// (source.ts): ten interests, six baskets of finds over the last ten days
// (reels, posts, articles and a video, every picture a placeholder from
// art.ts, each found somewhere on the planet), Muse's postcards (photographed in the world: two Muses, Muse
// waving), an invitation from a friend, and the friends themselves. Days are
// counted back from today, so the newest basket is always today's.

/** An ISO date `back` days before today (local time). */
export function dayBefore(back: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Topic extends Omit<Interest, 'since'> {
  motif: Motif;
  sinceBack: number;
}

const TOPICS: readonly Topic[] = [
  { id: 'ceramics', name: 'Ceramics', species: 0, variant: 0.25, shared: true, motif: 'clay', sinceBack: 40 },
  { id: 'genart', name: 'Generative art', species: 3, variant: 0.75, shared: true, motif: 'flow', sinceBack: 33 },
  { id: 'light', name: 'Light installations', species: 1, variant: 0.35, shared: true, motif: 'light', sinceBack: 21 },
  { id: 'skiing', name: 'Skiing', species: 1, variant: 0.85, shared: true, motif: 'slope', sinceBack: 14 },
  { id: 'kits', name: 'Model kits', species: 2, variant: 0.3, shared: true, motif: 'kit', sinceBack: 28 },
  { id: 'astronomy', name: 'Astronomy', species: 3, variant: 0.2, shared: true, motif: 'sky', sinceBack: 19 },
  { id: 'noodles', name: 'Noodles', species: 2, variant: 0.8, shared: false, motif: 'noodles', sinceBack: 36 },
  { id: 'ferns', name: 'Ferns', species: 0, variant: 0.8, shared: true, motif: 'fern', sinceBack: 11 },
  { id: 'architecture', name: 'Architecture', species: 0, variant: 0.55, shared: true, motif: 'arch', sinceBack: 9 },
  { id: 'ambient', name: 'Ambient music', species: 3, variant: 0.5, shared: false, motif: 'vinyl', sinceBack: 6 },
];

/**
 * Where Muse went looking, on the meadow's own planet (seed 412, R 128 m): unit directions,
 * each on dry ground. A trip's finds lie a few meters apart round where it looked.
 */
const AREAS = {
  /** The dry hill past the pond, some 80 m from home. */
  hill: [-0.9817, -0.1822, 0.0547],
  /** The pond's far bank, near home. */
  pondBank: [-0.9542, -0.1115, -0.2775],
  /** The wet meadow beyond the hill. */
  wetMeadow: [-0.7688, -0.6267, 0.1272],
  /** A lake shore round the side. */
  lakeShore: [-0.3551, -0.3793, -0.8544],
  /** The far fields, most of the way round. */
  farFields: [0.1075, 0.6837, -0.7218],
  /** The slope west of the cottage. */
  west: [-0.8561, 0.51, 0.0831],
} as const;
type Area = keyof typeof AREAS;
/** The radius the areas' spacing is in meters at (m). */
const AREA_RADIUS = 128;

/** The `n`th find made round an area: on a sunflower spiral out from where Muse looked, 3 m apart or so. */
function foundNear(area: Area, n: number): [number, number, number] {
  const centre = new Vector3(...AREAS[area]).normalize();
  const north = tangentToward(centre, new Vector3(0, 1, 0), new Vector3());
  const side = new Vector3().crossVectors(centre, north);
  const a = n * 2.39996;
  const t = north.multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
  const [x, y, z] = travel(centre, t, (3.2 * Math.sqrt(n)) / AREA_RADIUS, new Vector3()).toArray();
  return [x, y, z];
}

/** One example find: [topic, kind, source, author, title (articles and videos), text, minutes or seconds]. */
type Row = [string, MediaKind, string, string, string | null, string, number?];

/** Each basket's finds and where each was found (`at`, one area per row). */
const BASKETS: ReadonlyArray<{ back: number; title?: string; at: readonly Area[]; rows: Row[] }> = [
  {
    back: 0,
    title: 'Clay and starlight',
    at: ['hill', 'hill', 'hill', 'hill', 'hill'],
    rows: [
      ['ceramics', 'reel', 'Instagram', '@kiln.and.cloud', null, 'Throwing a moon jar in one go. The wobble at 0:14 is the best part.', 24],
      ['astronomy', 'article', 'Nightsky Weekly', 'Ines Okafor', 'Saturn’s rings are tilting edge-on, and they will all but vanish in March', 'Every fifteen years the rings line up with us. Here is when to look, and what you will see instead.', 6],
      ['noodles', 'post', 'Instagram', '@slurp.diaries', null, 'Hand-pulled, ten folds, one very patient grandmother.'],
      ['genart', 'reel', 'Instagram', '@quiet.vectors', null, 'Flow fields, one line per breath. Code in bio.', 31],
      ['ferns', 'post', 'Instagram', '@frondly.pressed', null, 'Pressed a maidenhair this morning. It took the whole week to dry flat.'],
    ],
  },
  {
    back: 1,
    title: 'A long run down',
    at: ['farFields', 'farFields', 'lakeShore', 'lakeShore'],
    rows: [
      ['light', 'reel', 'Instagram', '@halo.rooms', null, 'Walked into this ring of light and forgot what time it was.', 18],
      ['skiing', 'reel', 'Instagram', '@firstchair.club', null, 'First tracks on a bluebird morning.', 22],
      ['architecture', 'article', 'Porch & Plinth', 'Mateo Lindqvist', 'The pink stairs of a seaside town, and the architect who drew them by hand', 'Forty years on, the arches still throw the same hard shadows at noon.', 8],
      ['kits', 'post', 'Instagram', '@runner.and.nipper', null, 'Fresh runners. Do you clip all the parts first, or one at a time?'],
    ],
  },
  {
    back: 2,
    at: ['wetMeadow', 'wetMeadow', 'wetMeadow'],
    rows: [
      ['ceramics', 'post', 'Instagram', '@glaze.lab', null, 'Three pots, one glaze, three kilns.'],
      ['ferns', 'article', 'The Understory', 'Priya Raman', 'Why ferns unfurl the way they do', 'A fiddlehead is a spiral of cells that grow faster on one side, and it starts before spring does.', 5],
      ['ambient', 'video', 'YouTube', 'Tape Garden', 'Four hours of a reel-to-reel loop in the rain', 'Recorded on a porch with the window open.', 241],
    ],
  },
  {
    back: 4,
    at: ['pondBank', 'pondBank', 'west', 'west'],
    rows: [
      ['genart', 'reel', 'Instagram', '@plotter.weather', null, 'A pen plotter drawing tomorrow’s forecast.', 27],
      ['kits', 'post', 'Instagram', '@tiny.hangar', null, 'Panel lining done. Now for the decals.'],
      ['astronomy', 'article', 'Nightsky Weekly', 'Tom Ashby', 'A backyard telescope found a comet nobody had named', 'A retired teacher, a ten-inch mirror and a cloudless November.', 4],
      ['noodles', 'post', 'Instagram', '@broth.club', null, 'Twelve hours of broth for four minutes of noodles.'],
    ],
  },
  {
    back: 6,
    at: ['farFields', 'farFields', 'farFields'],
    rows: [
      ['architecture', 'post', 'Instagram', '@arches.daily', null, 'Noon at the stairs: all shadow, no people.'],
      ['light', 'reel', 'Instagram', '@lumen.field', null, 'Two thousand bulbs in a field at dusk.', 16],
      ['skiing', 'article', 'Powder Notes', 'Hana Sato', 'The quiet return of the small ski hill', 'Rope tows, hot chocolate and a slope you can learn on in a day.', 7],
    ],
  },
  {
    back: 9,
    title: 'The first basket',
    at: ['west', 'west'],
    rows: [
      ['ferns', 'post', 'Instagram', '@frondly.pressed', null, 'The first fern of the spring.'],
      ['ceramics', 'post', 'Instagram', '@kiln.and.cloud', null, 'Bisque firing day.'],
    ],
  },
];

const FRIENDS: ReadonlyArray<Omit<MuseFriend, 'met'> & { metBack: number }> = [
  { id: 'pip', name: 'Pip', coat: '#f2c4a0', shared: ['Ceramics', 'Ferns'], metBack: 12, knownOn: 'instagram' },
  { id: 'juniper', name: 'Juniper', coat: '#c3d6b8', shared: ['Astronomy', 'Skiing'], metBack: 8, knownOn: 'facebook' },
  { id: 'marlo', name: 'Marlo', coat: '#c4d0e6', shared: ['Generative art', 'Light installations'], metBack: 3 },
  { id: 'tofu', name: 'Tofu', coat: '#efe6c8', shared: ['Model kits'], metBack: 20 },
];

const POSTCARDS: ReadonlyArray<Omit<Postcard, 'day'> & { back: number }> = [
  { id: 'pc-close', back: 9, image: closeUrl, place: 'On the doorstep', with: 'pip' },
  { id: 'pc-pier', back: 6, image: pierUrl, place: 'Out on the pier', with: 'juniper' },
  { id: 'pc-meadow', back: 4, image: meadowUrl, place: 'In the long grass', with: 'marlo' },
  { id: 'pc-cottage', back: 2, image: cottageUrl, place: 'Home from the hill', with: 'tofu' },
  { id: 'pc-terrace', back: 0, image: terraceUrl, place: 'Pip came by', with: 'pip' },
  {
    id: 'inv-pip',
    back: 0,
    image: closeUrl,
    place: 'An invitation',
    with: 'pip',
    invitation: { from: 'pip', world: 'mossy-hollow', worldName: 'Mossy Hollow', blurb: 'A redwood grove with a little shrine, where the fog comes in after lunch.' },
  },
];

/** The example gallery, dated from `now`. */
export function placeholderSnapshot(now = new Date()): GardenSnapshot {
  const topics = new Map(TOPICS.map((t) => [t.id, t]));
  const interests: Interest[] = TOPICS.map(({ motif: _motif, sinceBack, ...t }) => ({ ...t, since: dayBefore(sinceBack, now) }));
  const finds: Find[] = [];
  const foundAt = new Map<Area, number>();
  const baskets: Basket[] = BASKETS.map((b, k) => {
    const id = `basket-${dayBefore(b.back, now)}`;
    const ids = b.rows.map(([topic, kind, source, author, title, text, length], i) => {
      const motif = topics.get(topic)?.motif ?? 'clay';
      const media: Media = {
        kind,
        url: `https://example.com/muse/${id}/${i}`,
        source,
        author,
        text,
        image: art(motif),
        aspect: MOTIF_ASPECT[motif],
        published: dayBefore(b.back + 1 + ((i * 3 + k) % 4), now),
      };
      if (title) media.title = title;
      if (kind === 'article') media.minutes = length;
      else if (length) media.duration = length;
      const area = b.at[i];
      const n = foundAt.get(area) ?? 0;
      foundAt.set(area, n + 1);
      const find: Find = { id: `${id}-${i}`, basket: id, topic, media, place: foundNear(area, n), shared: topics.get(topic)?.shared ?? true };
      finds.push(find);
      return find.id;
    });
    return { id, day: dayBefore(b.back, now), finds: ids, ...(b.title ? { title: b.title } : {}) };
  });
  return {
    muse: {
      name: 'Muse',
      soul: 'Curious and a little shy. Likes things made slowly by hand, and anything that glows in the dark.',
      status: { home: true, note: 'At home' },
      reach: 'shared',
    },
    interests,
    friends: FRIENDS.map(({ metBack, ...f }) => ({ ...f, met: dayBefore(metBack, now) })),
    baskets,
    finds,
    postcards: POSTCARDS.map(({ back, ...p }) => ({ ...p, day: dayBefore(back, now) })),
  };
}

export interface PlaceholderSource extends GardenSource {
  /** Pretend the backend pushed something (the dev harness and the demos use it). */
  push(event: GardenEvent): void;
}

export function placeholderSource(): PlaceholderSource {
  const listeners = new Set<(event: GardenEvent) => void>();
  // The friend group, kept as a backend keeps it: a friend tagged with a network stands for the Instagram and Facebook
  // layer, the rest for the people the owner shared Muse with.
  let reach: Reach = 'shared';
  return {
    load: () => {
      const s = placeholderSnapshot();
      return Promise.resolve({ ...s, muse: { ...s.muse, reach }, friends: s.friends.filter((f) => reach !== 'shared' || !f.knownOn) });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    react: (reaction) => {
      if (reaction.type === 'set-reach') reach = reaction.reach;
      return Promise.resolve();
    },
    push(event) {
      for (const listener of listeners) listener(event);
    },
  };
}
