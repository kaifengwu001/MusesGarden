import { describe, expect, it } from 'vitest';
import { placeholderSnapshot } from './placeholder';

describe('the placeholder postcards', () => {
  const cards = placeholderSnapshot(new Date(2026, 9, 31)).postcards;

  it('show every kind of back Muse writes or draws, between them', () => {
    const kinds = new Set(cards.flatMap((c) => (c.back ? [c.back.kind] : [])));
    expect([...kinds].sort()).toEqual(['doodle', 'game', 'line', 'list', 'map', 'note', 'poem', 'pressed', 'riddle', 'tally', 'ticket']);
  });

  it('leave an invitation’s back as it was, and give every photo one', () => {
    for (const card of cards) expect(card.back === undefined, card.id).toBe(card.invitation !== undefined);
  });

  it('keep their ids from one load to the next', () => {
    expect(placeholderSnapshot(new Date(2026, 10, 2)).postcards.map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
});
