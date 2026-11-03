// What Muse wrote or drew on a postcard's back (PostcardBack in garden/types.ts), drawn into the message side: a
// line in its hand, a crayon doodle, the planet drawn small with an X, a note, a list, a find pressed flat, a travel
// stub, a game of noughts and crosses, a riddle with its answer upside down, a tally, a little poem. It all lies in
// one box sized by its own width (cqw), so a card reads the same on a phone as on a desk. Each card's hand (its pen,
// its crayons, its tilt) comes from its id, so a card looks the same every time it turns over. Muse's words only
// ever go in as text, never as markup.
import { hashOf } from '../../garden/art';
import type { Doodle, Postcard, PostcardBack } from '../../garden/types';
import { el, shortDate } from './dom';
import { FLOWER_PICTURES } from './flowerPictures';
import { between, crayonFilter, INK, n1, pick, polyline, seeded, star, TAPE_COLOURS, tapeNode } from './scrapbook';

// ---- the planet drawn small ------------------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sum = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Two directions square to `n` and to each other. */
function tangents(n: Vec3): readonly [Vec3, Vec3] {
  const e1 = unit(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n));
  return [e1, cross(n, e1)];
}

/** Where a point on the planet (a unit direction from its centre) shows on the globe drawn small: x right and y up
 *  across its disc (-1..1), z toward you (below 0, round the back). */
export type Globe = (p: Vec3) => { x: number; y: number; z: number };

/** The globe seen from over `dir`, leant `lean` radians from it toward `turn` (radians round it), north up: the
 *  spot at `dir` faces you, a little off the middle. */
export function globeFacing(dir: Vec3, lean: number, turn: number): Globe {
  const d = unit(dir);
  const [e1, e2] = tangents(d);
  const toward = sum(d, Math.cos(lean), sum(e1, Math.cos(turn), e2, Math.sin(turn)), Math.sin(lean));
  const north: Vec3 = Math.abs(toward[1]) < 0.98 ? [0, 1, 0] : [0, 0, -1];
  const up = unit(sum(north, 1, toward, -dot(north, toward)));
  const right = cross(up, toward);
  return (p) => ({ x: dot(p, right), y: dot(p, up), z: dot(p, toward) });
}

/** The planet's land as the map sketches it: the same few continents on every card. */
const LAND = ((): readonly (readonly Vec3[])[] => {
  const next = seeded(hashOf('muse-map-land'));
  return Array.from({ length: 9 }, () => {
    const centre = unit([between(next, -1, 1), between(next, -1, 1), between(next, -1, 1)]);
    const [e1, e2] = tangents(centre);
    const reach = between(next, 0.28, 0.62);
    const [p1, p2, a1, a2] = [between(next, 0, 6.3), between(next, 0, 6.3), between(next, 0.12, 0.3), between(next, 0.05, 0.16)];
    return Array.from({ length: 36 }, (_, k) => {
      const a = (k / 36) * 2 * Math.PI;
      const r = reach * (1 + a1 * Math.sin(2 * a + p1) + a2 * Math.sin(5 * a + p2));
      return sum(centre, Math.cos(r), sum(e1, Math.cos(a), e2, Math.sin(a)), Math.sin(r));
    });
  });
})();

// ---- noughts and crosses ---------------------------------------------------------------------------------------

export type Cell = 'x' | 'o' | null;

/** A board's nine cells, row by row, as the engine writes them ('x' Muse, 'o' the friend, '.' empty); anything else,
 *  or a cell missing, is empty. */
export function parseBoard(board: string): Cell[] {
  return Array.from({ length: 9 }, (_, i) => {
    const c = board.charAt(i).toLowerCase();
    return c === 'x' || c === 'o' ? c : null;
  });
}

const ROWS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

/** The row, column or diagonal one player has all of, if any. */
export function winningLine(cells: readonly Cell[]): readonly [number, number, number] | null {
  return ROWS.find(([a, b, c]) => cells[a] !== null && cells[a] === cells[b] && cells[a] === cells[c]) ?? null;
}

// ---- tally marks -----------------------------------------------------------------------------------------------

/** The most marks a tally draws; a count past it is still written in full. */
export const TALLY_MOST = 45;

/** A count as tally marks: groups of five (four strokes and one across), the last group what is left over. */
export function tallyGroups(count: number): number[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.min(TALLY_MOST, Math.floor(count))) : 0;
  return Array.from({ length: Math.ceil(n / 5) }, (_, k) => Math.min(5, n - k * 5));
}

// ---- the hand: how big, what colours, which way it leans ------------------------------------------------------

/** The size (cqw) to write something this long in: the first step it fits, else the last step's. */
export function handSize(length: number, steps: readonly (readonly [number, number])[]): number {
  return (steps.find(([most]) => length <= most) ?? steps[steps.length - 1])[1];
}

/** Muse's pens: mostly blue-black. */
const PENS = ['#2b3a67', '#3b3530', '#5a3b2e', '#264f47'] as const;

/** Crayons: a colour and the darker one it is gone round in. */
type Crayon = readonly [string, string];
const C = {
  red: ['#e5695a', '#c0432f'],
  orange: ['#f6a25a', '#cf6a2a'],
  yellow: ['#f7cd48', '#d9a22b'],
  green: ['#8cc56a', '#4f8a45'],
  blue: ['#8fb2ea', '#4a6fb5'],
  sky: ['#b9d6ef', '#5b86c4'],
  pink: ['#f5a3c7', '#c75a8a'],
  violet: ['#cdb6ec', '#8f6fc8'],
  mint: ['#addcc0', '#4b8a63'],
  brown: ['#c8694a', '#8a4a32'],
  cream: ['#f3e3bf', '#8a6148'],
} as const satisfies Record<string, Crayon>;
/** The crayons a mark (a tick, an X, a tally) is made in. */
const MARKERS = ['#d4543a', '#2f4fc4', '#4b7d5c', '#a6539a', '#e07b2c'] as const;

interface Hand {
  /** Unique to this card on the page: names its filters and clips. */
  readonly uid: string;
  readonly seed: number;
  readonly next: () => number;
  readonly pen: string;
}

function handOf(id: string): Hand {
  const seed = hashOf(`back:${id}`);
  const next = seeded(seed);
  return { uid: `pcb${seed.toString(36)}`, seed, next, pen: pick(next, PENS, [4, 1.4, 1.2, 1]) };
}

// ---- crayon ----------------------------------------------------------------------------------------------------

/** One mark in crayon: a shape coloured in back and forth (`fill`), gone round twice (`line`), or both. */
interface Mark {
  readonly d: string;
  readonly fill?: string;
  readonly line?: string;
  readonly width?: number;
  /** A dotted line: its dash pattern. */
  readonly dash?: string;
  readonly opacity?: number;
}

/** The back-and-forth strokes a crayon colours a shape in with, across a `w` by `h` drawing. */
function hatch(next: () => number, w: number, h: number): string {
  const gap = 4.6;
  const lean = h * 0.18;
  const points: [number, number][] = [];
  for (let y = -gap; y < h + lean + gap; y += gap) {
    points.push([-4 + between(next, -1.5, 1.5), y + between(next, -0.5, 0.5)]);
    points.push([w + 4 + between(next, -1.5, 1.5), y - lean + between(next, -0.5, 0.5)]);
  }
  return polyline(points);
}

/** A crayon drawing on a `w` by `h` sheet: each mark in order, all of it grainy. `key` tells this card's drawings apart. */
function crayon(hand: Hand, key: string, w: number, h: number, marks: readonly Mark[]): string {
  const id = `${hand.uid}-${key}`;
  const defs = [crayonFilter(`${id}-g`, hand.seed + key.length), `<path id="${id}-h" d="${hatch(seeded(hand.seed ^ hashOf(key)), w, h)}"/>`];
  const body = marks.map((m, i) => {
    const parts: string[] = [];
    if (m.fill) {
      defs.push(`<clipPath id="${id}-c${i}"><path d="${m.d}"/></clipPath>`);
      parts.push(`<path d="${m.d}" fill="${m.fill}" opacity="0.38"/>`);
      parts.push(`<use href="#${id}-h" clip-path="url(#${id}-c${i})" stroke="${m.fill}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if (m.line) {
      const width = m.width ?? 2;
      const dash = m.dash ? ` stroke-dasharray="${m.dash}"` : '';
      parts.push(`<path d="${m.d}" stroke="${m.line}" stroke-width="${width}"${dash} fill="none"/>`);
      if (!m.dash) parts.push(`<path d="${m.d}" stroke="${m.line}" stroke-width="${n1(width * 0.55)}" opacity="0.6" transform="translate(0.45 0.35)" fill="none"/>`);
    }
    return m.opacity === undefined ? parts.join('') : `<g opacity="${m.opacity}">${parts.join('')}</g>`;
  });
  return (
    `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs>${defs.join('')}</defs>` +
    `<g filter="url(#${id}-g)" stroke-linecap="round" stroke-linejoin="round">${body.join('')}</g></svg>`
  );
}

const circle = (cx: number, cy: number, r: number): string => `M${n1(cx - r)} ${n1(cy)}a${r} ${r} 0 1 0 ${n1(2 * r)} 0a${r} ${r} 0 1 0 ${n1(-2 * r)} 0Z`;

/** Short strokes out from a centre, every other one longer. */
function rays(cx: number, cy: number, from: number, to: number, count: number, turn: number): string {
  return Array.from({ length: count }, (_, k) => {
    const a = turn + (k * 2 * Math.PI) / count;
    const r = k % 2 === 0 ? to : to - 4;
    return `M${n1(cx + from * Math.cos(a))} ${n1(cy + from * Math.sin(a))}L${n1(cx + r * Math.cos(a))} ${n1(cy + r * Math.sin(a))}`;
  }).join('');
}

/** A heart `w` wide whose dip is at (cx, top). */
function heart(cx: number, top: number, w: number): string {
  const p = (u: number, v: number): string => `${n1(cx + u * w)} ${n1(top + v * w)}`;
  return `M${p(0, 0.811)}C${p(-0.405, 0.541)} ${p(-0.5, 0.27)} ${p(-0.338, 0.122)}C${p(-0.203, 0)} ${p(-0.054, 0.054)} ${p(0, 0.203)}C${p(0.054, 0.054)} ${p(0.203, 0)} ${p(0.338, 0.122)}C${p(0.5, 0.27)} ${p(0.405, 0.541)} ${p(0, 0.811)}Z`;
}

/** A four-pointed twinkle. */
function twinkle(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
}

/** A raindrop hanging from (x, y). */
const drop = (x: number, y: number): string =>
  `M${x} ${y}C${x - 2} ${y + 4} ${x - 4.5} ${y + 7} ${x - 3} ${y + 9.5}C${x - 1.5} ${y + 12} ${x + 2.5} ${y + 12} ${x + 3.5} ${y + 9.5}C${x + 4.5} ${y + 7} ${x + 2} ${y + 4} ${x} ${y}Z`;

/** A soft outline through `points` (in order round the shape), bulging out a little between each two: fur. */
function fluffy(points: readonly (readonly [number, number])[], bump: number): string {
  const [cx, cy] = points.reduce(([x, y], p) => [x + p[0] / points.length, y + p[1] / points.length], [0, 0]);
  const parts = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = Math.hypot(mx - cx, my - cy) || 1;
    return `Q${n1(mx + ((mx - cx) / out) * bump)} ${n1(my + ((my - cy) / out) * bump)} ${n1(b[0])} ${n1(b[1])}`;
  });
  return `M${n1(points[0][0])} ${n1(points[0][1])}${parts.join('')}Z`;
}

/** Muse, as it draws itself: a hood and a round body in one, wider at the bottom, flat where it stands. */
const museOutline = Array.from({ length: 30 }, (_, k): [number, number] => {
  const a = (k / 30) * 2 * Math.PI - Math.PI / 2;
  const rx = 24 + 6.5 * Math.sin(a);
  return [50 + rx * Math.cos(a), Math.min(89, 53 + 36 * Math.sin(a))];
});
/** Its arm, up and waving. */
const armOutline: readonly [number, number][] = [
  [70, 62],
  [74, 52],
  [77, 42],
  [79, 33],
  [83, 28.5],
  [87.5, 32],
  [86.5, 42],
  [83, 53],
  [76, 64],
];
const MUSE_FUR = '#fbf6ec';

const CLOUD = (y: number): string => `M22 ${y}a10 10 0 0 1 2-19a14 14 0 0 1 24-10a12 12 0 0 1 22 6a11 11 0 0 1 10 23Z`;

/** Each doodle on a 100 by 100 sheet, its colours sometimes picked from a few. */
const DOODLES: Record<Doodle, (next: () => number) => readonly Mark[]> = {
  sun: () => [
    { d: rays(50, 50, 26, 38, 12, 0.2), line: C.orange[1], width: 2.8 },
    { d: circle(50, 50, 19), fill: C.yellow[0], line: C.yellow[1], width: 2.2 },
    { d: 'M41.5 48q2.6-3 5.2 0M53.3 48q2.6-3 5.2 0M43.5 55q6.5 6 13 0', line: INK, width: 1.8 },
    { d: circle(39.5, 55, 2.4) + circle(60.5, 55, 2.4), fill: '#f39aa5' },
  ],
  cloud: () => [
    { d: 'M8 34q7-4 14 0M12 25q5-3 10 0', line: C.sky[1], width: 1.8 },
    { d: CLOUD(70), fill: C.sky[0], line: C.sky[1], width: 2.2 },
    { d: circle(42, 58, 1.7) + circle(56, 58, 1.7), fill: INK },
    { d: 'M46 62q3 2.6 6 0', line: INK, width: 1.5 },
    { d: circle(37.5, 62, 2.2) + circle(60.5, 62, 2.2), fill: '#f39aa5' },
  ],
  rain: () => [
    { d: CLOUD(48), fill: '#c9d4e0', line: '#6f87a6', width: 2.2 },
    { d: circle(42, 37, 1.6) + circle(56, 37, 1.6), fill: INK },
    { d: 'M46 42q3-2 6 0', line: INK, width: 1.4 },
    { d: drop(32, 56) + drop(50, 60) + drop(68, 55) + drop(41, 72) + drop(60, 74), fill: C.blue[0], line: C.blue[1], width: 1.3 },
    { d: 'M28 93q22-7 44 0q-22 5-44 0Z', fill: C.sky[0], line: C.sky[1], width: 1.4 },
  ],
  muse: () => [
    { d: 'M89 25l4-3M91 32l5-.5M87 18l2-4', line: '#a3968a', width: 1.5 },
    { d: fluffy(armOutline, 1.6), fill: MUSE_FUR, line: '#a3968a', width: 1.9 },
    { d: fluffy(museOutline, 2), fill: MUSE_FUR, line: '#a3968a', width: 2 },
    { d: 'M39 39c0-7 5-11 12-11s12 4 12 11-5 10.5-12 10.5S39 46 39 39Z', fill: '#f8e3d2', line: '#c9b29c', width: 1.3 },
    { d: circle(46, 38, 1.8) + circle(56, 38, 1.8), fill: INK },
    { d: 'M48.4 42.6q2.6 2.4 5.2 0', line: INK, width: 1.4 },
    { d: circle(43.5, 43, 2.1) + circle(58.5, 43, 2.1), fill: '#f4a0a6' },
  ],
  laptop: () => [
    { d: 'M87.5 46q-2.5-3 0-6t0-6M91.5 46q-2.5-3 0-6', line: '#a9b1bb', width: 1.5 },
    { d: 'M22 28h46q3 0 3 3v33H19V31q0-3 3-3Z', fill: '#a7afba', line: '#5a616c', width: 2 },
    { d: 'M24 33h42v27H24Z', fill: '#bfe3f7' },
    { d: heart(45, 41, 12), fill: '#f2849f', line: '#d2486a', width: 1 },
    { d: 'M12 64h66l6 8q1 3-2 3H8q-3 0-2-3Z', fill: '#cdd2d9', line: '#5a616c', width: 2 },
    { d: 'M22 68.5h6M31 68.5h6M40 68.5h6M49 68.5h6M58 68.5h6', line: '#8d929b', width: 1.3 },
    { d: 'M84 50h10v13q0 4-4 4h-2q-4 0-4-4Z', fill: C.pink[0], line: C.pink[1], width: 1.8 },
    { d: 'M94 54q4.5 0 4.5 4t-4.5 4', line: C.pink[1], width: 1.6 },
  ],
  flower: (next) => {
    const petal = pick(next, [C.pink, C.blue, C.orange, C.violet]);
    const petals = Array.from({ length: 5 }, (_, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      return circle(50 + 10.5 * Math.cos(a), 32 + 10.5 * Math.sin(a), 9);
    }).join('');
    return [
      { d: 'M50 93C51 78 47 62 50 44M38 93l3-6M62 93l-2-6M44 93l1-4', line: C.green[1], width: 2.8 },
      { d: 'M49.5 78C40 72 30 74 25 66C36 61 46 67 49.5 78ZM50 66C59 57 68 58 74 50C63 48 54 55 50 66Z', fill: C.green[0], line: C.green[1], width: 1.8 },
      { d: petals, fill: petal[0], line: petal[1], width: 1.8 },
      { d: circle(50, 32, 6), fill: C.yellow[0], line: C.yellow[1], width: 1.6 },
    ];
  },
  bird: (next) => {
    const body = pick(next, [C.blue, C.orange, C.mint, C.pink]);
    return [
      { d: 'M80 30V18l7-2v12', line: INK, width: 1.6 },
      { d: circle(78.4, 30, 2.3) + circle(85.4, 28, 2.3), fill: INK },
      { d: 'M30 54L13 45L17 60Z', fill: body[0], line: body[1], width: 1.8 },
      { d: circle(48, 55, 20), fill: body[0], line: body[1], width: 2.2 },
      { d: 'M33 62C40 74 56 76 65 63C56 70 42 70 33 62Z', fill: '#fbf3e4' },
      { d: 'M38 52C45 47 56 50 58 60C50 64 41 60 38 52Z', fill: body[1], line: body[1], width: 1.4 },
      { d: circle(57, 48, 2.1), fill: INK },
      { d: 'M66 50l10 3.5-10 3.5Z', fill: C.yellow[0], line: '#c97f1c', width: 1.4 },
      { d: 'M44 75v8l-3 2M44 83l3 2M53 75v8l-3 2M53 83l3 2', line: '#e08a2e', width: 1.6 },
    ];
  },
  fish: (next) => {
    const body = pick(next, [C.orange, C.blue, C.yellow, C.pink]);
    return [
      { d: circle(12, 38, 3) + circle(9, 27, 2.2) + circle(14, 18, 1.6), line: C.sky[1], width: 1.3 },
      { d: 'M30 86q6-4 12 0t12 0t12 0', line: C.sky[1], width: 1.6, opacity: 0.7 },
      { d: 'M70 52L87 39Q84 52 87 65Z', fill: body[0], line: body[1], width: 2 },
      { d: 'M18 52C28 35 56 33 72 52C56 71 28 69 18 52Z', fill: body[0], line: body[1], width: 2.2 },
      { d: 'M42 38Q48 30 56 37M44 66q5 7 11 4M44 45q4 7 0 14M53 43q4.5 9 0 18M62 46q3.5 6 0 12', line: body[1], width: 1.4 },
      { d: circle(31, 49, 3.4), fill: '#ffffff', line: INK, width: 1.2 },
      { d: circle(31.8, 49, 1.5), fill: INK },
      { d: 'M20 55q3 1 5-1', line: INK, width: 1.2 },
    ];
  },
  house: () => [
    { d: 'M67 22q-4-4 0-8t0-8', line: '#a9b1bb', width: 1.8 },
    { d: 'M63 26h8v18h-8Z', fill: '#b46a4e', line: '#7a4632', width: 1.8 },
    { d: 'M25 52h50v34H25Z', fill: C.cream[0], line: C.cream[1], width: 2 },
    { d: 'M18 53L50 24L82 53Z', fill: C.brown[0], line: C.brown[1], width: 2.2 },
    { d: 'M42 86V70q0-5 7-5t7 5v16Z', fill: '#8a6148', line: '#6b4733', width: 1.6 },
    { d: circle(52.5, 77, 1.1), fill: C.yellow[0] },
    { d: 'M60 62h10v10H60Z', fill: '#a9cbe8', line: C.cream[1], width: 1.6 },
    { d: 'M65 62v10M60 67h10', line: C.cream[1], width: 1.2 },
    { d: 'M10 86.5h80M16 86l-2-5M20 86l1-5M78 86l-1-5M83 86l2-5', line: '#6fa05a', width: 2.2 },
  ],
  planet: () => [
    { d: twinkle(16, 22, 6) + twinkle(86, 34, 4.5) + twinkle(82, 84, 5.5) + twinkle(18, 78, 3.5), fill: C.yellow[0], line: C.yellow[1], width: 1 },
    { d: circle(50, 54, 27), fill: C.green[0], line: '#5f8f3c', width: 2.2 },
    { d: 'M54 68q6-5 13 0q-2 6-8 6t-5-6Z', fill: '#6f9f45' },
    { d: 'M34 61q1-6 8-6 7 0 7 5t-8 6q-7 0-7-5Z', fill: C.blue[0], line: C.blue[1], width: 1.2 },
    { d: 'M45.5 29V22h9v7Z', fill: C.cream[0], line: C.cream[1], width: 1.2 },
    { d: 'M43.5 22.5L50 16.5L56.5 22.5Z', fill: C.brown[0], line: C.brown[1], width: 1.2 },
    { d: circle(63, 27.6, 3), fill: '#fbf6ec', line: '#a3968a', width: 1 },
  ],
  heart: (next) => {
    const colour = pick(next, [C.pink, C.red, ['#f7a1a8', '#d2486a'] as const]);
    return [
      { d: heart(84, 12, 12) + heart(14, 20, 9) + heart(87, 62, 8), line: colour[1], width: 1.5 },
      { d: heart(50, 26, 74), fill: colour[0], line: colour[1], width: 2.4 },
      { d: 'M28.5 45q1.5-6 8-8', line: '#ffffff', width: 2.6, opacity: 0.85 },
    ];
  },
  leaf: (next) => {
    const colour = pick(next, [C.green, C.green, C.orange, C.yellow, C.red]);
    return [
      { d: 'M26 80L14 92', line: colour[1], width: 2.6 },
      { d: 'M26 80C22 50 44 22 84 16C84 52 60 78 26 80Z', fill: colour[0], line: colour[1], width: 2 },
      { d: 'M26 80Q52 54 82 18', line: colour[1], width: 1.6 },
      { d: 'M36 70L32 56M36 70L50 70M46 60L44 45M46 60L60 59M57 48L57 35M57 48L70 46M68 36L69 26M68 36L77 33', line: colour[1], width: 1.2 },
    ];
  },
  boat: (next) => {
    const hull = pick(next, [C.brown, C.blue, C.red]);
    const sail = pick(next, [C.yellow, C.pink, C.mint]);
    return [
      { d: 'M6 76q6-4 12 0t12 0t12 0t12 0t12 0t12 0t12 0t12 0', line: '#a9cbe8', width: 2 },
      { d: 'M50 68V16', line: '#8a6148', width: 2.4 },
      { d: 'M53 20L53 62L82 62Z', fill: '#fdf8ee', line: '#8d929b', width: 1.8 },
      { d: 'M47 28L47 62L24 62Z', fill: sail[0], line: sail[1], width: 1.8 },
      { d: 'M50 16l9 3-9 3Z', fill: '#e5484d', line: '#b83a3e', width: 1 },
      { d: 'M16 66h68l-10 14H27Z', fill: hull[0], line: hull[1], width: 2.2 },
      { d: circle(40, 72, 2) + circle(52, 72, 2) + circle(64, 72, 2), fill: '#fdf8ee' },
      { d: 'M4 86q6-4 12 0t12 0t12 0t12 0t12 0t12 0t12 0t12 0', line: C.sky[1], width: 2.4 },
    ];
  },
  stars: () => [
    { d: 'M30 8a15 15 0 1 0 16 24a18 18 0 0 1-16-24Z', fill: '#f6e7b0', line: '#d9b84a', width: 1.6 },
    { d: star(54, 60, 23, 10.5), fill: C.yellow[0], line: C.yellow[1], width: 2.2 },
    { d: 'M48 59q2-2 4 0M56 59q2-2 4 0M50.5 65q3 2.4 6 0', line: INK, width: 1.4 },
    { d: star(84, 22, 9, 4) + star(85, 80, 6.5, 2.8) + star(20, 84, 5.5, 2.4), fill: C.yellow[0], line: C.yellow[1], width: 1.4 },
    { d: circle(68, 34, 1.3) + circle(26, 52, 1.1) + circle(91, 52, 1.3) + circle(60, 92, 1), fill: C.yellow[1] },
  ],
};

// ---- each kind of back -----------------------------------------------------------------------------------------

/** Writing in Muse's hand, `size` cqw. */
function hand(className: string, text: string, size: number): HTMLElement {
  const p = el('p', `g-pcb-hand ${className}`, text);
  p.style.setProperty('--size', `${size}cqw`);
  return p;
}

function svgNode(className: string, svg: string): HTMLElement {
  const node = el('span', className);
  node.innerHTML = svg;
  return node;
}

/** A small crayon mark after a line: a heart, a star, a smile or a swoosh under it. */
function flourish(h: Hand): HTMLElement {
  const colour = pick(h.next, MARKERS);
  const kind = pick(h.next, ['heart', 'star', 'smile', 'swoosh'] as const);
  const marks: Record<typeof kind, Mark> = {
    heart: { d: heart(20, 4, 30), fill: '#f2849f', line: '#d2486a', width: 1.8 },
    star: { d: star(20, 20, 16, 7), fill: C.yellow[0], line: C.yellow[1], width: 1.8 },
    smile: { d: `${circle(20, 20, 15)}M14 16v2M26 16v2M13 24q7 7 14 0`, line: colour, width: 2 },
    swoosh: { d: 'M2 26C10 18 20 30 28 20S38 14 39 18', line: colour, width: 2.6 },
  };
  return svgNode(`g-pcb-flourish is-${kind}`, crayon(h, 'flourish', 40, 40, [marks[kind]]));
}

type Draw<K extends PostcardBack['kind']> = (back: Extract<PostcardBack, { kind: K }>, h: Hand, card: Postcard) => HTMLElement[];

const DRAW: { [K in PostcardBack['kind']]: Draw<K> } = {
  line: (b, h) => [
    hand(
      'g-pcb-line',
      b.text,
      handSize(b.text.length, [
        [20, 19],
        [40, 16],
        [64, 14],
        [Infinity, 12.5],
      ]),
    ),
    flourish(h),
  ],

  doodle: (b, h) => {
    const long = b.caption.length > 34;
    const drawing = svgNode('g-pcb-doodle', crayon(h, 'doodle', 100, 100, DOODLES[b.doodle](h.next)));
    drawing.style.setProperty('--turn', `${between(h.next, -7, 7).toFixed(1)}deg`);
    drawing.style.setProperty('--wide', long ? '70cqw' : '84cqw');
    return [drawing, hand('g-pcb-caption', b.caption, long ? 9.5 : 11.5)];
  },

  map: (b, h) => [svgNode('g-pcb-map', mapSvg(b.dir, h)), hand('g-pcb-caption', b.label, b.label.length > 34 ? 9.5 : 11)],

  note: (b, h) => {
    const longest = Math.max(b.title.length, ...b.lines.map((l) => l.length));
    const size = handSize(longest + b.lines.length * 2, [
      [22, 10],
      [30, 9],
      [Infinity, 8],
    ]);
    const paper = el('div', 'g-pcb-note');
    paper.style.setProperty('--size', `${size}cqw`);
    paper.style.setProperty('--turn', `${between(h.next, -3, 3).toFixed(1)}deg`);
    paper.style.setProperty('--paper', pick(h.next, ['#fdf9ef', '#fbf1c4', '#eef5fb', '#fdeee9']));
    const colour = pick(h.next, TAPE_COLOURS);
    paper.append(tapeNode({ pattern: pick(h.next, ['plain', 'stripes', 'dots'] as const), colour, second: '#fffaf2' }, 'top', between(h.next, -6, 6)));
    paper.append(el('p', 'g-pcb-title', b.title), ...b.lines.map((line) => el('p', 'g-pcb-noteline', line)));
    return [paper];
  },

  list: (b, h) => {
    const longest = Math.max(b.title.length, ...b.items.map((i) => i.text.length));
    const size = handSize(longest + b.items.length * 2, [
      [22, 10.5],
      [30, 9.5],
      [Infinity, 8.5],
    ]);
    const list = el('div', 'g-pcb-list');
    list.style.setProperty('--size', `${size}cqw`);
    const tick = pick(h.next, MARKERS);
    const rows = el('ul');
    b.items.forEach((item, k) => {
      const j = (v: number): string => n1(v + between(h.next, -0.8, 0.8));
      const box: Mark = { d: `M${j(2)} ${j(3)}L${j(15)} ${j(2.5)}L${j(15.5)} ${j(15.5)}L${j(1.5)} ${j(15)}Z`, line: '#6b625a', width: 1.5 };
      const marks: Mark[] = item.done ? [box, { d: 'M4 8.5l4.5 5.5L19.5 0', line: tick, width: 2.6 }] : [box];
      const li = el('li');
      li.append(svgNode('g-pcb-box', crayon(h, `box${k}`, 20, 18, marks)), el('span', '', item.text));
      rows.append(li);
    });
    const title = el('p', 'g-pcb-title', b.title);
    list.append(title, svgNode('g-pcb-underline', crayon(h, 'under', 100, 6, [{ d: `M2 3.5Q30 ${n1(between(h.next, 1, 5))} 60 3T98 3`, line: tick, width: 1.8 }])), rows);
    return [list];
  },

  pressed: (b, h, card) => {
    const p = FLOWER_PICTURES[b.species] ?? FLOWER_PICTURES[0];
    const [left, top, right, bottom] = p.box;
    const [w, ht] = [right - left, bottom - top];
    const specimen = el('span', 'g-pcb-specimen');
    specimen.style.setProperty('--turn', `${between(h.next, -9, 9).toFixed(1)}deg`);
    specimen.style.setProperty('--aspect', `${w} / ${ht}`);
    // the picture's own square, cropped to the flower in it
    const flower = svgNode('g-pcb-flower', `<svg viewBox="${left} ${top} ${w} ${ht}" aria-hidden="true"><image href="${p.src}" width="${PICTURE_SIDE}" height="${PICTURE_SIDE}"/></svg>`);
    flower.style.setProperty('--hue', `${((b.variant - 0.5) * 26).toFixed(1)}deg`);
    specimen.append(flower);
    // tape across its stem, and across its middle, where its leaves are
    const tape = { pattern: 'plain', colour: pick(h.next, PAPER_TAPES), second: '#fffaf2' } as const;
    const across: readonly [number, number, number][] = [
      [p.foot[0], p.neck + (p.foot[1] - p.neck) * 0.5, between(h.next, 6, 18)],
      [p.bloom[0], p.bloom[1] + (p.neck - p.bloom[1]) * 0.62, between(h.next, -22, -8)],
    ];
    for (const [x, y, turn] of across) {
      const strip = tapeNode(tape, 'top', turn);
      strip.style.left = `${(((x - left) / w) * 100).toFixed(1)}%`;
      strip.style.top = `${(((y - top) / ht) * 100).toFixed(1)}%`;
      specimen.append(strip);
    }
    const sheet = el('div', 'g-pcb-sheet');
    sheet.append(specimen);
    const label = el('div', 'g-pcb-museum');
    label.style.setProperty('--size', `${b.label.length > 48 ? 6.2 : 7.2}cqw`);
    label.append(
      el('span', 'g-pcb-museum-no', `Specimen no. ${100 + (h.seed % 900)}`),
      el('span', 'g-pcb-museum-name', b.label),
      el('span', 'g-pcb-museum-by', `Pressed by Muse, ${shortDate(card.day).replace(' ', '\u00a0')}`),
    );
    return [sheet, label];
  },

  ticket: (b, h) => {
    const ticket = el('div', 'g-pcb-ticket');
    const [paper, ink] = pick(h.next, [
      ['#f9d9c9', '#b5543a'],
      ['#d9ecdf', '#3f7a55'],
      ['#f8eab0', '#9a7420'],
      ['#dbe6f6', '#3f5f9a'],
    ] as const);
    ticket.style.setProperty('--paper', paper);
    ticket.style.setProperty('--print', ink);
    ticket.style.setProperty('--turn', `${between(h.next, -5, 2).toFixed(1)}deg`);
    const longest = Math.max(b.from.length, b.to.length);
    ticket.style.setProperty('--size', `${longest > 16 ? 6 : 7.4}cqw`);
    const stub = el('span', 'g-pcb-stub');
    stub.append(el('span', 'g-pcb-admit', 'Admit one'), el('span', 'g-pcb-serial', `No ${String(h.seed % 100000).padStart(5, '0')}`));
    const trip = el('span', 'g-pcb-trip');
    trip.append(el('span', 'g-pcb-word', 'From'), el('span', 'g-pcb-stop', b.from), el('span', 'g-pcb-word', 'To'), el('span', 'g-pcb-stop', b.to));
    // the paper is cut (its notches), so its shadow is the ticket's
    const cut = el('span', 'g-pcb-ticket-paper');
    cut.append(stub, trip);
    ticket.append(cut);
    return [ticket, hand('g-pcb-caption g-pcb-ticketnote', b.note, b.note.length > 40 ? 9 : 10.5)];
  },

  game: (b, h) => {
    const cells = parseBoard(b.board);
    const [x, o] = [pick(h.next, ['#d4543a', '#e07b2c', '#4b7d5c']), pick(h.next, ['#2f4fc4', '#a6539a', '#2f8fa6'])];
    const j = (k = 1.2): number => between(h.next, -k, k);
    const at = (i: number): [number, number] => [22 + (i % 3) * 28, 22 + Math.floor(i / 3) * 28];
    const marks: Mark[] = [
      {
        d: `M${n1(36 + j())} 7Q${n1(35 + j())} 50 ${n1(37 + j())} 93M${n1(64 + j())} 7Q${n1(66 + j())} 50 ${n1(63 + j())} 93M7 ${n1(36 + j())}Q50 ${n1(35 + j())} 93 ${n1(37 + j())}M7 ${n1(64 + j())}Q50 ${n1(66 + j())} 93 ${n1(63 + j())}`,
        line: '#6b625a',
        width: 2.2,
      },
    ];
    const won = winningLine(cells);
    if (won) {
      const [ax, ay] = at(won[0]);
      const [cx, cy] = at(won[2]);
      const len = Math.hypot(cx - ax, cy - ay);
      const [ux, uy] = [(cx - ax) / len, (cy - ay) / len];
      marks.push({ d: `M${n1(ax - ux * 12)} ${n1(ay - uy * 12)}L${n1(cx + ux * 12)} ${n1(cy + uy * 12)}`, line: '#f5d34f', width: 13, opacity: 0.75 });
    }
    cells.forEach((cell, i) => {
      const [cx, cy] = at(i);
      if (cell === 'x') marks.push({ d: `M${n1(cx - 8 + j())} ${n1(cy - 8 + j())}L${n1(cx + 8 + j())} ${n1(cy + 8 + j())}M${n1(cx + 8 + j())} ${n1(cy - 8 + j())}L${n1(cx - 8 + j())} ${n1(cy + 8 + j())}`, line: x, width: 3 });
      if (cell === 'o') marks.push({ d: `M${cx + 1} ${cy - 9}C${cx + 10.5} ${cy - 9} ${cx + 11} ${cy + 9} ${cx} ${cy + 9}C${cx - 10} ${cy + 9} ${cx - 10.5} ${cy - 9} ${cx + 3} ${cy - 8}`, line: o, width: 3 });
    });
    const grid = svgNode('g-pcb-grid', crayon(h, 'grid', 100, 100, marks));
    const legend = el('p', 'g-pcb-hand g-pcb-legend');
    const mx = el('b', '', 'X');
    mx.style.color = x;
    const mo = el('b', '', 'O');
    mo.style.color = o;
    legend.append(mx, ' me ', mo, ` ${b.friend}`);
    return [grid, legend, hand('g-pcb-caption', b.caption, b.caption.length > 34 ? 9 : 10.5)];
  },

  riddle: (b, h) => {
    const mark = svgNode('g-pcb-ask', crayon(h, 'ask', 40, 50, [{ d: 'M9 15Q9 4 20 4T31 15Q31 23 22 27T19 36', line: pick(h.next, MARKERS), width: 4 }, { d: circle(19, 44, 2.6), fill: INK }]));
    const question = hand(
      'g-pcb-question',
      b.question,
      handSize(b.question.length, [
        [40, 12.5],
        [64, 11],
        [Infinity, 9.5],
      ]),
    );
    const answer = el('p', 'g-pcb-answer');
    answer.append(el('span', 'g-pcb-answer-word', 'Answer: '), b.answer);
    answer.style.setProperty('--size', `${b.answer.length > 30 ? 5.6 : 6.6}cqw`);
    return [mark, question, answer];
  },

  tally: (b, h) => {
    const groups = tallyGroups(b.count);
    const colour = pick(h.next, MARKERS);
    const rows = Math.max(1, Math.ceil(groups.length / 3));
    const marks: Mark[] = groups.map((n, k) => {
      const gx = 6 + (k % 3) * 32;
      const gy = 4 + Math.floor(k / 3) * 30;
      const j = (): number => between(h.next, -0.9, 0.9);
      const strokes = Array.from({ length: Math.min(4, n) }, (_, s) => {
        const x = gx + 2 + s * 5.5;
        return `M${n1(x + j())} ${n1(gy + 2 + j())}L${n1(x + j())} ${n1(gy + 24 + j())}`;
      });
      if (n === 5) strokes.push(`M${n1(gx - 2 + j())} ${n1(gy + 19 + j())}L${n1(gx + 23 + j())} ${n1(gy + 7 + j())}`);
      return { d: strokes.join(''), line: colour, width: 2.4 };
    });
    const tally = svgNode('g-pcb-tally', crayon(h, 'tally', 100, rows * 30 + 4, marks));
    const total = el('p', 'g-pcb-total');
    total.append(el('span', '', String(Math.max(0, Math.floor(b.count) || 0))), svgNode('g-pcb-ring', crayon(h, 'ring', 60, 40, [{ d: 'M44 6C60 10 60 34 32 36C6 37 2 14 18 7C26 4 36 4 47 9', line: colour, width: 2 }])));
    return [hand('g-pcb-what', b.what, b.what.length > 30 ? 9.5 : 11), tally, total];
  },

  poem: (b, h) => {
    const longest = Math.max(0, ...b.lines.map((l) => l.length));
    const poem = el('div', 'g-pcb-poem');
    poem.style.setProperty('--size', `${handSize(longest, [
      [18, 11.5],
      [28, 10.5],
      [Infinity, 9.5],
    ])}cqw`);
    poem.append(...b.lines.map((line) => el('p', '', line)));
    const sprig = svgNode(
      'g-pcb-sprig',
      crayon(h, 'sprig', 80, 20, [
        { d: 'M6 12Q40 4 74 12', line: C.green[1], width: 1.6 },
        { d: 'M24 9q4-7 10-6-3 6-10 6ZM42 7q5-6 11-4-4 6-11 4ZM30 10q4 6 10 5-3-6-10-5ZM50 9q5 5 11 3-4-5-11-3Z', fill: C.green[0], line: C.green[1], width: 1 },
      ]),
    );
    return [poem, sprig];
  },
};

/** The flower pictures' side (px): each is a square. */
const PICTURE_SIDE = 1254;
/** Tape that holds a pressed flower down: the paler washi colours. */
const PAPER_TAPES = TAPE_COLOURS.filter((c) => c !== '#addcc0');

/** The planet drawn small, seen so the X faces you: its sea and land, its equator, the way Muse walked, and the X. */
function mapSvg(dir: Vec3, h: Hand): string {
  const globe = globeFacing(dir, between(h.next, 0.3, 0.48), between(h.next, 0, 2 * Math.PI));
  const [cx, cy, R] = [50, 50, 40];
  /** A point on the disc; round the back, it is drawn on the rim. */
  const flat = (p: Vec3): [number, number] => {
    const q = globe(p);
    const k = q.z < 0 ? 1 / (Math.hypot(q.x, q.y) || 1) : 1;
    return [cx + q.x * k * R, cy - q.y * k * R];
  };
  const land = LAND.filter((outline) => outline.some((p) => globe(p).z > 0))
    .map((outline) => `${polyline(outline.map(flat))}Z`)
    .join('');
  // the equator, the part of it on this side
  const equator: string[] = [];
  let run: [number, number][] = [];
  for (let k = 0; k <= 96; k++) {
    const a = (k / 96) * 2 * Math.PI;
    const p: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    if (globe(p).z > 0) run.push(flat(p));
    else if (run.length) {
      if (run.length > 1) equator.push(polyline(run));
      run = [];
    }
  }
  if (run.length > 1) equator.push(polyline(run));
  const [xx, xy] = flat(unit(dir));
  // home: a little way off, still on the disc
  const away = between(h.next, 0, 2 * Math.PI);
  let [hx, hy] = [xx + Math.cos(away) * 30, xy + Math.sin(away) * 30];
  const off = Math.hypot(hx - cx, hy - cy);
  if (off > R * 0.74) [hx, hy] = [cx + ((hx - cx) * R * 0.74) / off, cy + ((hy - cy) * R * 0.74) / off];
  const bend = between(h.next, -14, 14);
  const [mx, my] = [(hx + xx) / 2 - ((xy - hy) / 30) * bend, (hy + xy) / 2 + ((xx - hx) / 30) * bend];
  const s = 6;
  return crayon(h, 'map', 100, 100, [
    { d: circle(cx, cy, R), fill: C.sky[0] },
    { d: land, fill: '#a6cf74', line: '#5f8f3c', width: 1.2 },
    { d: equator.join(''), line: C.sky[1], width: 0.9, dash: '2 2.6', opacity: 0.6 },
    { d: circle(cx, cy, R), line: C.sky[1], width: 2 },
    { d: `M${n1(hx)} ${n1(hy)}Q${n1(mx)} ${n1(my)} ${n1(xx)} ${n1(xy)}`, line: '#8a4a32', width: 1.9, dash: '0.1 3.4' },
    { d: `M${n1(hx - 3.5)} ${n1(hy - 0.5)}L${n1(hx)} ${n1(hy - 4)}L${n1(hx + 3.5)} ${n1(hy - 0.5)}M${n1(hx - 2.6)} ${n1(hy - 1)}V${n1(hy + 2.8)}H${n1(hx + 2.6)}V${n1(hy - 1)}`, line: INK, width: 1.3 },
    { d: `M${n1(xx - s)} ${n1(xy - s)}L${n1(xx + s)} ${n1(xy + s)}M${n1(xx + s)} ${n1(xy - s - 0.6)}L${n1(xx - s + 0.4)} ${n1(xy + s)}`, line: '#d4543a', width: 3.4 },
  ]);
}

/** A postcard's message side, as Muse wrote or drew it: the box `.g-pcb` with this kind's content in it. */
export function backContent(back: PostcardBack, card: Postcard): HTMLElement {
  const h = handOf(card.id);
  const box = el('div', `g-pcb is-${back.kind}`);
  box.style.setProperty('--pen', h.pen);
  box.style.setProperty('--tilt', `${between(h.next, -2.2, 1.6).toFixed(2)}deg`);
  const draw = DRAW[back.kind] as Draw<PostcardBack['kind']>;
  const inner = el('div', 'g-pcb-in');
  inner.append(...draw(back, h, card));
  box.append(inner);
  return box;
}
