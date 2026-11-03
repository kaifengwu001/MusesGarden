import { describe, expect, it } from 'vitest';
import type { DiscoveryId, PhotoId, PhotoSpec, PostcardBackKind, PostcardPlan, Temperament } from '../../../src/muse/contract';
import { instant, museId } from '../ids';
import { drawFor } from '../rng';
import { Life, MOSS, TEMPERAMENTS } from '../testing';
import { gameBoard, postcardPlan } from './postcard';

const WREN = museId('wren');

function photo(k: number, over: Partial<PhotoSpec> = {}): PhotoSpec {
  return {
    id: `p:moss:1:${1793640000000 + k * 977}:0` as PhotoId,
    at: instant(1793640000000 + k * 977),
    subject: 'scenery',
    context: 'planet',
    planetOf: MOSS.id,
    dir: [0, 1, 0],
    forward: [1, 0, 0],
    zoom: 0.4,
    companions: [],
    ...over,
  };
}

function plans(temperament: Temperament, over: Partial<PhotoSpec> = {}, n = 400): PostcardPlan[] {
  const s = new Life(MOSS, temperament).state;
  return Array.from({ length: n }, (_, k) => postcardPlan(s, photo(k, over), drawFor(MOSS.id, 0)));
}

const share = (ps: readonly PostcardPlan[], kinds: readonly PostcardBackKind[]) => ps.filter((p) => kinds.includes(p.kind)).length / ps.length;

describe("a postcard's back", () => {
  it('is the same every time for the same photo', () => {
    const s = new Life(MOSS, TEMPERAMENTS.hero).state;
    for (let k = 0; k < 30; k++) expect(postcardPlan(s, photo(k), drawFor(MOSS.id, 0))).toEqual(postcardPlan(s, photo(k), drawFor(MOSS.id, 0)));
  });

  it('only carries what its photo can: a ticket from beyond, a game with a friend, a pressed find, a map of the planet alone', () => {
    const alone = plans(TEMPERAMENTS.hero);
    expect(alone.some((p) => p.kind === 'ticket' || p.kind === 'game' || p.kind === 'pressed')).toBe(false);
    expect(alone.some((p) => p.kind === 'map')).toBe(true);

    const beyond = plans(TEMPERAMENTS.hero, { context: 'beyond' });
    expect(share(beyond, ['ticket'])).toBeGreaterThan(0.2);
    expect(beyond.some((p) => p.kind === 'map')).toBe(false);
    for (const p of beyond) if (p.kind === 'doodle') expect(['planet', 'stars', 'muse']).toContain(p.doodle);

    const together = plans(TEMPERAMENTS.hero, { subject: 'friend', companions: [WREN], planetOf: WREN });
    expect(together.some((p) => p.kind === 'map')).toBe(false);
    for (const p of together) if (p.kind === 'game') expect(p.friend).toBe(WREN);
    expect(together.some((p) => p.kind === 'game')).toBe(true);

    const find = 'd:moss:1' as DiscoveryId;
    const found = plans(TEMPERAMENTS.hero, { subject: 'find', discoveryId: find });
    for (const p of found) if (p.kind === 'pressed') expect(p.find).toBe(find);
    expect(found.some((p) => p.kind === 'pressed')).toBe(true);
  });

  it('follows the Muse: a whimsical one doodles more, a focused one keeps more lists and notes', () => {
    const whimsical = plans({ ...TEMPERAMENTS.hero, whimsy: 1, focus: 0.1 });
    const focused = plans({ ...TEMPERAMENTS.hero, whimsy: 0.1, focus: 1 });
    expect(share(whimsical, ['doodle'])).toBeGreaterThan(share(focused, ['doodle']));
    expect(share(focused, ['list', 'note'])).toBeGreaterThan(share(whimsical, ['list', 'note']));
  });

  it('uses every kind across a cast', () => {
    const kinds = new Set<string>();
    for (const temperament of Object.values(TEMPERAMENTS)) {
      for (const over of [{}, { context: 'beyond' as const }, { companions: [WREN] }, { subject: 'find' as const, discoveryId: 'd:x' as DiscoveryId }]) {
        for (const p of plans(temperament, over, 200)) kinds.add(p.kind);
      }
    }
    expect([...kinds].sort()).toEqual(['doodle', 'game', 'line', 'list', 'map', 'note', 'poem', 'pressed', 'riddle', 'tally', 'ticket']);
  });
});

describe('noughts and crosses', () => {
  it('is a game that could have been played: crosses first, turns kept, nothing after a line', () => {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (let g = 0; g < 200; g++) {
      const u = drawFor(MOSS.id, g);
      const board = gameBoard((k) => u('game', k));
      expect(board).toMatch(/^[xo.]{9}$/);
      const xs = [...board].filter((c) => c === 'x').length;
      const os = [...board].filter((c) => c === 'o').length;
      expect(xs - os === 0 || xs - os === 1).toBe(true);
      const winners = lines.filter(([a, b, c]) => board[a] !== '.' && board[a] === board[b] && board[b] === board[c]).map(([a]) => board[a]);
      expect(new Set(winners).size).toBeLessThanOrEqual(1);
      if (xs + os < 9) expect(winners.length).toBeGreaterThan(0);
    }
  });
});
