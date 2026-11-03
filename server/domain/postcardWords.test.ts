import { describe, expect, it } from 'vitest';
import type { MindContext, PhotoSubject, PostcardAsk, PostcardPlan } from '../../src/muse/contract';
import { templateWords } from '../adapters/minds/postcard';
import { tooClose, wordsOf } from './postcardWords';

const ctx: MindContext = {
  name: 'Fern',
  soul: '',
  temperament: { curiosity: 0.6, focus: 0.55, sociability: 0.5, whimsy: 0.5, novelty: 0.5 },
  interests: [],
  question: null,
};

describe('two postcards saying the same thing', () => {
  it('is caught when the words that matter are mostly the same, not when they only share small ones', () => {
    expect(tooClose('The clouds looked like folded paper today.', ['Today the clouds looked like folded paper!'])).toBe(true);
    expect(tooClose('A snail beat me to the pond.', ['The pond and I had a long chat.'])).toBe(false);
    expect(tooClose('I won! Just this once.', [])).toBe(false);
  });
});

describe('the template words', () => {
  it('never write what the Muse wrote on its last postcards, until a kind runs out', () => {
    for (const subject of ['sky', 'selfie', 'home', 'friend'] satisfies PhotoSubject[]) {
      const recent: string[] = [];
      const seen: string[] = [];
      for (let day = 1; day <= 8; day++) {
        const ask: PostcardAsk = {
          plan: { kind: 'line' },
          subject,
          place: 'on my planet',
          doing: 'rest',
          topic: null,
          friend: 'Wren',
          find: null,
          outcome: null,
          day: `2026-11-${String(day).padStart(2, '0')}`,
          recent: [...recent],
        };
        const text = wordsOf(templateWords(ctx, ask));
        expect(tooClose(text, recent), `${subject} day ${day}: ${text}`).toBe(false);
        recent.push(text);
        seen.push(text);
      }
      expect(new Set(seen).size, subject).toBe(seen.length);
    }
  });

  it('give every kind of back something it hasn’t said lately', () => {
    const plans: PostcardPlan[] = [{ kind: 'doodle', doodle: 'cloud' }, { kind: 'note' }, { kind: 'list' }, { kind: 'riddle' }, { kind: 'tally' }, { kind: 'poem' }];
    for (const plan of plans) {
      const recent: string[] = [];
      for (let day = 1; day <= 4; day++) {
        const text = wordsOf(templateWords(ctx, { plan, subject: 'sky', place: 'on my planet', doing: 'rest', topic: null, friend: null, find: null, outcome: null, day: `2026-11-0${day}`, recent: [...recent] }));
        expect(recent, `${plan.kind} day ${day}`).not.toContain(text);
        recent.push(text);
      }
    }
  });
});
