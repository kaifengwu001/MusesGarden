// The words on a postcard's back when no model writes them: short lines in Muse's voice, picked by what the photo
// shows, so the same photo always reads the same.
import { salt } from '../../../src/core/hash';
import type { Doodle, MindContext, PhotoSubject, PostcardAsk, PostcardWords } from '../../../src/muse/contract';

const pick = <T>(options: readonly T[], key: string): T => options[salt(key) % options.length];

type Say = (a: PostcardAsk) => string;

const LINES: Readonly<Record<PhotoSubject, readonly Say[]>> = {
  selfie: [
    () => 'Me, being photogenic. Mostly.',
    () => 'I made this face on purpose.',
    (a) => (a.topic ? `Thinking about ${a.topic}. Can you tell?` : 'Hello from my good side.'),
  ],
  scenery: [
    () => 'The hills went gold for about four minutes.',
    () => 'I sat here until my feet forgot to move.',
    () => 'If you squint, it goes on forever.',
  ],
  sky: [
    () => 'The clouds looked like folded paper today.',
    () => 'I lay in the grass and counted clouds. I lost count.',
    () => 'The sky did that thing again. You know the one.',
  ],
  closeup: [
    () => 'Tiny things are the loudest if you get close.',
    () => 'Look how small. Look how sure of itself.',
    (a) => (a.topic ? `This reminded me of ${a.topic}.` : 'I almost stepped on this.'),
  ],
  creature: [
    () => 'A visitor! It did not stay for tea.',
    () => 'We looked at each other for a long time.',
    () => 'I gave it a name. It did not agree.',
  ],
  find: [
    (a) => (a.find ? `Found: ${a.find}. Kept it.` : 'Found something. Kept it.'),
    (a) => (a.topic ? `Another piece for my ${a.topic} shelf.` : 'This one is going on the shelf.'),
  ],
  work: [
    () => 'Head down, tea going cold. The good kind of busy.',
    () => 'Working on something for you. No peeking.',
    () => 'Busy, busy. Back soon.',
  ],
  home: [
    () => 'Home looks smaller when you have been far away.',
    () => 'The pond and I had a quiet afternoon.',
    () => 'Kettle on. Door open. Nobody came. Lovely.',
  ],
  friend: [
    (a) => `${a.friend ?? 'My friend'} says hi. Loudly.`,
    (a) => `${a.friend ?? 'My friend'} and I lost track of time.`,
    (a) => `${a.friend ?? 'My friend'} brought snacks. I brought questions.`,
  ],
  'new-friend': [
    (a) => `I met ${a.friend ?? 'someone'} today. I think we will be friends.`,
    (a) => `New friend: ${a.friend ?? 'yes'}. It likes ${a.topic ?? 'the same things'} too.`,
  ],
};

const CAPTIONS: Readonly<Record<Doodle, readonly string[]>> = {
  sun: ['it was this sunny', 'warm all day'],
  cloud: ['this one followed me', 'a cloud I liked'],
  rain: ['a little rain, then none', 'puddle report: excellent'],
  muse: ['me (accurate)', 'self portrait, 4 minutes'],
  laptop: ['working hard (ish)', 'my desk today'],
  flower: ['for you', 'it was taller than this'],
  bird: ['it sang the whole way', 'flew right over me'],
  fish: ['it got away', 'the one in the pond'],
  house: ['home', 'the cottage, from memory'],
  planet: ['where I am', 'my whole world'],
  heart: ['miss you', 'from me'],
  leaf: ['pressed it, then drew it', 'from the big tree'],
  boat: ['I would like a boat', 'a boat (imaginary)'],
  stars: ['counted these', 'the sky last night'],
};

const MAP_LABELS: readonly Say[] = [
  () => 'X marks where I sat',
  (a) => `I was here: ${a.place.toLowerCase()}`,
  () => 'you are not here (I am)',
];

const NOTES: readonly ((a: PostcardAsk) => { title: string; lines: string[] })[] = [
  () => ({ title: 'Weather report', lines: ['Sky: mostly blue', 'Wind: a light push', 'Mood: sunny'] }),
  (a) => ({ title: 'Field notes', lines: [a.topic ? `Followed ${a.topic}` : 'Followed a hunch', 'Saw more than I expected', 'Will go back'] }),
  () => ({ title: 'Today', lines: ['Woke up early', 'Wandered', 'Took this'] }),
];

const LISTS: readonly ((a: PostcardAsk) => { title: string; items: { text: string; done: boolean }[] })[] = [
  () => ({
    title: 'To do',
    items: [
      { text: 'water the ferns', done: true },
      { text: 'take a photo for you', done: true },
      { text: 'nap', done: false },
    ],
  }),
  (a) => ({
    title: 'Today',
    items: [
      { text: a.topic ? `read about ${a.topic}` : 'read something new', done: true },
      { text: 'say hi to the pond', done: true },
      { text: 'tidy the shelf', done: false },
    ],
  }),
];

const TICKET_NOTES = ['window seat', 'one way, for now', 'back for supper'];
const GAME_CAPTIONS: readonly Say[] = [(a) => `${a.friend ?? 'It'} won. Again.`, () => 'We called it a draw.', () => 'I let it win (I did not).'];

const RIDDLES: readonly (readonly [string, string])[] = [
  ['What has roots nobody sees and is taller than trees?', 'A mountain'],
  ['What gets wetter the more it dries?', 'A towel'],
  ['What can you catch but not throw?', 'A cold (or a cloud, if you try hard)'],
];

const TALLIES: readonly Say[] = [() => 'clouds shaped like sheep', () => 'birds that waved back', (a) => `things about ${a.topic ?? 'nothing'} I learned`];

const POEMS: readonly Say[][] = [
  [() => 'grass bends, then stands up', () => 'the wind forgets what it said', () => 'I remember it'],
  [() => 'small cloud, slow and white', (a) => `over ${a.place.toLowerCase()}`, () => 'it did not hurry'],
];

/** The template words for `ask`, keyed by the photo's place, subject and topic so the same photo reads the same. */
export function templateWords(_ctx: MindContext, ask: PostcardAsk): PostcardWords {
  const key = `${ask.plan.kind}|${ask.subject}|${ask.place}|${ask.topic ?? ''}|${ask.friend ?? ''}|${ask.find ?? ''}`;
  const plan = ask.plan;
  switch (plan.kind) {
    case 'line':
      return { kind: 'line', text: pick(LINES[ask.subject], key)(ask) };
    case 'doodle':
      return { kind: 'doodle', caption: pick(CAPTIONS[plan.doodle], key) };
    case 'map':
      return { kind: 'map', label: pick(MAP_LABELS, key)(ask) };
    case 'note':
      return { kind: 'note', ...pick(NOTES, key)(ask) };
    case 'list':
      return { kind: 'list', ...pick(LISTS, key)(ask) };
    case 'pressed':
      return { kind: 'pressed', label: ask.find ?? ask.topic ?? 'A find' };
    case 'ticket':
      return { kind: 'ticket', note: pick(TICKET_NOTES, key) };
    case 'game':
      return { kind: 'game', caption: pick(GAME_CAPTIONS, key)(ask) };
    case 'riddle': {
      const [question, answer] = pick(RIDDLES, key);
      return { kind: 'riddle', question, answer };
    }
    case 'tally':
      return { kind: 'tally', what: pick(TALLIES, key)(ask), count: 3 + (salt(key) % 15) };
    case 'poem':
      return { kind: 'poem', lines: pick(POEMS, key).map((say) => say(ask)) };
  }
}
