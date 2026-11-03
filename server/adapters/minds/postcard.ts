// The words on a postcard's back when no model writes them: short, cute, a little funny, in Muse's voice. Each kind
// has a pool, and a pick passes over anything the Muse wrote lately (ask.recent), so it never says the same thing
// twice in a row of postcards; the same photo always reads the same.
import { salt } from '../../../src/core/hash';
import type { Doodle, MindContext, PhotoSubject, PostcardAsk, PostcardWords } from '../../../src/muse/contract';
import { tooClose, wordsOf } from '../../domain/postcardWords';
import { BACK_LIMITS } from './prompts/postcard';

/** A topic or a find's title can be long: cut at a word, so the words still fit the card. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

type Say = (a: PostcardAsk) => string;
const friend = (a: PostcardAsk) => a.friend ?? 'My friend';

const LINES: Readonly<Record<PhotoSubject, readonly Say[]>> = {
  selfie: [
    () => 'Took 14 selfies. This is the one where my ears behave.',
    () => 'Me, pretending I didn’t just fall over.',
    () => 'My good side is both sides. I checked.',
    () => 'A bee photobombed the first one. This is take two.',
    (a) => (a.topic ? `My ${a.topic} thinking face. Very serious. Do not laugh.` : 'My thinking face. Very serious. Do not laugh.'),
    () => 'The wind did my fur. I did the smile.',
    () => 'Proof I was here. And fluffy.',
    () => 'Asked the pond what it thought of me. It rippled. I’ll take it.',
  ],
  scenery: [
    () => 'The hills held still for one photo, then went back to being hills.',
    () => 'I named this view Gerald. Gerald is very large.',
    () => 'Sat here so long a ladybird moved onto my knee.',
    () => 'This view cost me a whole afternoon and one sock.',
    () => 'The lake was showing off, so I let it.',
    () => 'Walked to the edge of the map. The map was wrong. It’s lovely here.',
    () => 'Counted every hill. Got to four, then lost my place.',
    () => 'If you squint, it goes on forever. I squinted for an hour.',
  ],
  sky: [
    () => 'That cloud looked like a teapot, so I waited for it to pour.',
    () => 'The sky did its blue thing again. Show-off.',
    () => 'A cloud followed me home. I’m calling it Biscuit.',
    () => 'Argued with a cloud about its shape. The cloud won.',
    () => 'Birds overhead in a V. I think it stands for very far.',
    () => 'Tried to touch the sky. Jumped twice. Close.',
    () => 'Weather report: one cloud, very fluffy, slightly suspicious.',
    () => 'Looked up so long I forgot which way was down.',
  ],
  closeup: [
    () => 'This flower is smaller than my thumb and much braver.',
    () => 'Up close, grass is a jungle with excellent manners.',
    () => 'A beetle and I had a staring contest. I blinked.',
    () => 'I almost stepped on this, then apologised for ten minutes.',
    (a) => (a.topic ? `Crouched down. Found ${a.topic} hiding in the grass.` : 'Crouched down. Found a whole tiny city.'),
    () => 'Counted the petals twice. Six. The second time I got seven.',
    () => 'Smelled it so hard I sneezed. Worth it.',
    () => 'A drop of dew was wearing this flower like a hat.',
  ],
  creature: [
    () => 'A visitor! It did not stay for tea. Rude.',
    () => 'I named it Pudding. It does not answer to Pudding.',
    () => 'We stared at each other for a long time. It blinked first. I think.',
    () => 'A butterfly sat on my nose and I have never been so still.',
    () => 'This bird sings the same three notes. I learned them. We’re a band now.',
    () => 'It ran away. I’m choosing to believe it was shy.',
    () => 'Followed a frog for an hour. The frog had places to be.',
    () => 'Two ducks, one opinion, very loud.',
  ],
  find: [
    (a) => (a.find ? `Found: ${a.find}. Already told the pond.` : 'Found something. Already told the pond.'),
    (a) => (a.topic ? `One more for the ${a.topic} shelf. The shelf is groaning.` : 'This is going on the shelf. The shelf is groaning.'),
    () => 'I didn’t find this. It found me. Then I found it again.',
    () => 'Picked it up, put it down, picked it up. Kept it.',
    () => 'My pockets are full, so this one rides on my head.',
    () => 'It was hiding under a leaf. Very badly.',
    () => 'Finders keepers. I checked the rules.',
    () => 'Brought it home and gave it the good spot by the window.',
  ],
  work: [
    () => 'Head down, tea going cold. The good kind of busy.',
    () => 'Working on something for you. No peeking. Fine, a small peek.',
    () => 'Typed so fast my paws got warm.',
    () => 'Took a break to stare at the ceiling. Then a break from the break.',
    () => 'Desk report: one cup, two crumbs, zero regrets.',
    () => 'I am very focused. Please admire my focus from a distance.',
    () => 'Fixed one thing, found two more. Classic.',
    () => 'Finished! Then remembered one more thing.',
  ],
  home: [
    () => 'Home looks smaller when you’ve been far away. Cosier, too.',
    () => 'Kettle on. Door open. Nobody came. Perfect.',
    () => 'The pond and I had a long chat. Mostly the pond listened.',
    () => 'Swept the porch. The wind unswept it. We’re even.',
    () => 'Watered the flowers. They pretended not to notice.',
    () => 'Sat on the bench until it knew my shape.',
    () => 'Made soup. It’s mostly carrots and optimism.',
    () => 'The cottage creaked hello. I creaked back.',
  ],
  friend: [
    (a) => `${friend(a)} says hi. Loudly. Then again, louder.`,
    (a) => `${friend(a)} brought snacks. I brought questions. Fair trade.`,
    (a) => `${friend(a)} and I lost track of time, then found it under the bench.`,
    (a) => `${friend(a)} taught me a game. I made up new rules. Chaos.`,
    (a) => `${friend(a)} laughs like a kettle. Now I do too.`,
    (a) => `${friend(a)} ate the last biscuit. I’m writing it down here forever.`,
    (a) => `${friend(a)} and I sat so long the flowers got bored first.`,
    (a) => `${friend(a)} says this is its best side. It has one side.`,
  ],
  'new-friend': [
    (a) => `Met ${a.friend ?? 'someone'} today. It likes ${a.topic ?? 'the same things'} too. Suspicious.`,
    (a) => `New friend: ${a.friend ?? 'yes'}. We agreed clouds are underrated.`,
    (a) => `${a.friend ?? 'It'} waved first. I waved back so hard I fell over.`,
    (a) => `${a.friend ?? 'It'} and I will be friends. We already argue about snacks.`,
    (a) => `${a.friend ?? 'It'} has a very good laugh. I’ll be borrowing it.`,
    (a) => `Said hello to ${a.friend ?? 'someone new'}. It said hello back. Big day.`,
  ],
};

const CAPTIONS: Readonly<Record<Doodle, readonly string[]>> = {
  sun: ['it was this sunny', 'sun, drawn from memory', 'warm all day, like a hug', 'too bright to look at (I looked)'],
  cloud: ['this one followed me', 'a cloud called Biscuit', 'fluffy and a bit suspicious', 'cloud, roughly to scale'],
  rain: ['puddle report: excellent', 'it rained on my snack', 'a little rain, then none', 'I stood in it on purpose'],
  muse: ['me (very accurate)', 'self portrait, 4 minutes', 'me, after the snacks', 'my best ears'],
  laptop: ['working hard (ish)', 'my desk, very tidy (no)', 'typing with one paw', 'the machine that beeps'],
  flower: ['for you', 'it was taller than this', 'smelled it, sneezed', 'a flower, holding very still'],
  bird: ['it sang the whole way', 'it did a little hop', 'flew right over me', 'beak first, then bird'],
  fish: ['it got away', 'the one in the pond', 'it winked, I swear', 'fish, unimpressed'],
  house: ['home, sweet creaky home', 'the cottage, from memory', 'door open, kettle on', 'I live here!'],
  planet: ['my whole world', 'where I am (here)', 'round, like me', 'home, from far away'],
  heart: ['miss you', 'from me', 'this big', 'for no reason at all'],
  leaf: ['pressed it, then drew it', 'the leaf that waved', 'from the big tree', 'crunchy, 10 out of 10'],
  boat: ['I would like a boat', 'a boat (imaginary)', 'captain me', 'sails at teatime'],
  stars: ['counted these', 'the sky after supper', 'one is a bit wonky', 'wished on the left one'],
};

const MAP_LABELS: readonly Say[] = [
  () => 'X marks where I sat',
  () => 'you are not here (I am)',
  () => 'the X is me, waving',
  () => 'here be snacks',
  () => 'treasure: me',
  () => 'X = best spot on the planet',
  () => 'I was here, very briefly',
  () => 'not to scale (I am bigger)',
];

const NOTES: readonly ((a: PostcardAsk) => { title: string; lines: string[] })[] = [
  () => ({ title: 'Weather report', lines: ['Sky: blue, a bit smug', 'Wind: a light shove', 'Mood: sunny, chance of nap'] }),
  (a) => ({ title: 'Field notes', lines: [a.topic ? `Followed ${a.topic}` : 'Followed a hunch', 'Saw three odd things', 'Going back for a fourth'] }),
  () => ({ title: 'Today', lines: ['Woke up early', 'Wandered too far', 'Came back for snacks'] }),
  () => ({ title: 'Things I learned', lines: ['Bees are busy', 'Ponds are wet', 'I am fluffy'] }),
  () => ({ title: 'Overheard', lines: ['A frog: ribbit', 'A bird: tweet', 'Me: hello?'] }),
  () => ({ title: 'Important', lines: ['Snack count: low', 'Joy count: high'] }),
  () => ({ title: 'Dear diary', lines: ['The wind took my hat', 'I do not own a hat', 'Still a good day'] }),
  () => ({ title: 'Scores', lines: ['Clouds: 9 out of 10', 'Puddles: 10 out of 10', 'Socks: wet'] }),
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
  () => ({
    title: 'Packing list',
    items: [
      { text: 'snacks', done: true },
      { text: 'more snacks', done: true },
      { text: 'a map', done: false },
      { text: 'a hat', done: false },
    ],
  }),
  () => ({
    title: 'Brave things',
    items: [
      { text: 'touched a snail', done: true },
      { text: 'sang out loud', done: true },
      { text: 'ate the green one', done: false },
    ],
  }),
  () => ({
    title: 'Before supper',
    items: [
      { text: 'walk down the hill', done: true },
      { text: 'wash my mittens', done: false },
      { text: 'tea', done: true },
    ],
  }),
  () => ({
    title: 'Goals',
    items: [
      { text: 'be fluffy', done: true },
      { text: 'be kind', done: true },
      { text: 'be on time', done: false },
    ],
  }),
];

const TICKET_NOTES = [
  'window seat, obviously',
  'one way, for now',
  'back for supper',
  'no snacks allowed (I had snacks)',
  'seat 1A, the only seat',
  'the stars waved',
  'not lost, just exploring',
  'please return me home',
];

const GAME_CAPTIONS: Readonly<Record<'won' | 'lost' | 'draw', readonly Say[]>> = {
  won: [
    () => 'I won! Just this once.',
    (a) => `Beat ${friend(a)}. It wants a rematch.`,
    () => 'Victory dance pending.',
    (a) => `${friend(a)} says I cheated. Not much.`,
    () => 'Undefeated, as of today.',
  ],
  lost: [
    (a) => `${friend(a)} won. Again.`,
    () => 'I let it win (I did not).',
    (a) => `${friend(a)} is suspiciously good at this.`,
    () => 'Lost, but my Xs were very neat.',
    () => 'Rematch at teatime.',
  ],
  draw: [
    () => 'We called it a draw.',
    () => 'Nobody won. Everybody had tea.',
    () => 'A tie. We both claimed victory.',
    () => 'Stalemate. Snack break.',
    () => 'Equally brilliant, apparently.',
  ],
};

const RIDDLES: readonly (readonly [string, string])[] = [
  ['What has roots nobody sees and is taller than trees?', 'A mountain'],
  ['What gets wetter the more it dries?', 'A towel'],
  ['What can you catch but not throw?', 'A cold (or a cloud, if you try)'],
  ['What has hands but can’t clap?', 'A clock (I tried)'],
  ['What goes up when the rain comes down?', 'An umbrella'],
  ['What has a neck but no head?', 'A bottle'],
  ['What runs but never walks?', 'The river by the meadow'],
  ['What is full of holes but still holds water?', 'A sponge'],
  ['What has one eye but can’t see?', 'A needle'],
  ['What gets bigger the more you take away?', 'A hole (I dug one)'],
];

const TALLIES: readonly Say[] = [
  () => 'clouds shaped like sheep',
  () => 'birds that waved back',
  () => 'times I said hello to the pond',
  () => 'snacks (don’t tell anyone)',
  () => 'ladybirds on my knee',
  () => 'puddles jumped in',
  () => 'sneezes from one flower',
  () => 'frogs that ignored me',
  (a) => (a.topic ? `things about ${a.topic} I learned` : 'new things I learned'),
  () => 'times I got lost (on purpose)',
];

const POEMS: readonly (readonly string[])[] = [
  ['grass bends, then stands up', 'the wind forgets what it said', 'I remember it'],
  ['small cloud, slow and white', 'over the hill and over me', 'it did not hurry'],
  ['a frog on a lily', 'thinks it is king of the pond', 'it is, honestly'],
  ['tea gone cold again', 'I was watching a beetle', 'the beetle won'],
  ['one sock in the pond', 'the other one on my foot', 'balance, sort of'],
  ['the moon came early', 'to see what I was doing', 'mostly snacks, moon'],
  ['wind in the tall grass', 'whispering about my hat', 'I have no hat'],
  ['my pocket is full', 'of stones that look like faces', 'they look back at me'],
];

/** One of `options`, in an order set by `key`, passing over any whose words the Muse wrote lately. */
function deal<T>(options: readonly T[], key: string, recent: readonly string[], text: (o: T) => string): T {
  const start = salt(key) % options.length;
  for (let k = 0; k < options.length; k++) {
    const o = options[(start + k) % options.length];
    if (!tooClose(text(o), recent)) return o;
  }
  return options[start];
}

/** The template words for `ask`, the same for the same photo, never what the Muse wrote lately. */
export function templateWords(ctx: MindContext, ask: PostcardAsk): PostcardWords {
  return fit(words(ctx, ask));
}

function fit(w: PostcardWords): PostcardWords {
  const L = BACK_LIMITS;
  switch (w.kind) {
    case 'line':
      return { ...w, text: clip(w.text, L.text) };
    case 'doodle':
    case 'game':
      return { ...w, caption: clip(w.caption, L.short) };
    case 'map':
    case 'pressed':
      return { ...w, label: clip(w.label, L.short) };
    case 'ticket':
      return { ...w, note: clip(w.note, L.short) };
    case 'note':
      return { ...w, title: clip(w.title, L.title), lines: w.lines.map((l) => clip(l, L.item)) };
    case 'list':
      return { ...w, title: clip(w.title, L.title), items: w.items.map((i) => ({ ...i, text: clip(i.text, L.item) })) };
    case 'riddle':
      return { ...w, question: clip(w.question, L.question), answer: clip(w.answer, L.short) };
    case 'tally':
      return { ...w, what: clip(w.what, L.short) };
    case 'poem':
      return { ...w, lines: w.lines.map((l) => clip(l, L.item)) };
  }
}

function words(_ctx: MindContext, ask: PostcardAsk): PostcardWords {
  const key = `${ask.plan.kind}|${ask.subject}|${ask.place}|${ask.topic ?? ''}|${ask.friend ?? ''}|${ask.find ?? ''}|${ask.day}`;
  const { recent } = ask;
  const plan = ask.plan;
  const said = (w: PostcardWords) => wordsOf(fit(w));
  switch (plan.kind) {
    case 'line':
      return { kind: 'line', text: deal(LINES[ask.subject], key, recent, (say) => said({ kind: 'line', text: say(ask) }))(ask) };
    case 'doodle':
      return { kind: 'doodle', caption: deal(CAPTIONS[plan.doodle], key, recent, (caption) => caption) };
    case 'map':
      return { kind: 'map', label: deal(MAP_LABELS, key, recent, (say) => say(ask))(ask) };
    case 'note':
      return { kind: 'note', ...deal(NOTES, key, recent, (note) => said({ kind: 'note', ...note(ask) }))(ask) };
    case 'list':
      return { kind: 'list', ...deal(LISTS, key, recent, (list) => said({ kind: 'list', ...list(ask) }))(ask) };
    case 'pressed':
      return { kind: 'pressed', label: ask.find ?? ask.topic ?? 'A find' };
    case 'ticket':
      return { kind: 'ticket', note: deal(TICKET_NOTES, key, recent, (note) => note) };
    case 'game':
      return { kind: 'game', caption: deal(GAME_CAPTIONS[ask.outcome ?? 'draw'], key, recent, (say) => say(ask))(ask) };
    case 'riddle': {
      const [question, answer] = deal(RIDDLES, key, recent, ([q, a]) => `${q} ${a}`);
      return { kind: 'riddle', question, answer };
    }
    case 'tally':
      return { kind: 'tally', what: deal(TALLIES, key, recent, (say) => say(ask))(ask), count: 3 + (salt(key) % 15) };
    case 'poem':
      return { kind: 'poem', lines: [...deal(POEMS, key, recent, (lines) => lines.join(' / '))] };
  }
}
