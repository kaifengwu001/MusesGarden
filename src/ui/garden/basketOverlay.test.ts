import { describe, expect, it } from 'vitest';
import { basketFan, FAN_MAX, freeRect, type Size } from './basketFan';
import { peekAbove, type Box } from './basketOverlay';

/** The rail's left edge on each (garden.css), and the preview's size: its width, and the tallest card measured (a picture and two lines). */
const SCREENS = [
  { name: 'phone', screen: { width: 390, height: 844 } as Size, rail: { left: 390 - 10 - 54 } },
  { name: 'desk', screen: { width: 1440, height: 900 } as Size, rail: { left: 1440 - 24 - 44 } },
];
const PEEK = { width: 236, height: 283 };

const overlaps = (a: Box, b: Box): boolean => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

describe.each(SCREENS)('a flower’s preview on a $name', ({ screen, rail }) => {
  it('sits above its flower, centred on it unless the screen’s edge is nearer, inside the screen, clear of the basket, and clear of the other flowers unless it is as high as the screen allows', () => {
    for (let n = 1; n <= FAN_MAX; n++) {
      const fan = basketFan(n, screen, freeRect(screen, rail));
      const box = (s: { x: number; y: number }): Box => ({ left: s.x - fan.size / 2, top: s.y - fan.size / 2, right: s.x + fan.size / 2, bottom: s.y + fan.size / 2 });
      fan.slots.forEach((slot, k) => {
        const flower = box(slot);
        const others = fan.slots.filter((_, j) => j !== k).map(box);
        const at = peekAbove(flower, [...others, fan.basket], PEEK.width, PEEK.height, screen);
        const peek: Box = { left: at.x, top: at.y, right: at.x + PEEK.width * at.scale, bottom: at.y + PEEK.height * at.scale };
        const where = `flower ${k} of ${n}`;
        expect(peek.bottom, `${where} is above it`).toBeLessThanOrEqual(flower.top);
        expect(peek.left >= 0 && peek.top >= 0 && peek.right <= screen.width && peek.bottom <= screen.height, `${where} is on the screen`).toBe(true);
        const off = Math.abs((peek.left + peek.right) / 2 - slot.x);
        if (off > 0.5) expect(Math.min(peek.left, screen.width - peek.right), `${where} is centred unless held in by the screen`).toBeLessThanOrEqual(12.5);
        expect(overlaps(peek, fan.basket), `${where} is clear of the basket`).toBe(false);
        if (others.some((o) => overlaps(peek, o))) expect(peek.top, `${where} covers another flower only when it is as high as it goes`).toBeLessThanOrEqual(12.5);
        expect(at.scale, `${where} keeps most of its size`).toBeGreaterThanOrEqual(0.8);
      });
    }
  });
});
