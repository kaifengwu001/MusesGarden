// Typed sample responses for every GET in the Muse API. The overlay (lane C) builds against these before the
// server exists, and the HTTP lane's fake GardenQueries serves them. The compiler checks them against the contract.
import type {
  BasketId,
  BasketView,
  CanonicalUrl,
  Dir,
  DiscoveryId,
  Instant,
  InvitationCard,
  InvitationId,
  MetricsRow,
  MindView,
  MuseId,
  NowView,
  Page,
  PhotoId,
  PhotoView,
  PlantCard,
  RegionKey,
  SharingView,
  ShelfView,
  TopicKey,
  VisitWorldView,
  WorldView,
} from './contract';

const muse = (s: string) => s as MuseId;
const topic = (s: string) => s as TopicKey;
const region = (s: string) => s as RegionKey;
const plant = (s: string) => s as DiscoveryId;
const at = (iso: string) => Date.parse(iso) as Instant;
const wiki = (title: string) => `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` as CanonicalUrl;
const dir = (x: number, y: number, z: number): Dir => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
};

export const HERO = muse('hero');
export const WREN = muse('wren');
export const JUNIPER = muse('juniper');

const NOW = at('2026-11-04T15:20:00-08:00');

export const sampleCards: readonly PlantCard[] = [
  {
    id: plant('d-botanical-illustration'),
    title: 'Botanical illustration',
    url: wiki('Botanical illustration'),
    summary:
      'Botanical illustration is the art of depicting the form, color, and details of plant species, frequently in watercolor paintings.',
    thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/sample-botanical.jpg/320px-sample-botanical.jpg',
    reason: 'These drawings have to be true and beautiful at once. I want to know how they managed both.',
    foundAt: at('2026-11-02T10:40:00-08:00'),
    place: { dir: dir(0.42, 0.85, 0.31), region: region('2:1:2') },
  },
  {
    id: plant('d-pigment'),
    title: 'Pigment',
    url: wiki('Pigment'),
    summary: 'A pigment is a powder used to add or alter color or change visual appearance.',
    reason: 'Every colour in those plates came from something ground up. I want to know what.',
    foundAt: at('2026-11-02T11:20:00-08:00'),
    place: { dir: dir(0.45, 0.83, 0.33), region: region('2:1:2') },
  },
  {
    id: plant('d-ultramarine'),
    title: 'Ultramarine',
    url: wiki('Ultramarine'),
    summary: 'Ultramarine is a deep blue color pigment originally made by grinding lapis lazuli into a powder.',
    reason: 'The blue cost more than gold. Painters saved it for the robes that mattered most.',
    foundAt: at('2026-11-02T12:05:00-08:00'),
    place: { dir: dir(0.49, 0.8, 0.35), region: region('2:2:2') },
  },
];

export const sampleNowExploring: NowView = {
  museId: HERO,
  name: 'Moss',
  at: NOW,
  activity: 'travel',
  working: false,
  sleeping: false,
  since: at('2026-11-04T14:50:00-08:00'),
  until: null,
  label: 'Exploring: Pigment → Ultramarine',
  path: [
    { dir: dir(0.1, 0.99, 0.05), at: at('2026-11-04T14:50:00-08:00') },
    { dir: dir(0.45, 0.83, 0.33), at: at('2026-11-04T14:50:00-08:00'), transport: true },
    { dir: dir(0.49, 0.8, 0.35), at: at('2026-11-04T15:30:00-08:00') },
  ],
  companion: null,
  away: null,
};

export const sampleNowWorking: NowView = {
  ...sampleNowExploring,
  working: true,
  label: 'Working (laptop out)',
};

export const sampleNowAway: NowView = {
  ...sampleNowExploring,
  activity: 'visit',
  label: "Away at Wren's planet",
  until: at('2026-11-04T16:10:00-08:00'),
  path: null,
  away: { kind: 'planet', of: WREN, name: 'Wren' },
};

export const sampleNowBeyond: NowView = {
  ...sampleNowExploring,
  activity: 'beyond',
  label: 'Gone beyond the planet',
  until: at('2026-11-04T16:50:00-08:00'),
  path: null,
  away: { kind: 'beyond' },
};

export const sampleNowHosting: NowView = {
  ...sampleNowExploring,
  activity: 'visit',
  label: 'Juniper is visiting',
  until: at('2026-11-04T16:10:00-08:00'),
  path: [{ dir: dir(0.1, 0.99, 0.05), at: at('2026-11-04T15:20:00-08:00') }],
  companion: { museId: JUNIPER, name: 'Juniper' },
};

export const sampleNowNapping: NowView = {
  ...sampleNowExploring,
  activity: 'rest',
  sleeping: true,
  label: 'Napping',
  until: at('2026-11-04T17:00:00-08:00'),
  path: [{ dir: dir(0.1, 0.99, 0.05), at: at('2026-11-04T15:20:00-08:00') }],
};

export const sampleWorld: WorldView = {
  museId: HERO,
  worldSeed: 412,
  g: 0.18,
  regions: [
    { key: region('2:1:1'), fogged: false, topics: [] },
    {
      key: region('2:1:2'),
      fogged: false,
      topics: [
        { topic: topic('Botanical illustration'), label: 'Botanical illustration' },
        { topic: topic('Pigment'), label: 'Pigment' },
      ],
    },
    { key: region('2:2:2'), fogged: false, topics: [{ topic: topic('Ultramarine'), label: 'Ultramarine' }] },
    { key: region('2:2:1'), fogged: true },
    { key: region('5:0:3'), fogged: false, topics: [{ topic: topic('Tide'), label: 'Tide' }] },
  ],
  plants: sampleCards.map((c, i) => ({
    id: c.id,
    dir: c.place.dir,
    topic: topic(c.title),
    foundAt: c.foundAt,
    sent: i < 2,
    preview: { title: c.title, ...(c.thumb ? { thumb: c.thumb } : {}), reason: c.reason },
  })),
};

export const sampleBaskets: Page<BasketView, BasketId> = {
  items: [
    { id: 'b-2026-11-03' as BasketId, at: at('2026-11-03T09:12:00-08:00'), items: sampleCards },
    { id: 'b-2026-10-31' as BasketId, at: at('2026-10-31T18:40:00-08:00'), items: sampleCards.slice(0, 1) },
  ],
  next: null,
};

export const samplePhotos: Page<PhotoView, PhotoId> = {
  items: [
    {
      id: 'p-hangout-1' as PhotoId,
      at: at('2026-11-03T16:00:00-08:00'),
      subject: 'friend',
      context: 'planet',
      planetOf: WREN,
      dir: dir(-0.3, 0.9, 0.3),
      forward: dir(0.9, 0.3, 0.0),
      zoom: 0.8,
      companions: [WREN],
      worldSeed: 2207,
      g: 0.3,
      companionNames: ['Wren'],
    },
    {
      id: 'p-selfie-1' as PhotoId,
      at: at('2026-11-02T12:10:00-08:00'),
      subject: 'find',
      context: 'planet',
      planetOf: HERO,
      dir: dir(0.49, 0.8, 0.35),
      forward: dir(0.0, -0.4, 0.9),
      zoom: 0.9,
      companions: [],
      discoveryId: plant('d-ultramarine'),
      worldSeed: 412,
      g: 0.18,
      companionNames: [],
    },
  ],
  next: null,
};

export const sampleShelf: ShelfView = {
  items: sampleCards.map((c, i) => ({ ...c, fondness: 0.9 - i * 0.1 })),
};

const INVITE = 'inv-wren-hero-1' as InvitationId;

export const sampleInvitations: readonly InvitationCard[] = [
  {
    id: INVITE,
    role: 'guest',
    otherName: 'Wren',
    state: 'used',
    sentAt: at('2026-11-03T16:05:00-08:00'),
    usedAt: at('2026-11-05T15:00:00-08:00'),
    actions: [],
    canVisitNow: false,
  },
  {
    id: 'inv-hero-juniper-1' as InvitationId,
    role: 'host',
    otherName: 'Juniper',
    state: 'sent',
    sentAt: at('2026-11-04T11:20:00-08:00'),
    usedAt: null,
    actions: ['withdraw'],
    canVisitNow: false,
  },
];

export const sampleVisit: VisitWorldView = {
  invitation: INVITE,
  host: { museId: WREN, name: 'Wren' },
  worldSeed: 2207,
  g: 0.3,
  regions: [
    { key: region('0:2:2'), fogged: false, topics: [{ topic: topic('Lichen'), label: 'Lichen' }] },
    { key: region('0:2:3'), fogged: true },
  ],
  plants: [
    {
      id: plant('w-lichen'),
      dir: dir(0.9, 0.2, 0.38),
      preview: { title: 'Lichen', reason: 'Two living things sharing one body.' },
      card: { ...sampleCards[0], id: plant('w-lichen'), title: 'Lichen', url: wiki('Lichen'), reason: 'Two living things sharing one body.' },
    },
    { id: plant('w-private'), dir: dir(0.88, 0.25, 0.4), preview: null, card: null },
  ],
  until: at('2026-11-05T17:00:00-08:00'),
};

export const sampleSharing: SharingView = {
  interests: [
    { topic: topic('Botanical illustration'), label: 'Botanical illustration', hidden: false },
    { topic: topic('Tide'), label: 'Tide', hidden: true },
  ],
  finds: sampleCards.map((c) => ({ id: c.id, title: c.title, hidden: false })),
  friends: [
    { museId: WREN, name: 'Wren', origin: 'introduced' },
    { museId: JUNIPER, name: 'Juniper', origin: 'met-beyond' },
  ],
  shareCode: 'MOSS-7Q2K',
  basketTime: null,
};

export const sampleMetrics: readonly MetricsRow[] = [
  { day: '2026-11-02', finds: 5, newAreas: 2, revisits: 1, trips: 6, photos: 3, restHours: 2.5, socialHours: 0.8, workHours: 0, ownerDrivenShare: 0.67 },
  { day: '2026-11-03', finds: 2, newAreas: 1, revisits: 2, trips: 3, photos: 4, restHours: 4, socialHours: 1.6, workHours: 7.5, ownerDrivenShare: 0.5 },
];

export const sampleMind: MindView = {
  museId: HERO,
  temperament: { curiosity: 0.6, focus: 0.7, sociability: 0.5, whimsy: 0.6, novelty: 0.5 },
  soulVersion: 2,
  interests: [
    {
      topic: topic('Botanical illustration'),
      label: 'Botanical illustration',
      region: region('2:1:2'),
      salience: { value: 0.6, at: at('2026-11-04T12:00:00-08:00') },
      salienceNow: 0.57,
      affinity: 0.35,
      stage: 'emerging',
      sources: [wiki('Botanical illustration'), wiki('Herbarium')],
      lastPursued: at('2026-11-04T12:00:00-08:00'),
      seededBy: 'owner-memory',
      ownerMentionAt: at('2026-11-02T08:00:00-08:00'),
    },
    {
      topic: topic('Ultramarine'),
      label: 'Ultramarine',
      region: region('2:2:2'),
      salience: { value: 0.8, at: at('2026-11-04T15:00:00-08:00') },
      salienceNow: 0.79,
      affinity: 0.2,
      stage: 'hypothesis',
      sources: [wiki('Ultramarine')],
      lastPursued: at('2026-11-04T15:00:00-08:00'),
      seededBy: 'muse',
      ownerMentionAt: null,
    },
  ],
  questions: [
    {
      id: 'q-1' as MindView['questions'][number]['id'],
      topic: topic('Ultramarine'),
      text: 'How did painters afford ultramarine before the synthetic kind?',
      openedAt: at('2026-11-04T12:05:00-08:00'),
    },
  ],
  relationships: [
    {
      other: WREN,
      name: 'Wren',
      status: 'friends',
      origin: 'introduced',
      friendsSince: at('2026-11-01T05:00:00-08:00'),
      familiarity: 0,
      rapport: 2.4,
      rapportSinceInvite: 0.6,
      unpleasantStreak: 0,
      distance: 0,
      encounters: 0,
      hangouts: 4,
      lastRole: 'guest',
      lastMetAt: at('2026-11-03T16:00:00-08:00'),
      lastInviteAt: at('2026-11-03T16:00:00-08:00'),
      fondness: 1,
    },
  ],
  reflections: [],
};

export const sampleSoulMd = `## What I've been into

- **Botanical illustration** (emerging). Two sources, first found 2 Nov.
- **Ultramarine** (hypothesis). The blue that cost more than gold.

Lately I keep following colours back to the stones they were ground from.
`;

export const sampleJournalMd = `## 4 November

- 14:50 Went looking at pigments again. Kept *Ultramarine*.
- 15:20 Took a photo of the new patch.
`;

export const sampleMuses = [
  { museId: HERO, name: 'Moss', role: 'hero' as const },
  { museId: WREN, name: 'Wren', role: 'friend' as const },
  { museId: JUNIPER, name: 'Juniper', role: 'stranger' as const },
];
