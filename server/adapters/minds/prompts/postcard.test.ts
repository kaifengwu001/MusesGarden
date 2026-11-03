import { describe, expect, it } from 'vitest';
import type { DiscoveryId, MindContext, MuseId, PhotoSubject, PostcardAsk, PostcardPlan, PostcardWords } from '../../../../src/muse/contract';
import { templateWords } from '../postcard';
import { BACK_LIMITS, parsePostcard, postcardPrompt } from './postcard';

const ctx: MindContext = {
  name: 'Fern',
  soul: 'I collect things that almost went unnoticed.',
  temperament: { curiosity: 0.6, focus: 0.55, sociability: 0.5, whimsy: 0.5, novelty: 0.5 },
  interests: [],
  question: null,
};

const PLANS: readonly PostcardPlan[] = [
  { kind: 'line' },
  { kind: 'doodle', doodle: 'cloud' },
  { kind: 'map', dir: [0, 1, 0] },
  { kind: 'note' },
  { kind: 'list' },
  { kind: 'pressed', find: 'd:1' as DiscoveryId },
  { kind: 'ticket', from: 'Fern’s planet', to: 'Outside the planet' },
  { kind: 'game', friend: 'wren' as MuseId, board: 'xox.x.o.x' },
  { kind: 'riddle' },
  { kind: 'tally' },
  { kind: 'poem' },
];
const SUBJECTS: readonly PhotoSubject[] = ['selfie', 'scenery', 'sky', 'closeup', 'creature', 'find', 'work', 'home', 'friend', 'new-friend'];

const ask = (plan: PostcardPlan, subject: PhotoSubject, k = 0): PostcardAsk => ({
  plan,
  subject,
  place: 'on my planet',
  doing: subject === 'work' ? 'work' : 'travel',
  topic: k % 2 ? 'Watercolor painting' : null,
  friend: k % 3 ? 'Wren' : null,
  find: subject === 'find' ? 'A pressed fern from 1890' : null,
  outcome: plan.kind === 'game' ? (['won', 'lost', 'draw'] as const)[k % 3] : null,
  day: '2026-11-03',
  recent: [],
});

/** Every piece of text on a back, to hold against the card's room. */
function texts(w: PostcardWords): string[] {
  return Object.entries(w).flatMap(([key, v]: [string, unknown]): string[] => {
    if (key === 'kind') return [];
    if (typeof v === 'string') return [v];
    if (!Array.isArray(v)) return [];
    return (v as unknown[]).map((x) => (typeof x === 'string' ? x : (x as { text: string }).text));
  });
}

describe("the words on a postcard's back", () => {
  it('without a model, fit the card for every kind and subject', () => {
    for (const plan of PLANS) {
      for (const subject of SUBJECTS) {
        for (let k = 0; k < 6; k++) {
          const w = templateWords(ctx, ask(plan, subject, k));
          expect(w.kind).toBe(plan.kind);
          for (const text of texts(w)) {
            expect(text.length, `${plan.kind}/${subject}: ${text}`).toBeGreaterThan(0);
            expect(text.length, `${plan.kind}/${subject}: ${text}`).toBeLessThanOrEqual(BACK_LIMITS.text);
          }
          expect(parsePostcard(w, plan.kind), `${plan.kind}/${subject}`).toEqual(w);
        }
      }
    }
  });

  it('from the model, are taken only when they fit the card', () => {
    expect(parsePostcard({ text: 'The clouds looked like folded paper today.' }, 'line')).toEqual({ kind: 'line', text: 'The clouds looked like folded paper today.' });
    expect(parsePostcard({ text: '“Quoted and   spaced.”' }, 'line')).toEqual({ kind: 'line', text: 'Quoted and spaced.' });
    expect(parsePostcard({ text: 'x'.repeat(BACK_LIMITS.text + 1) }, 'line')).toBeNull();
    expect(parsePostcard({ text: '' }, 'line')).toBeNull();
    expect(parsePostcard({ title: 'Today', items: [{ text: 'nap', done: true }] }, 'list')).toBeNull();
    expect(parsePostcard({ title: 'Today', items: [{ text: 'nap', done: true }, { text: 'tea', done: 'yes' }] }, 'list')).toBeNull();
    expect(parsePostcard({ lines: ['one', 'two'] }, 'poem')).toBeNull();
    expect(parsePostcard({ what: 'clouds', count: 0 }, 'tally')).toBeNull();
    expect(parsePostcard({ what: 'clouds', count: 7.4 }, 'tally')).toEqual({ kind: 'tally', what: 'clouds', count: 7 });
    expect(parsePostcard({ question: 'What has roots nobody sees?', answer: 'A mountain' }, 'riddle')).toEqual({
      kind: 'riddle',
      question: 'What has roots nobody sees?',
      answer: 'A mountain',
    });
  });

  it('say who won a game the way its board shows', () => {
    const game: PostcardPlan = { kind: 'game', friend: 'wren' as MuseId, board: 'xox.x.o.x' };
    const captions = (k: number) => new Set(Array.from({ length: 12 }, (_, j) => templateWords(ctx, { ...ask(game, 'friend', k), place: `p${j}` })).map((w) => (w.kind === 'game' ? w.caption : '')));
    const won = captions(0);
    const lost = captions(1);
    for (const c of won) expect(lost.has(c), c).toBe(false);
    expect(postcardPrompt(ctx, ask(game, 'friend', 0)).user).toContain('you won');
    expect(postcardPrompt(ctx, ask(game, 'friend', 1)).user).toContain('they won');
  });

  it('are asked for with the photo, the kind and a schema of the same shape', () => {
    const p = postcardPrompt(ctx, ask({ kind: 'game', friend: 'wren' as MuseId, board: 'xox.x.o.x' }, 'friend', 1));
    expect(p.name).toBe('muse_postcard_game');
    expect(p.user).toContain('noughts and crosses with Wren');
    expect(p.user).toContain('Watercolor painting');
    expect(p.schema).toMatchObject({ type: 'object', required: ['caption'] });
  });
});
