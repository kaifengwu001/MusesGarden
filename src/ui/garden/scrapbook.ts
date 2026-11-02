// How a postcard dresses on the Favorite and Album pages, as in a scrapbook: its polaroid's tint, the tape or
// clip that holds it to the page, sometimes a scribbled frame, sometimes a sticker on a free corner. Each card's
// look comes from its id, so it is the same every time the page opens.
import { hashOf } from '../../garden/art';
import { el } from './dom';

/** A polaroid frame's paper: its colour at the top and at the bottom. */
export const TINTS = {
  cream: ['#fdfaf1', '#f1eadb'],
  butter: ['#fbf0b8', '#f2e092'],
  peach: ['#fadbc6', '#f3c6a6'],
  mint: ['#dcefdf', '#c6e2cc'],
  blush: ['#f9dde1', '#efc6cd'],
  sky: ['#dbe8f5', '#c4d8ec'],
} as const;
export type Tint = keyof typeof TINTS;

/** Washi tape, each colour see-through. */
const TAPE_COLOURS = ['#f4b4c4', '#f6df85', '#a9c9ee', '#addcc0', '#f6c29b', '#cdb6ec'] as const;
export type TapePattern = 'plain' | 'stripes' | 'dots' | 'gingham';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

export interface Tape {
  readonly pattern: TapePattern;
  readonly colour: string;
  /** The pattern's second colour: the stripes between, the dots. */
  readonly second: string;
}

/** What holds the card to the page: a strip of tape across its top or a corner (or two corners), or a clip on its top edge. */
export type Holder =
  | { readonly kind: 'tape'; readonly at: 'top' | 'tl' | 'tr' | 'pair'; readonly tape: Tape; readonly turn: number }
  | { readonly kind: 'clip'; readonly clip: 'binder' | 'paper'; readonly colour: string; readonly x: number; readonly turn: number };

export type ScribbleKind = 'loops' | 'wave' | 'rough' | 'brackets';
export interface Scribble {
  readonly kind: ScribbleKind;
  readonly colour: string;
  readonly seed: number;
}

export type StickerName = keyof typeof STICKERS;
export interface Sticker {
  readonly name: StickerName;
  readonly corner: Corner;
  readonly turn: number;
}

export interface Scrap {
  readonly tint: Tint;
  /** Degrees. */
  readonly tilt: number;
  readonly holder: Holder;
  readonly scribble: Scribble | null;
  readonly sticker: Sticker | null;
}

const SCRIBBLE_COLOURS = ['#d4543a', '#2f4fc4', '#ec8cc3', '#b9cc35', '#4b7d5c', '#a98be0'] as const;
const PAPER_CLIPS = ['#e98aa8', '#79a7e0', '#d4b24c', '#9aa3ad', '#6fbf94'] as const;
const BINDER_CLIPS = ['#2b2b30', '#2b2b30', '#2b2b30', '#ef8fae', '#7fc3a3', '#8fb2ea'] as const;

/** A small seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `items`, by weight where given. */
function pick<T>(next: () => number, items: readonly T[], weights?: readonly number[]): T {
  const w = weights ?? items.map(() => 1);
  let r = next() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= w[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

const between = (next: () => number, lo: number, hi: number): number => lo + next() * (hi - lo);

/** The corners a holder covers, where no sticker goes (a clip or a strip across the top crowds both top corners). */
export function covered(holder: Holder): readonly Corner[] {
  if (holder.kind === 'clip') return ['tl', 'tr'];
  switch (holder.at) {
    case 'top':
      return ['tl', 'tr'];
    case 'pair':
      return ['tl', 'br'];
    default:
      return [holder.at];
  }
}

function holderOf(next: () => number): Holder {
  const kind = pick(next, ['top', 'tl', 'tr', 'pair', 'binder', 'paper'] as const, [3, 1, 1, 1.5, 1.5, 2]);
  if (kind === 'binder' || kind === 'paper') {
    return {
      kind: 'clip',
      clip: kind,
      colour: pick(next, kind === 'binder' ? BINDER_CLIPS : PAPER_CLIPS),
      x: between(next, kind === 'binder' ? 0.32 : 0.2, kind === 'binder' ? 0.68 : 0.8),
      turn: between(next, -8, 8),
    };
  }
  const colour = pick(next, TAPE_COLOURS);
  const pattern = pick(next, ['plain', 'stripes', 'dots', 'gingham'] as const, [3, 1.4, 1.2, 1]);
  const second = pattern === 'stripes' && next() < 0.5 ? pick(next, TAPE_COLOURS.filter((c) => c !== colour)) : '#fffaf2';
  return { kind: 'tape', at: kind, tape: { pattern, colour, second }, turn: between(next, -7, 7) };
}

/** How the card with this id dresses on the page. */
export function scrapOf(id: string): Scrap {
  const next = seeded(hashOf(`scrap:${id}`));
  const tint = pick(next, Object.keys(TINTS) as Tint[], [6, 1, 1, 1, 1, 1]);
  const tilt = between(next, -3.2, 3.2);
  const holder = holderOf(next);
  const scribble: Scribble | null =
    next() < 0.36 ? { kind: pick(next, ['loops', 'wave', 'rough', 'brackets'] as const), colour: pick(next, SCRIBBLE_COLOURS), seed: Math.floor(next() * 1e9) } : null;
  const free = CORNERS.filter((c) => !covered(holder).includes(c));
  const sticker: Sticker | null =
    next() < 0.7 ? { name: pick(next, Object.keys(STICKERS) as StickerName[]), corner: pick(next, free), turn: between(next, -24, 24) } : null;
  return { tint, tilt, holder, scribble, sticker };
}

/** The tint as CSS custom properties on a polaroid's paper. */
export function paperOf(tint: Tint): string {
  const [top, bottom] = TINTS[tint];
  return `--snap-top: ${top}; --snap-low: ${bottom};`;
}

// ---- the drawings ---------------------------------------------------------------------------------------------

const n1 = (v: number): string => v.toFixed(1);

/** A polaroid is 100 wide and 80 tall here; a scribble's drawing reaches PAD past each edge. */
export const SNAP = { w: 100, h: 80, pad: 9 } as const;

/** A point on the rectangle `d` outside the polaroid's edge, at `s` along its perimeter (clockwise from the top left),
 *  with the way along and the way out. */
function round(s: number, d: number): { x: number; y: number; tx: number; ty: number } {
  const w = SNAP.w + 2 * d;
  const h = SNAP.h + 2 * d;
  const t = ((s % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
  if (t < w) return { x: -d + t, y: -d, tx: 1, ty: 0 };
  if (t < w + h) return { x: SNAP.w + d, y: -d + (t - w), tx: 0, ty: 1 };
  if (t < 2 * w + h) return { x: SNAP.w + d - (t - w - h), y: SNAP.h + d, tx: -1, ty: 0 };
  return { x: -d, y: SNAP.h + d - (t - 2 * w - h), tx: 0, ty: -1 };
}

const perimeter = (d: number): number => 2 * (SNAP.w + SNAP.h + 4 * d);

/** A line through points, as a path. */
const polyline = (points: readonly (readonly [number, number])[]): string => `M${points.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}`;

/** A coil of loops all the way round, like a telephone cord drawn in crayon. */
function loops(): string {
  const d = 3.5;
  const L = perimeter(d);
  const count = Math.round(L / 8.5);
  const step = L / count;
  const points: [number, number][] = [];
  for (let i = 0; i <= count * 14; i++) {
    const s = (i / 14) * step;
    const p = round(s, d);
    const r = 3.6 + Math.sin(i * 0.37) * 0.25;
    const a = (2 * Math.PI * s) / step + 1.3;
    // out is the tangent turned a quarter, away from the card
    const ox = p.ty;
    const oy = -p.tx;
    points.push([p.x + r * (Math.cos(a) * p.tx + Math.sin(a) * ox) + ox * 0.8, p.y + r * (Math.cos(a) * p.ty + Math.sin(a) * oy) + oy * 0.8]);
  }
  return polyline(points);
}

/** Scallops all the way round. */
function wave(next: () => number): string {
  const d = 2.4;
  const L = perimeter(d);
  const count = Math.round(L / 10);
  const step = L / count;
  const points: [number, number][] = [];
  const wobble = between(next, 0, 10);
  for (let i = 0; i <= count * 10; i++) {
    const s = (i / 10) * step;
    const p = round(s, d);
    const bump = 3.1 * Math.abs(Math.sin((Math.PI * s) / step)) + Math.sin(s * 0.13 + wobble) * 0.4;
    points.push([p.x + p.ty * bump, p.y - p.tx * bump]);
  }
  return polyline(points);
}

/** A rectangle drawn twice in a hurry, each side its own stroke, running past the corners. */
function rough(next: () => number): string {
  const strokes: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const d = 2.5 + pass * 1.6 + between(next, -0.6, 0.6);
    const corners: [number, number][] = [
      [-d, -d],
      [SNAP.w + d, -d],
      [SNAP.w + d, SNAP.h + d],
      [-d, SNAP.h + d],
    ].map(([x, y]) => [x + between(next, -1.2, 1.2), y + between(next, -1.2, 1.2)]);
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k];
      const [bx, by] = corners[(k + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const over = between(next, 1, 3);
      const bow = between(next, -1.6, 1.6);
      strokes.push(
        `M${n1(ax - ux * over)} ${n1(ay - uy * over)}Q${n1((ax + bx) / 2 - uy * bow)} ${n1((ay + by) / 2 + ux * bow)} ${n1(bx + ux * over)} ${n1(by + uy * over)}`,
      );
    }
  }
  return strokes.join('');
}

/** Four corner marks, as if marking where the photo goes. */
function brackets(next: () => number): string {
  const d = 4;
  const arm = (): number => between(next, 15, 21);
  const marks: string[] = [];
  const at: [number, number, number, number][] = [
    [-d, -d, 1, 1],
    [SNAP.w + d, -d, -1, 1],
    [SNAP.w + d, SNAP.h + d, -1, -1],
    [-d, SNAP.h + d, 1, -1],
  ];
  for (const [x, y, sx, sy] of at) {
    const a = arm();
    const b = arm() * 0.8;
    const j = (): number => between(next, -0.7, 0.7);
    marks.push(`M${n1(x + j())} ${n1(y + sy * b)}L${n1(x + j())} ${n1(y + j())}L${n1(x + sx * a)} ${n1(y + j())}`);
  }
  return marks.join('');
}

const SCRIBBLES: Record<ScribbleKind, { draw: (next: () => number) => string; width: number }> = {
  loops: { draw: loops, width: 1.5 },
  wave: { draw: wave, width: 1.9 },
  rough: { draw: rough, width: 1.7 },
  brackets: { draw: brackets, width: 2.6 },
};

/** A scribbled frame round a polaroid, in crayon: grainy, and gone over twice. `uid` names its grain filter. */
export function scribbleSvg(scribble: Scribble, uid: string): string {
  const { draw, width } = SCRIBBLES[scribble.kind];
  const d = draw(seeded(scribble.seed));
  const { w, h, pad } = SNAP;
  return (
    `<svg viewBox="${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}" preserveAspectRatio="none" aria-hidden="true">` +
    `<filter id="${uid}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="${scribble.seed % 97}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3.2 0 0 0 -0.75" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>` +
    `<g filter="url(#${uid})" fill="none" stroke="${scribble.colour}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${d}" stroke-width="${width}"/><path d="${d}" stroke-width="${n1(width * 0.55)}" opacity="0.6" transform="translate(0.45 0.35)"/></g></svg>`
  );
}

/** Points of a star, as a path. */
function star(cx: number, cy: number, outer: number, inner: number): string {
  const points: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return `${polyline(points)}Z`;
}

const INK = '#3b3530';

/** Stickers on a 40 by 40 sheet: `cut` ones are die-cut, with a white edge and a shadow; the others are doodles in ink. */
export const STICKERS = {
  star: {
    cut: true,
    svg: `<path d="${star(20, 21.5, 17, 8)}" fill="#f7cd48" stroke="#f7cd48" stroke-width="3" stroke-linejoin="round"/><circle cx="16.5" cy="21" r="1.3" fill="${INK}"/><circle cx="23.5" cy="21" r="1.3" fill="${INK}"/><path d="M17.8 24.4q2.2 1.8 4.4 0" stroke="${INK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  },
  heart: {
    cut: true,
    svg: `<path d="M20 34C6 24 4 14 11 9c4-3 8-1 9 3 1-4 5-6 9-3 7 5 5 15-9 25Z" fill="#f2849f"/><ellipse cx="12.5" cy="13.5" rx="2.4" ry="1.5" fill="#fff" opacity=".7" transform="rotate(-35 12.5 13.5)"/>`,
  },
  flower: {
    cut: true,
    svg: `${[0, 1, 2, 3, 4].map((k) => `<circle cx="${n1(20 + 8.6 * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 5))}" cy="${n1(20 + 8.6 * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 5))}" r="7.4" fill="#f5a3c7"/>`).join('')}<circle cx="20" cy="20" r="5.6" fill="#f9d65c"/>`,
  },
  smiley: {
    cut: true,
    svg: `<circle cx="20" cy="20" r="15" fill="#fbd85d"/><ellipse cx="15" cy="17" rx="1.6" ry="2.4" fill="${INK}"/><ellipse cx="25" cy="17" rx="1.6" ry="2.4" fill="${INK}"/><path d="M13.5 23q6.5 7 13 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="11" cy="23" r="2.2" fill="#f39aa5" opacity=".8"/><circle cx="29" cy="23" r="2.2" fill="#f39aa5" opacity=".8"/>`,
  },
  cherries: {
    cut: true,
    svg: `<path d="M13 23q2-11 10-17M27 22q-3-9-4-16" stroke="#4f8a45" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M23 6q8-4 11 2-7 3-11-2Z" fill="#7cbf5a"/><circle cx="13" cy="28" r="7" fill="#e5484d"/><circle cx="27.5" cy="27" r="7" fill="#e5484d"/><ellipse cx="10.5" cy="25.5" rx="1.8" ry="1.2" fill="#fff" opacity=".7"/><ellipse cx="25" cy="24.5" rx="1.8" ry="1.2" fill="#fff" opacity=".7"/>`,
  },
  cloud: {
    cut: true,
    svg: `<path d="M9 31c-6 0-6-9 1-9 0-8 10-10 13-4 3-4 11-2 9 5 5 1 5 8-1 8Z" fill="#cfe5f7"/><circle cx="16" cy="25" r="1.2" fill="${INK}"/><circle cx="24" cy="25" r="1.2" fill="${INK}"/><path d="M18.4 27.4q1.6 1.3 3.2 0" stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round"/><circle cx="13" cy="27.5" r="1.6" fill="#f39aa5" opacity=".7"/><circle cx="27" cy="27.5" r="1.6" fill="#f39aa5" opacity=".7"/>`,
  },
  mushroom: {
    cut: true,
    svg: `<path d="M15 21l-1 10q6 3 12 0l-1-10Z" fill="#f6ead2"/><path d="M5 22C5 8 35 8 35 22Z" fill="#e85f4f"/><circle cx="13" cy="16" r="2.6" fill="#fff"/><circle cx="21.5" cy="12.5" r="2.1" fill="#fff"/><circle cx="28" cy="17.5" r="2.3" fill="#fff"/>`,
  },
  sparkle: {
    cut: true,
    svg: `<path d="M20 3c1 12 5 16 17 17-12 1-16 5-17 17-1-12-5-16-17-17 12-1 16-5 17-17Z" fill="#9fdcc4"/><path d="M33 5c.4 3.5 1.5 4.6 5 5-3.5.4-4.6 1.5-5 5-.4-3.5-1.5-4.6-5-5 3.5-.4 4.6-1.5 5-5Z" fill="#f7cd48"/>`,
  },
  stars: {
    cut: false,
    svg: `<g fill="none" stroke="#eea13a" stroke-width="1.7" stroke-linejoin="round"><path d="${star(14, 14, 9, 4)}"/><path d="${star(30, 24, 6.5, 3)}"/><path d="${star(13, 32, 4.5, 2)}"/></g>`,
  },
  note: {
    cut: false,
    svg: `<path d="M15 30V10l15-3v19" stroke="#6d8fdc" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M15 14l15-3" stroke="#6d8fdc" stroke-width="2"/><ellipse cx="12" cy="30" rx="3.6" ry="2.7" fill="#6d8fdc" transform="rotate(-20 12 30)"/><ellipse cx="27" cy="26" rx="3.6" ry="2.7" fill="#6d8fdc" transform="rotate(-20 27 26)"/>`,
  },
  cat: {
    cut: false,
    svg: `<g fill="none" stroke="#e3799c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 31c-2-7-1-14 2-21l6 6q4-1.5 8 0l6-6c3 7 4 14 2 21-6 3-18 3-24 0Z"/><path d="M16 22.5v.5M24 22.5v.5"/><path d="M18.5 26q1.5 1.2 3 0"/><path d="M3 23l7 1.5M3 28l7-1M37 23l-7 1.5M37 28l-7-1"/></g>`,
  },
  hearts: {
    cut: false,
    svg: `<g fill="none" stroke="#ec6a86" stroke-width="1.8" stroke-linejoin="round"><path d="M15 29C5 22 4 15 9 12c3-2 5.5-.6 6 2 .5-2.6 3-4 6-2 5 3 4 10-6 17Z"/><path d="M30 18c-6-4-6.5-8.5-3.5-10.5 2-1.2 3.4-.3 3.7 1.3.3-1.6 1.8-2.5 3.7-1.3 3 2 2.4 6.5-3.9 10.5Z"/></g>`,
  },
  sun: {
    cut: false,
    svg: `<circle cx="20" cy="20" r="7" fill="#fde3a0" stroke="#f0a530" stroke-width="1.8"/><g stroke="#f0a530" stroke-width="1.8" stroke-linecap="round">${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k * Math.PI) / 4; return `<path d="M${n1(20 + 10.5 * Math.cos(a))} ${n1(20 + 10.5 * Math.sin(a))}L${n1(20 + 15 * Math.cos(a))} ${n1(20 + 15 * Math.sin(a))}"/>`; }).join('')}</g>`,
  },
  swirl: {
    cut: false,
    svg: `<g fill="none" stroke="#5872d6" stroke-width="1.6" stroke-linecap="round"><path d="M4 33c7-14 15 4 19-9s-3-12-6-6 6 9 15-4" stroke-dasharray="2.6 2.6"/><path d="M36 9l-.5 5.5-5-2"/></g>`,
  },
} as const satisfies Record<string, { readonly cut: boolean; readonly svg: string }>;

function stickerSvg(name: StickerName): string {
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${STICKERS[name].svg}</svg>`;
}

/** A binder clip seen from the front: its body over the card's top edge (at y 36 of 56), its two wire handles
 *  folded up into an arch over it, each through a curl at the body's top corner. */
function binderSvg(colour: string): string {
  return (
    `<svg viewBox="0 0 60 56" aria-hidden="true"><path d="M16.5 26L20 7q.5-3 3.5-3h13q3 0 3.5 3l3.5 19" stroke="#aeb4bd" stroke-width="2.4" fill="none" stroke-linejoin="round"/>` +
    `<path d="M17.6 25L21 7.4q.4-2.2 2.6-2.2h12.8q2.2 0 2.6 2.2L42.4 25" stroke="#fff" stroke-opacity=".55" stroke-width=".7" fill="none"/>` +
    `<path d="M10 25h40v19q0 2-2 2H12q-2 0-2-2Z" fill="${colour}"/><path d="M10 25h40v4H10Z" fill="#fff" fill-opacity=".2"/>` +
    `<circle cx="15.5" cy="26" r="2.6" fill="none" stroke="#aeb4bd" stroke-width="1.8"/><circle cx="44.5" cy="26" r="2.6" fill="none" stroke="#aeb4bd" stroke-width="1.8"/></svg>`
  );
}

/** A paper clip, its lower half over the card (the top edge at y 26 of 60). */
function paperSvg(colour: string): string {
  return `<svg viewBox="0 0 20 60" aria-hidden="true"><path d="M7 22v24a3.5 3.5 0 0 0 7 0V10a6 6 0 0 0-12 0v40a8 8 0 0 0 16 0V18" stroke="${colour}" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M3.4 10a5 5 0 0 1 3-4.4" stroke="#fff" stroke-opacity=".6" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
}

function tapeNode(tape: Tape, at: 'top' | Corner, turn: number): HTMLElement {
  const node = el('span', `g-tape g-tape-${at} g-tape-${tape.pattern}`);
  node.style.setProperty('--tape', tape.colour);
  node.style.setProperty('--tape-2', tape.second);
  node.style.setProperty('--turn', `${turn.toFixed(1)}deg`);
  return node;
}

/** What goes on the page round a polaroid: the scribble, the tape or clip, the sticker. `uid` is unique on the page. */
export function trimmings(scrap: Scrap, uid: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (scrap.scribble) {
    const node = el('span', 'g-scribble');
    node.innerHTML = scribbleSvg(scrap.scribble, `crayon-${uid}`);
    out.push(node);
  }
  const { holder } = scrap;
  if (holder.kind === 'tape') {
    const at: ('top' | Corner)[] = holder.at === 'pair' ? ['tl', 'br'] : [holder.at];
    for (const [k, corner] of at.entries()) out.push(tapeNode(holder.tape, corner, holder.turn * (k === 0 ? 1 : -0.7)));
  } else {
    const node = el('span', `g-clip g-clip-${holder.clip}`);
    node.innerHTML = holder.clip === 'binder' ? binderSvg(holder.colour) : paperSvg(holder.colour);
    node.style.setProperty('--at', `${(holder.x * 100).toFixed(1)}%`);
    node.style.setProperty('--turn', `${holder.turn.toFixed(1)}deg`);
    out.push(node);
  }
  if (scrap.sticker) {
    const { name, corner, turn } = scrap.sticker;
    const node = el('span', `g-sticker g-sticker-${corner}${STICKERS[name].cut ? ' is-cut' : ''}`);
    node.dataset.sticker = name;
    node.innerHTML = stickerSvg(name);
    node.style.setProperty('--turn', `${turn.toFixed(1)}deg`);
    out.push(node);
  }
  return out;
}
