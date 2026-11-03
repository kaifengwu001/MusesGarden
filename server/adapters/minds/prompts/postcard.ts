import type { ListItem, MindContext, PhotoSubject, PostcardAsk, PostcardBackKind, PostcardWords } from '../../../../src/muse/contract';
import { array, boolean, number, object, persona, string, type JsonSchema, type Prompt } from './prompt';

/** The longest each piece of a back may be, in characters: room on a postcard's message side at its smallest. */
export const BACK_LIMITS = { text: 90, short: 40, title: 24, item: 32, question: 90 } as const;

const SHOWS: Readonly<Record<PhotoSubject, string>> = {
  selfie: 'a selfie of you',
  scenery: 'the view around you',
  sky: 'the sky',
  closeup: 'something small, up close',
  creature: 'a creature you met',
  find: 'something you found',
  work: 'you at work',
  home: 'your home, the cottage and its pond',
  friend: 'you and your friend together',
  'new-friend': 'you and a Muse you just met',
};

const DOING: Readonly<Record<PostcardAsk['doing'], string>> = {
  rest: 'resting at home',
  travel: 'out exploring',
  beyond: 'travelling outside the planet',
  visit: 'visiting',
  work: 'working',
  hangout: 'spending time with a friend',
};

/** What to write for each kind, and its reply's shape. */
const KINDS: Readonly<Record<PostcardBackKind, (a: PostcardAsk) => { readonly ask: string; readonly schema: JsonSchema }>> = {
  line: () => ({ ask: 'Write one sentence to your owner, at most 14 words.', schema: object({ text: string }) }),
  doodle: (a) => ({
    ask: `You drew ${a.plan.kind === 'doodle' ? `a ${a.plan.doodle}` : 'a doodle'} in crayon. Write its tiny caption, at most 5 words.`,
    schema: object({ caption: string }),
  }),
  map: () => ({ ask: 'You drew a tiny map of your planet with an X where you were. Write its label, at most 6 words.', schema: object({ label: string }) }),
  note: () => ({
    ask: 'Write a little note: a title of 1 to 3 words (like "Weather report" or "Field notes"), then 2 or 3 lines of at most 5 words each.',
    schema: object({ title: string, lines: array(string) }),
  }),
  list: () => ({
    ask: 'Write a short list of what you did or meant to do today: a title of 1 to 3 words, then 3 or 4 items of at most 5 words each, each done or not.',
    schema: object({ title: string, items: array(object({ text: string, done: boolean })) }),
  }),
  pressed: (a) => ({
    ask: `You pressed ${a.find ? `"${a.find}"` : 'what you found'} like a flower in a book. Write its museum label, at most 6 words.`,
    schema: object({ label: string }),
  }),
  ticket: (a) => ({
    ask: `You kept the ticket stub from the trip${a.plan.kind === 'ticket' ? ` (${a.plan.from} to ${a.plan.to})` : ''}. Write a note on it, at most 5 words.`,
    schema: object({ note: string }),
  }),
  game: (a) => ({
    ask: `You played noughts and crosses with ${a.friend ?? 'your friend'}. Write a caption about the game, at most 7 words.`,
    schema: object({ caption: string }),
  }),
  riddle: () => ({
    ask: 'Write a riddle that fits the photo: the question in at most 14 words, and its answer in at most 6.',
    schema: object({ question: string, answer: string }),
  }),
  tally: () => ({
    ask: 'You kept a tally of something you counted today. Say what you counted, at most 6 words, and how many, from 1 to 30.',
    schema: object({ what: string, count: number }),
  }),
  poem: () => ({ ask: 'Write a tiny poem of exactly 3 lines, at most 6 words each. It need not rhyme.', schema: object({ lines: array(string) }) }),
};

export function postcardPrompt(ctx: MindContext, ask: PostcardAsk): Prompt {
  const { ask: what, schema } = KINDS[ask.plan.kind](ask);
  const about = [
    `You just took a photo to send your owner as a postcard. It shows ${SHOWS[ask.subject]}.`,
    `You were ${DOING[ask.doing]}, ${ask.place}${ask.topic ? `, with "${ask.topic}" on your mind` : ''}${ask.friend ? `, with your friend ${ask.friend}` : ''}.`,
    ask.find ? `The photo is of a find you kept: "${ask.find}".` : '',
  ].filter(Boolean);
  return {
    name: `muse_postcard_${ask.plan.kind}`,
    effort: 'low',
    system: persona(ctx),
    user: [
      ...about,
      '',
      `On the back of the postcard: ${what}`,
      'Write it in your own voice, warm and a little playful, as if by hand. Say what the photo meant to you rather than describing it.',
      'No hashtags, no emoji, no quotation marks, and nothing about your owner’s private life.',
    ].join('\n'),
    schema,
  };
}

/** A tidy piece of text no longer than `max`, or null. */
function piece(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '');
  return s.length > 0 && s.length <= max ? s : null;
}

function pieces(v: unknown, max: number, min: number, most: number): string[] | null {
  if (!Array.isArray(v) || v.length < min) return null;
  const out = v.slice(0, most).map((x) => piece(x, max));
  return out.every((x): x is string => x !== null) ? out : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The model's reply as the words for `kind`, or null when it is malformed or too long for the card. */
export function parsePostcard(raw: unknown, kind: PostcardBackKind): PostcardWords | null {
  if (!isRecord(raw)) return null;
  const L = BACK_LIMITS;
  switch (kind) {
    case 'line': {
      const text = piece(raw.text, L.text);
      return text ? { kind, text } : null;
    }
    case 'doodle':
    case 'game': {
      const caption = piece(raw.caption, L.short);
      return caption ? { kind, caption } : null;
    }
    case 'map':
    case 'pressed': {
      const label = piece(raw.label, L.short);
      return label ? { kind, label } : null;
    }
    case 'ticket': {
      const note = piece(raw.note, L.short);
      return note ? { kind, note } : null;
    }
    case 'note': {
      const title = piece(raw.title, L.title);
      const lines = pieces(raw.lines, L.item, 2, 3);
      return title && lines ? { kind, title, lines } : null;
    }
    case 'list': {
      const title = piece(raw.title, L.title);
      if (!title || !Array.isArray(raw.items) || raw.items.length < 2) return null;
      const items: ListItem[] = [];
      for (const it of raw.items.slice(0, 4) as unknown[]) {
        const text = isRecord(it) ? piece(it.text, L.item) : null;
        if (!text || !isRecord(it) || typeof it.done !== 'boolean') return null;
        items.push({ text, done: it.done });
      }
      return { kind, title, items };
    }
    case 'riddle': {
      const question = piece(raw.question, L.question);
      const answer = piece(raw.answer, L.short);
      return question && answer ? { kind, question, answer } : null;
    }
    case 'tally': {
      const what = piece(raw.what, L.short);
      const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.round(raw.count) : NaN;
      return what && count >= 1 && count <= 40 ? { kind, what, count } : null;
    }
    case 'poem': {
      const lines = pieces(raw.lines, L.item, 3, 3);
      return lines ? { kind, lines } : null;
    }
  }
}
