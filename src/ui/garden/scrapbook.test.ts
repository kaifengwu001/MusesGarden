import { describe, expect, it } from 'vitest';
import { covered, scrapOf, scribbleSvg, SNAP, STICKERS, TINTS, type Scrap } from './scrapbook';

const ids = Array.from({ length: 400 }, (_, k) => `photo:friend:hero+wren:${1793641186684 + k * 7919}`);
const scraps = ids.map(scrapOf);

const holderName = (s: Scrap): string => (s.holder.kind === 'clip' ? s.holder.clip : `tape-${s.holder.at}`);

describe('a postcard on the scrapbook page', () => {
  it('dresses the same way every time the page opens', () => {
    for (const id of ids.slice(0, 40)) expect(scrapOf(id)).toEqual(scrapOf(id));
  });

  it('never has its sticker on a corner its tape or clip covers', () => {
    for (const s of scraps) if (s.sticker) expect(covered(s.holder)).not.toContain(s.sticker.corner);
  });

  it('across a page, uses every tint, every way of holding a card, every scribble and every sticker', () => {
    expect(new Set(scraps.map((s) => s.tint))).toEqual(new Set(Object.keys(TINTS)));
    expect(new Set(scraps.map(holderName))).toEqual(new Set(['tape-top', 'tape-tl', 'tape-tr', 'tape-pair', 'binder', 'paper']));
    expect(new Set(scraps.flatMap((s) => (s.scribble ? [s.scribble.kind] : [])))).toEqual(new Set(['loops', 'wave', 'rough', 'brackets']));
    expect(new Set(scraps.flatMap((s) => (s.sticker ? [s.sticker.name] : [])))).toEqual(new Set(Object.keys(STICKERS)));
  });

  it('is mostly cream, mostly without a scribble, and leans only a little', () => {
    const share = (f: (s: Scrap) => boolean): number => scraps.filter(f).length / scraps.length;
    expect(share((s) => s.tint === 'cream')).toBeGreaterThan(0.4);
    expect(share((s) => s.scribble !== null)).toBeLessThan(0.5);
    expect(share((s) => s.sticker !== null)).toBeGreaterThan(0.5);
    for (const s of scraps) expect(Math.abs(s.tilt)).toBeLessThanOrEqual(3.2);
  });

  it('draws each scribble inside the room it has round the polaroid', () => {
    for (const s of scraps) {
      if (!s.scribble) continue;
      const svg = scribbleSvg(s.scribble, 'x');
      const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
      const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(numbers.length, s.scribble.kind).toBeGreaterThan(8);
      expect(numbers.every(Number.isFinite)).toBe(true);
      const xs = numbers.filter((_, k) => k % 2 === 0);
      const ys = numbers.filter((_, k) => k % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-SNAP.pad);
      expect(Math.max(...xs)).toBeLessThanOrEqual(SNAP.w + SNAP.pad);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-SNAP.pad);
      expect(Math.max(...ys)).toBeLessThanOrEqual(SNAP.h + SNAP.pad);
    }
  });
});
