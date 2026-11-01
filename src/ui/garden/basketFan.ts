import { SCREEN } from './framing';

// Where an open basket's flowers wait: fanned on an arc over the basket (two
// arcs past eight flowers, twelve at most, the rest a "+N" on the basket),
// inside the part of the screen the rail leaves free, each at least a finger's
// width from the next. The basket sits in the same place and the flowers keep
// one size whatever the day's count, so switching days only swaps the flowers.

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Px from the screen's top left. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A flower's place (its middle, px), its lean (rad, clockwise), and its arc (0 the outer or only one, 1 the one nearer the basket). */
export interface FanSlot {
  readonly x: number;
  readonly y: number;
  readonly tilt: number;
  readonly arc: 0 | 1;
}

export interface Fan {
  /** The basket's middle and size (px), and its scale against its full size. */
  readonly basket: Rect & { readonly x: number; readonly y: number; readonly scale: number };
  /** One per flower shown, for the basket's first finds in order. */
  readonly slots: readonly FanSlot[];
  /** The square each flower may fill (px): also the least distance between two of them. */
  readonly size: number;
  /** Finds left in the basket, shown as "+N" on it. */
  readonly more: number;
}

/** A screen narrower than this (px) shows the basket and its fan smaller. */
export const ROOMY = 560;
/** Flowers shown at most, and the most on one arc. */
export const FAN_MAX = 12;
const ONE_ARC = 8;
/** The basket's full size (px). */
const BASKET = { width: 156, height: 120 } as const;
/** Flowers this far apart (px) on a roomy screen, never nearer than a fingertip. */
const GAP = 76;
export const MIN_GAP = 44;
/** The arc nearest the basket at its smallest (px, at full size), a flower's lean against its place on the arc, and the room kept clear of the rail (px). */
const INNER = 96;
const LEAN = 0.35;
const RAIL_CLEAR = 12;

/** The part of the screen a fan may use: inside the margins finds land within (framing.ts), and left of the rail when given. */
export function freeRect(screen: Size, rail?: { readonly left: number }): Rect {
  const right = ((1 + SCREEN.x) / 2) * screen.width;
  return {
    left: ((1 - SCREEN.x) / 2) * screen.width,
    top: ((1 - SCREEN.top) / 2) * screen.height,
    right: rail ? Math.min(right, rail.left - RAIL_CLEAR) : right,
    bottom: ((1 - SCREEN.bottom) / 2) * screen.height,
  };
}

interface Arrangement {
  /** Relative to the arcs' middle (px, y down). */
  readonly slots: readonly FanSlot[];
  readonly half: number;
  readonly top: number;
  readonly bottom: number;
}

/** Flowers per arc: one arc up to eight, then the outer arc a flower fuller than the inner. */
function arcs(shown: number): readonly number[] {
  if (shown <= ONE_ARC) return [shown];
  const inner = Math.floor((shown - 1) / 2);
  return [shown - inner, inner];
}

/** The smallest radius that fits m flowers `gap` apart on a half circle. */
function halfCircle(m: number, gap: number): number {
  return m <= 1 ? 0 : gap / (2 * Math.sin(Math.PI / (2 * (m - 1))));
}

/** The flowers round the arcs' middle, the basket below it with its top half a gap under it. */
function arrange(shown: number, gap: number, scale: number): Arrangement {
  const counts = arcs(shown);
  // from the basket out: the inner arc at least INNER, each next a gap farther, each wide enough for its flowers
  const radii: number[] = [];
  for (let k = counts.length - 1; k >= 0; k--) {
    const least = radii.length === 0 ? INNER * scale : radii[0] + gap;
    radii.unshift(Math.max(least, halfCircle(counts[k], gap)));
  }
  const slots = counts.flatMap((m, k) => {
    const r = radii[k];
    const step = m > 1 ? 2 * Math.asin(Math.min(1, gap / (2 * r))) : 0;
    return Array.from({ length: m }, (_, j): FanSlot => {
      const a = (j - (m - 1) / 2) * step;
      return { x: r * Math.sin(a), y: -r * Math.cos(a), tilt: LEAN * a, arc: k === 0 ? 0 : 1 };
    });
  });
  const basket = { width: BASKET.width * scale, height: BASKET.height * scale };
  return {
    slots,
    half: Math.max(basket.width / 2, ...slots.map((s) => Math.abs(s.x) + gap / 2)),
    top: Math.min(0, ...slots.map((s) => s.y - gap / 2)),
    bottom: gap / 2 + basket.height,
  };
}

/** Every count's arrangement at this gap, and the room they take together. */
function arrangeAll(gap: number, scale: number): { all: Arrangement[]; half: number; top: number; bottom: number } {
  const all = Array.from({ length: FAN_MAX + 1 }, (_, m) => arrange(m, gap, scale));
  return { all, half: Math.max(...all.map((a) => a.half)), top: Math.min(...all.map((a) => a.top)), bottom: Math.max(...all.map((a) => a.bottom)) };
}

/** The fan for a basket of n finds on this screen, inside `free` (by default the screen inside the landing margins). */
export function basketFan(n: number, screen: Size, free: Rect = freeRect(screen)): Fan {
  const scale = Math.min(1, screen.width / ROOMY);
  const shown = Math.max(0, Math.min(Math.floor(n), FAN_MAX));
  const width = free.right - free.left;
  const height = free.bottom - free.top;
  // the widest spacing at which the fullest fan fits, down to a fingertip
  let gap = Math.max(MIN_GAP, Math.round(GAP * scale));
  let room = arrangeAll(gap, scale);
  while (gap > MIN_GAP && (2 * room.half > width || room.bottom - room.top > height)) room = arrangeAll(--gap, scale);
  // the arcs' middle: every count's fan centred in the free part
  const cx = (free.left + free.right) / 2;
  const cy = free.top + (height - (room.bottom - room.top)) / 2 - room.top;
  const by = cy + gap / 2 + (BASKET.height * scale) / 2;
  const bw = (BASKET.width * scale) / 2;
  const bh = (BASKET.height * scale) / 2;
  return {
    basket: { x: cx, y: by, left: cx - bw, right: cx + bw, top: by - bh, bottom: by + bh, scale },
    slots: room.all[shown].slots.map((s) => ({ ...s, x: cx + s.x, y: cy + s.y })),
    size: gap,
    more: Math.max(0, Math.floor(n) - shown),
  };
}
