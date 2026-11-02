import { describe, expect, it } from 'vitest';
import { basketFan, FAN_MAX, freeRect, MIN_GAP, type Fan, type Rect, type Size } from './basketFan';

const PHONE: Size = { width: 390, height: 844 };
const DESK: Size = { width: 1440, height: 900 };
/** The rail's left edge on each (garden.css: 54 px portrait 10 px from the right on a phone; 44 px buttons on a desk). */
const SCREENS = [
  { name: 'phone', screen: PHONE, free: freeRect(PHONE, { left: 390 - 10 - 54 }) },
  { name: 'desk', screen: DESK, free: freeRect(DESK, { left: 1440 - 24 - 44 }) },
];
const COUNTS = Array.from({ length: 400 }, (_, k) => k + 1);

const inside = (box: Rect, free: Rect): boolean => box.left >= free.left - 1e-9 && box.right <= free.right + 1e-9 && box.top >= free.top - 1e-9 && box.bottom <= free.bottom + 1e-9;
const overlap = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const boxes = (fan: Fan): Rect[] => fan.slots.map((s) => ({ left: s.x - fan.size / 2, right: s.x + fan.size / 2, top: s.y - fan.size / 2, bottom: s.y + fan.size / 2 }));

describe.each(SCREENS)('the fan on a $name', ({ screen, free }) => {
  it('shows the first twelve flowers and counts the rest on the basket', () => {
    for (const n of COUNTS) {
      const fan = basketFan(n, screen, free);
      expect(fan.slots).toHaveLength(Math.min(n, FAN_MAX));
      expect(fan.more).toBe(Math.max(0, n - FAN_MAX));
    }
  });

  it('keeps every flower and the basket inside the free part of the screen, clear of the rail', () => {
    for (const n of COUNTS) {
      const fan = basketFan(n, screen, free);
      expect(inside(fan.basket, free), `basket of ${n}`).toBe(true);
      for (const box of boxes(fan)) expect(inside(box, free), `flower of ${n}`).toBe(true);
    }
  });

  it('keeps the flowers a fingertip apart and off the basket, so each can be picked alone', () => {
    for (const n of COUNTS) {
      const fan = basketFan(n, screen, free);
      expect(fan.size).toBeGreaterThanOrEqual(MIN_GAP);
      fan.slots.forEach((a, i) => {
        for (const b of fan.slots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y), `${n} flowers`).toBeGreaterThanOrEqual(fan.size - 1e-9);
      });
      for (const box of boxes(fan)) expect(overlap(box, fan.basket), `${n} flowers`).toBe(0);
    }
  });

  it('fans up to eight flowers on one arc and nine to twelve on two, each arc round one point over the basket', () => {
    for (const n of COUNTS.slice(0, FAN_MAX)) {
      const fan = basketFan(n, screen, free);
      const used = new Set(fan.slots.map((s) => s.arc));
      expect([...used].sort()).toEqual(n <= 8 ? [0] : [0, 1]);
      if (n < 3) continue;
      // the arcs' middle: on the basket's axis, as far from the outer arc's two ends as from its top flowers
      const outer = fan.slots.filter((s) => s.arc === 0);
      const end = outer[0];
      const mid = outer[Math.floor(outer.length / 2)];
      const cy = (end.x - fan.basket.x) ** 2 + end.y ** 2 - (mid.x - fan.basket.x) ** 2 - mid.y ** 2;
      const centre = { x: fan.basket.x, y: cy / (2 * (end.y - mid.y)) };
      for (const arc of [0, 1] as const) {
        const radii = fan.slots.filter((s) => s.arc === arc).map((s) => Math.hypot(s.x - centre.x, s.y - centre.y));
        if (radii.length > 0) expect(Math.max(...radii) - Math.min(...radii), `${n} flowers, arc ${arc}`).toBeLessThan(1e-6);
      }
      // above the basket
      expect(centre.y).toBeLessThan(fan.basket.top);
    }
  });

  it('is the same on both sides of the basket, the flowers leaning outward', () => {
    for (const n of COUNTS.slice(0, FAN_MAX)) {
      const fan = basketFan(n, screen, free);
      const mirrored = fan.slots.map((s) => ({ x: 2 * fan.basket.x - s.x, y: s.y }));
      for (const m of mirrored) expect(fan.slots.some((s) => Math.abs(s.x - m.x) < 1e-6 && Math.abs(s.y - m.y) < 1e-6)).toBe(true);
      for (const s of fan.slots) expect(Math.sign(s.tilt)).toBe(Math.abs(s.x - fan.basket.x) < 1e-6 ? 0 : Math.sign(s.x - fan.basket.x));
    }
  });

  it('keeps the basket where it is and the flowers one size, whatever the day’s count', () => {
    const first = basketFan(1, screen, free);
    for (const n of COUNTS) {
      const fan = basketFan(n, screen, free);
      expect(fan.basket).toEqual(first.basket);
      expect(fan.size).toBe(first.size);
    }
  });
});

describe('the fan’s size', () => {
  it('shows smaller on a phone than on a roomy screen, never below a fingertip', () => {
    const phone = basketFan(12, PHONE, SCREENS[0].free);
    const desk = basketFan(12, DESK, SCREENS[1].free);
    expect(phone.basket.scale).toBeLessThan(1);
    expect(desk.basket.scale).toBe(1);
    expect(phone.size).toBeGreaterThanOrEqual(MIN_GAP);
    expect(phone.size).toBeLessThan(desk.size);
  });

  it('keeps clear of the rail when it reaches into the landing margins', () => {
    const plain = freeRect(PHONE);
    expect(SCREENS[0].free.right).toBeLessThan(plain.right);
    expect(SCREENS[0].free.right).toBeLessThanOrEqual(390 - 10 - 54 - 12);
  });
});
