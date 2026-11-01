import { hash32, mix, salt, unit } from '../core/hash';
import { clamp, lerp, TAU } from '../core/math';
import { ROW } from '../render/palette';

// The objects Muse collected, as things that grow on its planet: one per find,
// standing where Muse found it. The ground there picks the family (reeds at the
// lake's edge, a stone where the grass is thin), the find's topic picks the kin
// (finds about one topic look related), and the find's own id makes it unique.
// Pure: the layer (collectibles.ts) places, lights and sways what this builds.

/** One find as the renderer sees it. */
export interface Collectible {
  /** The find's id: seeds what makes this one unique. */
  readonly id: string;
  /** Unit direction where Muse found it. */
  readonly dir: readonly [number, number, number];
  /** Its topic: finds of one topic are kin. null for a friend's private find. */
  readonly kin: string | null;
  /** Delivered to the owner in a basket: in bloom. Until then a bud (stones are simply there). */
  readonly open: boolean;
}

/** The ground under a find (Terrain.sample, Terrain.lush). */
export interface Ground {
  /** Distance to the water's edge, m (negative on the water). */
  readonly shore: number;
  /** Macro wetness, 0..1. */
  readonly wet: number;
  /** Lushness, 0..1: thin grass below about 0.3. */
  readonly lush: number;
}

export type Family = 'bloom' | 'spire' | 'fern' | 'reed' | 'stone';

/** A colour from the palette (palette.ts ROW and its columns): lit, mid and shade, as tone3 takes them. */
export interface Swatch {
  readonly row: number;
  readonly lit: number;
  readonly mid: number;
  readonly shade: number;
}

export interface Form {
  readonly family: Family;
  /** Standing height, m. */
  readonly height: number;
  /** Turn about the local up and lean from upright, rad. Built into the mesh. */
  readonly yaw: number;
  readonly lean: number;
  /** The kin (32 bits): the same for every find of one topic. Picks part counts, shape ratios and colour. */
  readonly kin: number;
  /** The individual (32 bits, from the id). */
  readonly self: number;
  readonly open: boolean;
  /** Petals, or the stone's face. */
  readonly colour: Swatch;
}

/** Where each family grows (the plan's table). */
export const GROUND = {
  /** Within this far of the water (m): the shore. */
  shore: 2.5,
  /** Wetness above this: wet meadow. */
  wet: 0.55,
  /** Lushness below this: thin grass. */
  thin: 0.3,
} as const;

/** Plants stand this tall (m), above the grass (0.42 m) and the wildflowers (0.34–0.5 m); stones this tall. */
export const HEIGHT = { plant: [0.6, 1.0], stone: [0.35, 0.6] } as const;

/** Per vertex, how the shader colours and bends it. */
export const PART = { stem: 0, leaf: 1, petal: 2, centre: 3, bud: 4, stone: 5 } as const;
export type Part = (typeof PART)[keyof typeof PART];

/** Vertices one find may take, and the most 400 finds may take together (bytes, everything uploaded). */
export const BUDGET = { vertices: 160, bytesFor400: 1_000_000 } as const;

/**
 * The finds' geometry, merged into one draw. Positions are in each find's own
 * frame: metres, y up from the ground, x and z along the ground (the shader
 * lays that frame on the planet at the find's direction), already turned and
 * leaned. `shape` packs, per vertex, the part and the height along the stem
 * (packShape), then the find's index in the list given to buildMesh. `normal`
 * is the surface's facing in the same frame, ×127, four to a vertex (the
 * fourth 0, so each vertex's bytes stay aligned).
 */
export interface CollectibleMesh {
  readonly position: Float32Array;
  readonly normal: Int8Array;
  readonly shape: Uint16Array;
  readonly index: Uint16Array | Uint32Array;
}

/** t along the stem (0 at the ground, 1 at the top): how far the wind bends a vertex. */
export function packShape(part: Part, t: number): number {
  return part * 4096 + Math.round(Math.min(1, Math.max(0, t)) * 4095);
}

export function unpackShape(v: number): { part: Part; t: number } {
  return { part: Math.floor(v / 4096) as Part, t: (v % 4096) / 4095 };
}

export function meshBytes(m: CollectibleMesh): number {
  return m.position.byteLength + m.normal.byteLength + m.shape.byteLength + m.index.byteLength;
}

const KIN = salt('collectible kin');
const SELF = salt('collectible self');
const SHAPE = salt('collectible shape');

/** A 32-bit hash of a string (FNV-1a, then hash32's finaliser). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return hash32(h);
}

/** The two families the ground allows, the first more likely. */
export function familiesFor(g: Ground): readonly [Family, Family] {
  if (g.shore < GROUND.shore) return ['reed', 'stone'];
  if (g.wet > GROUND.wet) return ['spire', 'fern'];
  if (g.lush < GROUND.thin) return ['stone', 'bloom'];
  return ['bloom', 'fern'];
}

const swatch = (row: number, lit: number, mid: number, shade: number): Swatch => ({ row, lit, mid, shade });

/** The colours a kin draws from, per family: lit, mid and shade from one palette row. */
const SWATCHES: Readonly<Record<Family, readonly Swatch[]>> = (() => {
  const petals = [
    swatch(ROW.PINK, 0, 1, 3), // pink
    swatch(ROW.PINK, 1, 7, 9), // rose
    swatch(ROW.PINK, 2, 8, 3), // coral
    swatch(ROW.PINK, 6, 0, 1), // blush
    swatch(ROW.STAR, 0, 0, 1), // white
    swatch(ROW.STAR, 4, 4, 2), // cream
    swatch(ROW.STAR, 5, 5, 1), // lilac
    swatch(ROW.SCATTER, 10, 0, 1), // yellow
    swatch(ROW.SCATTER, 10, 10, 0), // lemon
    swatch(ROW.SCATTER, 2, 2, 3), // blue
    swatch(ROW.SCATTER, 4, 4, 5), // red
    swatch(ROW.SCATTER, 6, 6, 7), // orange
    swatch(ROW.SCATTER, 8, 8, 9), // violet
  ];
  return {
    bloom: petals,
    spire: petals,
    fern: [
      swatch(ROW.WATER, 6, 6, 7), // lily-pad green
      swatch(ROW.PINK, 4, 4, 5), // stem green
      swatch(ROW.GRASS, 3, 0, 2), // sunlit green
      swatch(ROW.ROOF, 6, 6, 7), // moss
      swatch(ROW.ROOF, 12, 2, 3), // bracken
    ],
    reed: [
      swatch(ROW.ROOF, 12, 2, 3), // cattail brown
      swatch(ROW.ROOF, 2, 3, 13), // dark brown
      swatch(ROW.STONE, 7, 3, 4), // straw
    ],
    stone: [
      swatch(ROW.ROCK, 2, 0, 1), // blue-grey
      swatch(ROW.ROCK, 2, 0, 3), // lilac-grey
      swatch(ROW.STONE, 8, 3, 4), // sandstone
      swatch(ROW.STONE, 14, 4, 5), // warm
      swatch(ROW.STONE, 3, 15, 6), // damp, greening
    ],
  };
})();

type Range = readonly [number, number];

/** A stream of draws from one hash: the same seed always draws the same sequence. */
interface Dice {
  /** In [0, 1). */
  next(): number;
  span(r: Range): number;
  /** An integer in r, both ends included. */
  count(r: Range): number;
  pick<T>(list: readonly T[]): T;
  /** In [-amount, amount]. */
  wobble(amount: number): number;
}

function dice(seed: number): Dice {
  let i = 0;
  const next = (): number => unit(mix(seed, ++i));
  return {
    next,
    span: ([lo, hi]) => lo + (hi - lo) * next(),
    count: ([lo, hi]) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    wobble: (amount) => (2 * next() - 1) * amount,
  };
}

export function formOf(c: Collectible, g: Ground): Form {
  const self = mix(SELF, hashString(c.id));
  const kin = c.kin === null ? self : mix(KIN, hashString(c.kin));
  const k = dice(kin);
  const me = dice(self);
  const [first, second] = familiesFor(g);
  const family = k.next() < 0.65 ? first : second;
  const [lo, hi] = family === 'stone' ? HEIGHT.stone : HEIGHT.plant;
  const centre = lerp(lo, hi, k.span([0.15, 0.85]));
  return {
    family,
    height: clamp(centre * (1 + me.wobble(0.15)), lo, hi),
    yaw: me.next() * TAU,
    // a stone leans less: its foot is wide, and must stay in the ground all round
    lean: me.wobble(family === 'stone' ? 0.05 : 0.12),
    kin,
    self,
    open: c.open,
    colour: k.pick(SWATCHES[family]),
  };
}

// ---- geometry: metres, y up, built upright about the origin, then turned and leaned

type V = readonly [number, number, number];
const X: V = [1, 0, 0];
const UP: V = [0, 1, 0];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
/** v turned by angle a toward w (v and w unit and perpendicular). */
const turn = (v: V, w: V, a: number): V => add(mul(v, Math.cos(a)), mul(w, Math.sin(a)));
/** Level heading at azimuth a. */
const heading = (a: number): V => [Math.cos(a), 0, Math.sin(a)];

/** A point on a path: where, its heading, the normal it bends toward, and the side (across both). */
interface Frame {
  readonly p: V;
  readonly d: V;
  readonly n: V;
  readonly side: V;
}
/** s along the path, 0 at its start and 1 at its end (beyond 1 it carries on). */
type Path = (s: number) => Frame;

/** A path of `length` from o, setting out along d and turning toward n (perpendicular to d) by angle(s). */
function curve(o: V, d: V, n: V, length: number, angle: (s: number) => number): Path {
  const side = cross(d, n);
  return (s) => {
    const steps = Math.max(1, Math.ceil(Math.abs(s) * 16));
    let p = o;
    for (let i = 0; i < steps; i++) p = add(p, mul(turn(d, n, angle(((i + 0.5) / steps) * s)), (length * s) / steps));
    const a = angle(s);
    return { p, d: turn(d, n, a), n: turn(n, mul(d, -1), a), side };
  };
}

/** A curve from o whose end stands `height` above it. */
function rising(o: V, d: V, n: V, height: number, angle: (s: number) => number): Path {
  return curve(o, d, n, height / (curve(o, d, n, 1, angle)(1).p[1] - o[1]), angle);
}

/** The path with its side and normal rolled about the heading, by `amount` at its end. */
function twist(path: Path, amount: number): Path {
  return (s) => {
    const f = path(s);
    const a = amount * s;
    return { ...f, side: turn(f.side, f.n, a), n: turn(f.n, mul(f.side, -1), a) };
  };
}

/** One find's geometry as it is built. */
class Piece {
  readonly pos: V[] = [];
  readonly part: Part[] = [];
  readonly t: number[] = [];
  readonly tris: number[] = [];

  vert(p: V, part: Part, t: number): number {
    this.pos.push(p);
    this.part.push(part);
    this.t.push(t);
    return this.pos.length - 1;
  }

  /** A triangle wound so its normal faces along `want`. */
  tri(a: number, b: number, c: number, want: V): void {
    const n = cross(sub(this.pos[b], this.pos[a]), sub(this.pos[c], this.pos[a]));
    if (dot(n, want) < 0) this.tris.push(a, c, b);
    else this.tris.push(a, b, c);
  }

  /** A triangle facing away from `inside`. */
  out(a: number, b: number, c: number, inside: V): void {
    const centroid = mul(add(add(this.pos[a], this.pos[b]), this.pos[c]), 1 / 3);
    this.tri(a, b, c, sub(centroid, inside));
  }

  /** Two rows, each left to right (a row of one is a point), stitched into a strip facing `want`. */
  strip(a: readonly number[], b: readonly number[], want: V): void {
    const at = (row: readonly number[], k: number): number => (row.length === 1 ? 0.5 : k / (row.length - 1));
    let i = 0;
    let j = 0;
    while (i < a.length - 1 || j < b.length - 1) {
      if (j === b.length - 1 || (i < a.length - 1 && at(a, i + 1) <= at(b, j + 1))) {
        this.tri(a[i], a[i + 1], b[j], want);
        i++;
      } else {
        this.tri(a[i], b[j + 1], b[j], want);
        j++;
      }
    }
  }

  /** Two closed rings of one size about centres ca and cb, b turned half a step back, stitched into a band facing out. */
  band(a: readonly number[], b: readonly number[], ca: V, cb: V): void {
    const near = mul(add(add(ca, ca), cb), 1 / 3);
    const far = mul(add(add(ca, cb), cb), 1 / 3);
    for (let k = 0; k < a.length; k++) {
      const k1 = (k + 1) % a.length;
      this.out(a[k], a[k1], b[k1], near);
      this.out(a[k], b[k1], b[k], far);
    }
  }

  /** A fan from `apex` to a closed ring, facing away from `inside`. */
  fan(apex: number, ring: readonly number[], inside: V): void {
    for (let k = 0; k < ring.length; k++) this.out(apex, ring[k], ring[(k + 1) % ring.length], inside);
  }

  /** Per vertex, the area-weighted facing of the triangles around it. */
  normals(): V[] {
    const acc = this.pos.map((): [number, number, number] => [0, 0, 0]);
    for (let i = 0; i < this.tris.length; i += 3) {
      const [a, b, c] = [this.tris[i], this.tris[i + 1], this.tris[i + 2]];
      const n = cross(sub(this.pos[b], this.pos[a]), sub(this.pos[c], this.pos[a]));
      for (const v of [a, b, c]) for (let x = 0; x < 3; x++) acc[v][x] += n[x];
    }
    return acc.map((n) => (dot(n, n) > 0 ? norm(n) : UP));
  }
}

/** A row across a blade at s along its path: a point (w 0) or two edges w of the half-width out, with a midrib at s `mid`. */
interface Row {
  readonly s: number;
  readonly w: number;
  readonly mid?: number;
}

/**
 * A petal, leaf or blade along a path: rows from base to tip, the edges lifted
 * toward the path's normal by `cup` of their half-width. Its normals face the
 * path's normal (face 1) or away from it (face -1).
 */
function blade(p: Piece, path: Path, rows: readonly Row[], halfWidth: number, cup: number, part: Part, t: (s: number) => number, face = 1): void {
  let prev: number[] | null = null;
  for (const r of rows) {
    const f = path(r.s);
    const w = r.w * halfWidth;
    const lift = mul(f.n, cup * w);
    const row =
      w === 0
        ? [p.vert(f.p, part, t(r.s))]
        : [
            p.vert(add(add(f.p, mul(f.side, w)), lift), part, t(r.s)),
            ...(r.mid === undefined ? [] : [p.vert(path(r.mid).p, part, t(r.mid))]),
            p.vert(add(sub(f.p, mul(f.side, w)), lift), part, t(r.s)),
          ];
    if (prev) p.strip(prev, row, mul(f.n, face));
    prev = row;
  }
}

/** A tube along a path through rings [s, radius] of `sides`; a radius of 0 closes it to a point. */
function tube(p: Piece, path: Path, rings: readonly (readonly [number, number])[], sides: number, part: Part, t: (s: number) => number): void {
  let prev: { ids: number[]; c: V } | null = null;
  rings.forEach(([s, r], i) => {
    const f = path(s);
    const ids =
      r === 0
        ? [p.vert(f.p, part, t(s))]
        : Array.from({ length: sides }, (_, k) => {
            const a = ((k - i / 2) / sides) * TAU;
            return p.vert(add(f.p, add(mul(f.n, Math.cos(a) * r), mul(f.side, Math.sin(a) * r))), part, t(s));
          });
    if (prev) {
      if (ids.length === 1) p.fan(ids[0], prev.ids, prev.c);
      else if (prev.ids.length === 1) p.fan(prev.ids[0], ids, f.p);
      else p.band(prev.ids, ids, prev.c, f.p);
    }
    prev = { ids, c: f.p };
  });
}

/** A leaf with a midrib, pointed at both ends. */
const LEAF: readonly Row[] = [
  { s: 0, w: 0 },
  { s: 0.3, w: 0.9, mid: 0.3 },
  { s: 0.66, w: 0.75, mid: 0.66 },
  { s: 1, w: 0 },
];

// ---- bloom: one large open flower on a tall stem

/** Petal outlines, widths of the widest: a broad round end, a single tip, or a strap with a notch. */
const PETAL = {
  round: [{ s: 0, w: 0 }, { s: 0.25, w: 0.62 }, { s: 0.6, w: 1, mid: 0.6 }, { s: 0.87, w: 0.78 }, { s: 1, w: 0 }],
  pointed: [{ s: 0, w: 0 }, { s: 0.32, w: 1 }, { s: 0.64, w: 0.85, mid: 0.64 }, { s: 1.1, w: 0 }],
  notched: [{ s: 0, w: 0 }, { s: 0.22, w: 0.85 }, { s: 0.9, w: 1, mid: 0.72 }, { s: 0.83, w: 0 }],
} as const satisfies Record<string, readonly Row[]>;

const BUD: readonly Row[] = [
  { s: 0, w: 0 },
  { s: 0.38, w: 1 },
  { s: 0.72, w: 0.8, mid: 0.72 },
  { s: 1, w: 0 },
];

interface BloomStyle {
  readonly petals: Range;
  readonly outline: keyof typeof PETAL;
  /** How much of its share of the ring a petal covers at its widest: above 1 they overlap. */
  readonly overlap: Range;
  /** Petal rise at its base, and further to its tip (rad; below 0 swept back). */
  readonly cup: Range;
  readonly curl: Range;
  /** Petal edges lifted, of the half-width: a spoon. */
  readonly spoon: number;
  /** Across the head, m. */
  readonly head: Range;
  /** The centre's radius, of the head's; its height, of its radius. */
  readonly disc: Range;
  readonly dome: Range;
  /** The head's tilt from upright, rad. */
  readonly nod: Range;
}

const BLOOMS: readonly BloomStyle[] = [
  // goblet: a few broad petals in a deep cup
  { petals: [4, 6], outline: 'round', overlap: [1.2, 1.4], cup: [0.85, 1.1], curl: [0.1, 0.3], spoon: 0.3, head: [0.13, 0.17], disc: [0.16, 0.2], dome: [0.4, 0.7], nod: [0, 0.25] },
  // star: flat pointed petals
  { petals: [5, 8], outline: 'pointed', overlap: [0.6, 0.8], cup: [0.1, 0.3], curl: [-0.3, 0], spoon: 0.15, head: [0.16, 0.2], disc: [0.12, 0.16], dome: [0.4, 0.8], nod: [0.1, 0.45] },
  // ray: many strap petals round a broad boss
  { petals: [7, 9], outline: 'notched', overlap: [0.7, 0.9], cup: [0.05, 0.2], curl: [-0.2, 0.05], spoon: 0.12, head: [0.17, 0.2], disc: [0.22, 0.3], dome: [0.5, 0.8], nod: [0.15, 0.5] },
  // cone: swept-back petals under a tall cone
  { petals: [6, 9], outline: 'pointed', overlap: [0.6, 0.8], cup: [-0.3, -0.05], curl: [-0.6, -0.3], spoon: 0.15, head: [0.15, 0.19], disc: [0.22, 0.28], dome: [0.9, 1.3], nod: [0.1, 0.4] },
  // saucer: round overlapping petals in a shallow bowl
  { petals: [5, 6], outline: 'round', overlap: [1.05, 1.25], cup: [0.3, 0.55], curl: [0, 0.25], spoon: 0.25, head: [0.17, 0.2], disc: [0.14, 0.2], dome: [0.3, 0.6], nod: [0.05, 0.35] },
];

function bloom(p: Piece, f: Form, kin: Dice, me: Dice): void {
  const style = kin.pick(BLOOMS);
  const petals = kin.count(style.petals);
  const radius = (kin.span(style.head) / 2) * (1 + me.wobble(0.06));
  const disc = radius * kin.span(style.disc);
  const length = radius - disc * 0.5;
  const overlap = kin.span(style.overlap);
  const cup = kin.span(style.cup);
  const curl = kin.span(style.curl);
  const dome = disc * kin.span(style.dome);
  const nod = Math.max(0, kin.span(style.nod) + me.wobble(0.1));
  const leaves = kin.count([1, 2]);
  const leaf = { length: kin.span([0.17, 0.24]), width: kin.span([0.1, 0.15]), rise: kin.span([0.45, 0.85]), droop: kin.span([0.6, 1.1]), side: kin.next() * TAU };
  // a petal in the head's frame: out from the axis along x, up it along y
  const petal = curve([disc * 0.5, 0, 0], X, UP, length, (s) => cup + curl * s);
  // its share of the ring where it is widest sets its width, whatever the count and the cup
  const width = (overlap * Math.PI * petal(0.6).p[0]) / petals;
  // the stem stops short by what the tilted head rises above it, so the find stands at its height
  const tip = petal(1).p;
  const above = Math.max(0.006 + dome, tip[1] * Math.cos(nod) + tip[0] * Math.sin(nod));

  const stem = rising([0, 0, 0], UP, X, f.height - above, (s) => nod * 0.55 * s * s);
  tube(p, stem, [[0, 0.0075], [0.45, 0.0065], [0.93, 0.0055], [1, 0.0095]], 3, PART.stem, (s) => s);

  for (let j = 0; j < leaves; j++) {
    const at = stem(0.2 + 0.2 * j + me.wobble(0.04));
    const len = f.height * leaf.length * (1 + me.wobble(0.12));
    const path = curve(at.p, heading(leaf.side + j * Math.PI + me.wobble(0.5)), UP, len, (s) => leaf.rise - leaf.droop * s);
    blade(p, path, LEAF, leaf.width * len, 0.35, PART.leaf, () => at.p[1] / f.height);
  }

  // the head about its axis a, tilted toward +x by the nod; e1 and e2 across it
  const top = stem(1).p;
  const a = turn(UP, X, nod);
  const e1: V = [0, 0, 1];
  const e2 = cross(a, e1);
  const spin = me.next() * TAU;
  for (let k = 0; k < petals; k++) {
    const phi = spin + ((k + me.wobble(0.12)) / petals) * TAU;
    const r = turn(e1, e2, phi);
    if (f.open) {
      // neighbours alternate in height (the last of an odd count between), so overlaps never fight
      const step = k % 2 === 1 ? 2 : k === petals - 1 && petals % 2 === 1 ? 1 : 0;
      const o = add(add(top, mul(r, disc * 0.5)), mul(a, 0.004 + 0.0015 * step));
      const len = length * (1 + me.wobble(0.08));
      const rise = cup + 0.03 * step + me.wobble(0.04);
      blade(p, curve(o, r, a, len, (s) => rise + curl * s), PETAL[style.outline], (width * len) / length, style.spoon, PART.petal, () => 1);
    } else {
      // a bud: each petal leaves the stem top outward, then folds up and over to the axis
      const len = length * 0.55 + 0.016;
      const o = add(add(top, mul(r, 0.004)), mul(a, 0.004));
      const lean = 0.6;
      const path = curve(o, turn(a, r, lean), turn(mul(r, -1), a, lean), len, (s) => 1.5 * s);
      const girth = (1.3 * Math.PI * (0.15 * len + 0.004)) / petals;
      blade(p, path, BUD, girth, 0.35, PART.bud, () => 1, -1);
    }
  }
  if (f.open) {
    const base = add(top, mul(a, 0.006));
    const ring = (h: number, r: number, offset: number): number[] =>
      Array.from({ length: 6 }, (_, k) => p.vert(add(add(base, mul(a, h)), mul(turn(e1, e2, spin + ((k + offset) / 6) * TAU), r)), PART.centre, 1));
    const rim = ring(0, disc, 0);
    const shoulder = ring(dome * 0.6, disc * 0.7, -0.5);
    p.band(rim, shoulder, base, add(base, mul(a, dome * 0.6)));
    p.fan(p.vert(add(base, mul(a, dome)), PART.centre, 1), shoulder, sub(base, mul(a, disc)));
  }
}

// ---- spire: a tall stem carrying bells along its top

interface SpireStyle {
  readonly bells: Range;
  /** Bell length, m; its mouth's radius, of the length. */
  readonly length: Range;
  readonly mouth: Range;
  /** The bell's axis below level, rad (π/2 hangs straight down). */
  readonly hang: Range;
  /** Bells all round the stem, or to one side. */
  readonly spiral: boolean;
  /** How far the tip bends over, rad. */
  readonly arch: Range;
  /** Bells' spacing along the stem, of their length. */
  readonly pack: Range;
}

const SPIRES: readonly SpireStyle[] = [
  // bells hanging under an arching tip
  { bells: [5, 7], length: [0.045, 0.055], mouth: [0.4, 0.5], hang: [1.2, 1.45], spiral: false, arch: [0.35, 0.6], pack: [0.75, 0.9] },
  // trumpets: long tubes held nearly level, to one side
  { bells: [4, 6], length: [0.06, 0.075], mouth: [0.32, 0.4], hang: [0.3, 0.55], spiral: false, arch: [0.05, 0.15], pack: [0.65, 0.8] },
  // lanterns: wide cups nodding all round a straight stem
  { bells: [3, 5], length: [0.05, 0.06], mouth: [0.5, 0.62], hang: [0.75, 1], spiral: true, arch: [0, 0.1], pack: [0.9, 1.1] },
];

/** A bell from its apex along its axis: a waist and a flared mouth of five, or closed to a point as a bud. */
function bell(p: Piece, apex: V, axis: V, length: number, mouth: number, closed: boolean, t: number, spin: number): void {
  const u = norm(Math.abs(axis[1]) > 0.99 ? cross(axis, X) : cross(axis, UP));
  const v = cross(axis, u);
  const part = closed ? PART.bud : PART.petal;
  const ring = (at: number, r: number, offset: number): { c: V; ids: number[] } => {
    const c = add(apex, mul(axis, at));
    const ids = Array.from({ length: 5 }, (_, k) => p.vert(add(c, mul(turn(u, v, spin + ((k + offset) / 5) * TAU), r)), part, t));
    return { c, ids };
  };
  const top = p.vert(apex, part, t);
  if (closed) {
    const waist = ring(0.5 * length, 0.6 * mouth, 0);
    p.fan(top, waist.ids, waist.c);
    p.fan(p.vert(add(apex, mul(axis, 0.95 * length)), part, t), waist.ids, waist.c);
    return;
  }
  const waist = ring(0.45 * length, 0.55 * mouth, 0);
  const lip = ring(length, mouth, -0.5);
  p.fan(top, waist.ids, waist.c);
  p.band(waist.ids, lip.ids, waist.c, lip.c);
}

function spire(p: Piece, f: Form, kin: Dice, me: Dice): void {
  const style = kin.pick(SPIRES);
  const bells = kin.count(style.bells);
  const length = kin.span(style.length);
  const mouth = kin.span(style.mouth) * length;
  const hang = kin.span(style.hang);
  const arch = kin.span(style.arch);
  const leaves = kin.count([2, 4]);
  const leaf = { length: kin.span([0.26, 0.34]), width: kin.span([0.08, 0.12]), rise: kin.span([0.75, 1.05]), droop: kin.span([0.8, 1.3]) };

  const stem = rising([0, 0, 0], UP, X, f.height, (s) => arch * s ** 3);
  const reach = Math.min(0.34, (bells * length * kin.span(style.pack)) / f.height);
  tube(p, stem, [[0, 0.0065], [0.35, 0.0055], [0.7, 0.0042], [1, 0]], 3, PART.stem, (s) => s);

  const spin = me.next() * TAU;
  for (let j = 0; j < bells; j++) {
    const u = j / (bells - 1);
    const at = stem(1 - reach + (reach - 0.03) * u + me.wobble(0.012));
    // one-sided bells hang on the arch's inner side (+x)
    const out = heading(style.spiral ? spin + j * 2.4 : me.wobble(0.7));
    const size = lerp(1, 0.7, u) * (1 + me.wobble(0.08));
    const tilt = hang + me.wobble(0.12);
    const axis = norm(add(mul(out, Math.cos(tilt)), mul(UP, -Math.sin(tilt))));
    // the youngest bells at the top are still buds
    const budding = !f.open || j >= bells - (bells >= 5 ? 2 : 1);
    bell(p, add(at.p, mul(out, 0.005)), axis, length * size, mouth * size, budding, at.p[1] / f.height, me.next() * TAU);
  }

  const around = me.next() * TAU;
  for (let j = 0; j < leaves; j++) {
    const d = heading(around + ((j + me.wobble(0.25)) / leaves) * TAU);
    const len = f.height * leaf.length * (1 + me.wobble(0.12));
    const path = curve(add(mul(d, 0.008), [0, 0.004, 0]), d, UP, len, (s) => leaf.rise - leaf.droop * s);
    blade(p, path, LEAF, leaf.width * len, 0.35, PART.leaf, (s) => (0.6 * s * len) / f.height);
  }
}

// ---- fern: fronds arching out from the base

interface FernStyle {
  readonly fronds: Range;
  /** A frond's rise from level at its base, and how far it bows over to its tip, rad; the bow gathers toward the tip by `bend`. */
  readonly rise: Range;
  readonly droop: Range;
  readonly bend: number;
  /** Leaflets, alternating sides, and the longest, of the frond's length. */
  readonly leaflets: number;
  readonly leaflet: Range;
}

const FERNS: readonly FernStyle[] = [
  // shuttlecock: an upright vase of narrow fronds
  { fronds: [5, 7], rise: [1.42, 1.5], droop: [0.8, 1.1], bend: 2, leaflets: 8, leaflet: [0.12, 0.15] },
  // arching: fronds spreading, tips bowing down
  { fronds: [5, 7], rise: [1.4, 1.48], droop: [2, 2.4], bend: 3, leaflets: 8, leaflet: [0.11, 0.14] },
  // broad: a few wide fronds held up like hands
  { fronds: [4, 5], rise: [1.35, 1.45], droop: [1.2, 1.5], bend: 2.5, leaflets: 7, leaflet: [0.14, 0.17] },
];

/**
 * A frond: a stalk, then leaflets alternating side to side along the path, each
 * swept toward the tip and spanning one step of the midrib, longest a little
 * below the middle.
 */
function frond(p: Piece, path: Path, leaflets: number, leaflet: number, part: Part, t: (s: number) => number): void {
  const f0 = path(0);
  const foot = [p.vert(add(f0.p, mul(f0.side, 0.004)), part, t(0)), p.vert(sub(f0.p, mul(f0.side, 0.004)), part, t(0))];
  const at = (i: number): number => 0.28 + (0.72 * i) / leaflets;
  const rib = Array.from({ length: leaflets + 1 }, (_, i) => p.vert(path(at(i)).p, part, t(at(i))));
  p.tri(foot[0], foot[1], rib[0], f0.n);
  for (let i = 0; i < leaflets; i++) {
    const s = (at(i) + at(i + 1)) / 2;
    const f = path(s);
    const w = leaflet * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, (s - 0.1) / 1)));
    const side = i % 2 === 0 ? 1 : -1;
    const tip = p.vert(add(f.p, add(mul(f.side, side * w), add(mul(f.d, 0.7 * w), mul(f.n, -0.25 * w)))), part, t(s));
    p.tri(rib[i], rib[i + 1], tip, f.n);
  }
}

/** The highest point of a path of unit length that sets out level and rises by angle(s). */
function crown(angle: (s: number) => number): number {
  const path = curve([0, 0, 0], X, UP, 1, angle);
  return Math.max(...Array.from({ length: 13 }, (_, i) => path(i / 12).p[1]));
}

/** A fiddlehead: straight up, then coiled tighter and tighter at the top. */
const coil = (s: number): number => 1.45 - 6 * Math.max(0, (s - 0.72) / 0.28) ** 1.5;

function fern(p: Piece, f: Form, kin: Dice, me: Dice): void {
  const style = kin.pick(FERNS);
  const fronds = kin.count(style.fronds);
  const rise = kin.span(style.rise);
  const droop = kin.span(style.droop);
  const leaflet = kin.span(style.leaflet);
  // the frond length that brings a crown to the find's height; fiddleheads stand two thirds as tall, above the grass
  const full = f.open ? f.height / crown((s) => rise - droop * s ** style.bend) : (0.65 * f.height) / crown(coil);

  const spin = me.next() * TAU;
  for (let j = 0; j < fronds; j++) {
    const d = heading(spin + ((j + me.wobble(0.25)) / fronds) * TAU);
    // the first frond stands full height, the rest a little shorter
    const len = full * (j === 0 ? 1 : 1 - 0.18 * me.next());
    const up = rise + me.wobble(0.08);
    const bow = droop + me.wobble(0.15);
    const t = (s: number): number => (s * len) / f.height;
    if (f.open) frond(p, curve(mul(d, 0.015), d, UP, len, (s) => up - bow * s ** style.bend), style.leaflets, leaflet * len, PART.petal, t);
    else frond(p, curve(mul(d, 0.015), d, UP, len, coil), style.leaflets, leaflet * len * 0.2, PART.bud, t);
  }
}

// ---- reed: slender stems, a seed head on the tallest, blades at the foot

type ReedStyle =
  | { readonly head: 'cattail'; readonly stems: Range; readonly length: Range; readonly girth: Range }
  | { readonly head: 'plume'; readonly stems: Range; readonly length: Range; readonly spikelets: Range; readonly spread: Range; readonly droop: Range };

const REEDS: readonly ReedStyle[] = [
  // a velvet spindle with a bare spike above it
  { head: 'cattail', stems: [2, 4], length: [0.12, 0.16], girth: [0.015, 0.019] },
  // a slim one
  { head: 'cattail', stems: [2, 3], length: [0.08, 0.1], girth: [0.01, 0.012] },
  // an umbel: spikelets spread wide like a parasol's ribs
  { head: 'plume', stems: [2, 4], length: [0.08, 0.11], spikelets: [6, 8], spread: [0.95, 1.2], droop: [0.4, 0.8] },
  // a plume: spikelets gathered, then falling away like a feather
  { head: 'plume', stems: [2, 3], length: [0.1, 0.13], spikelets: [6, 8], spread: [0.25, 0.4], droop: [1.5, 2] },
];

const STALK: readonly Row[] = [
  { s: 0, w: 1 },
  { s: 0.45, w: 0.8 },
  { s: 0.8, w: 0.55 },
  { s: 1, w: 0 },
];

const SPIKELET: readonly Row[] = [
  { s: 0, w: 0.4 },
  { s: 0.5, w: 1 },
  { s: 1, w: 0 },
];

function reed(p: Piece, f: Form, kin: Dice, me: Dice): void {
  const style = kin.pick(REEDS);
  const stems = kin.count(style.stems);
  const length = kin.span(style.length);
  const blades = kin.count([2, 3]);
  const foliage = { length: kin.span([0.55, 0.75]), rise: kin.span([1.3, 1.45]), droop: kin.span([0.8, 1.3]) };
  const spin = me.next() * TAU;

  const tall = style.head === 'plume' ? f.height - 0.4 * length : f.height;
  const bow = me.wobble(0.1);
  const stem = rising([0, 0, 0], UP, X, tall, (s) => bow * s);
  tube(p, stem, [[0, 0.007], [0.35, 0.006], [0.7, 0.0045], [1, 0]], 3, PART.stem, (s) => s);

  for (let j = 1; j < stems; j++) {
    const out = heading(spin + ((j + me.wobble(0.3)) / stems) * TAU);
    const h = f.height * lerp(0.55, 0.85, me.next());
    const lean = lerp(0.08, 0.25, me.next());
    const path = twist(rising(mul(out, lerp(0.012, 0.024, me.next())), UP, out, h, (s) => lean * s), 1.2);
    blade(p, path, STALK, 0.0032, 0, PART.stem, (s) => (s * h) / f.height);
  }

  const part = f.open ? PART.petal : PART.bud;
  if (style.head === 'cattail') {
    const from = kin.span([0.7, 0.76]);
    const to = from + length / tall;
    const girth = kin.span(style.girth) * (f.open ? 1 : 0.55);
    const at = (u: number): number => lerp(from, to, u);
    tube(p, stem, [[at(0), 0], [at(0.12), 0.8 * girth], [at(0.5), girth], [at(0.88), 0.8 * girth], [at(1), 0]], 5, part, (s) => s);
  } else {
    const top = stem(1).p;
    const count = kin.count(style.spikelets);
    const spread = kin.span(style.spread) * (f.open ? 1 : 0.15);
    const droop = kin.span(style.droop) * (f.open ? 1 : 0.1);
    for (let i = 0; i < count; i++) {
      const out = heading(spin + ((i + me.wobble(0.3)) / count) * TAU);
      const lean = spread + me.wobble(0.12);
      const path = curve(top, turn(UP, out, lean), turn(out, mul(UP, -1), lean), length * (1 + me.wobble(0.15)), (s) => droop * s * s);
      blade(p, path, SPIKELET, f.open ? 0.005 : 0.0035, 0, part, () => 1);
    }
  }

  const around = me.next() * TAU;
  for (let j = 0; j < blades; j++) {
    const d = heading(around + ((j + me.wobble(0.25)) / blades) * TAU);
    const len = f.height * foliage.length * (1 + me.wobble(0.1));
    const path = twist(curve(mul(d, 0.006), d, UP, len, (s) => foliage.rise - foliage.droop * s * s), 0.8);
    blade(p, path, STALK, 0.01, 0.2, PART.leaf, (s) => (s * len) / f.height);
  }
}

// ---- stone: a standing stone, or a cairn of two or three

/** How far a stone's foot sits below the ground, m. */
const SINK = 0.025;

/** Rings up a rock, [height, radius] as fractions of its height and its widest radius. */
const STANDING: readonly (readonly [number, number])[] = [
  [0, 0.92],
  [0.3, 1],
  [0.62, 0.9],
  [0.86, 0.66],
];
const ROUNDED: readonly (readonly [number, number])[] = [
  [0, 0.8],
  [0.38, 1],
  [0.76, 0.74],
];

/** A closed, rounded, slightly irregular rock on its foot, `rx` by `rz` across (turned by `angle`), closed by a point below and one on top. */
function rock(p: Piece, foot: V, height: number, rx: number, rz: number, angle: number, profile: readonly (readonly [number, number])[], me: Dice): void {
  const sides = 7;
  const centre = add(foot, [0, height * 0.45, 0]);
  const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
  const rings = profile.map(([y, r], i) => {
    const c = add(foot, [0, y * height, 0]);
    const ids = Array.from({ length: sides }, (_, k) => {
      const a = ((k - i / 2 + me.wobble(0.15)) / sides) * TAU;
      const g = r * (1 + me.wobble(0.1));
      const [x, z] = [Math.cos(a) * rx * g, Math.sin(a) * rz * g];
      return p.vert(add(c, [x * ca - z * sa, i === 0 ? 0 : me.wobble(0.04) * height, x * sa + z * ca]), PART.stone, 0);
    });
    return { c, ids };
  });
  p.fan(p.vert(foot, PART.stone, 0), rings[0].ids, centre);
  for (let i = 1; i < rings.length; i++) p.band(rings[i - 1].ids, rings[i].ids, rings[i - 1].c, rings[i].c);
  p.fan(p.vert(add(foot, [me.wobble(0.15) * rx, height, me.wobble(0.15) * rz]), PART.stone, 0), rings[rings.length - 1].ids, centre);
}

function stone(p: Piece, f: Form, kin: Dice, me: Dice): void {
  const count = kin.count([1, 3]);
  const depth = kin.span([0.6, 0.9]);
  const tall = f.height + SINK;
  if (count === 1) {
    const rx = tall * kin.span([0.24, 0.32]) * (1 + me.wobble(0.06));
    rock(p, [0, -SINK, 0], tall, rx, rx * depth, 0, STANDING, me);
    return;
  }
  // a cairn: each stone smaller, set a little off the one below, the pile as tall as the find
  const flat = kin.span([0.55, 0.75]);
  const sizes = [1, 0.74, 0.54].slice(0, count);
  const rest = 0.78;
  const units = sizes.reduce((sum, g, i) => sum + g * (i < count - 1 ? rest : 1), 0);
  const h0 = tall / units;
  let foot: V = [0, -SINK, 0];
  sizes.forEach((g) => {
    const h = h0 * g;
    const r = h / (2 * flat);
    rock(p, foot, h, r, r * depth, me.next() * Math.PI, ROUNDED, me);
    foot = add(foot, [me.wobble(0.22 * r), rest * h, me.wobble(0.22 * r)]);
  });
}

const GROW: Readonly<Record<Family, (p: Piece, f: Form, kin: Dice, me: Dice) => void>> = { bloom, spire, fern, reed, stone };

function grow(f: Form): Piece {
  const p = new Piece();
  GROW[f.family](p, f, dice(mix(f.kin, SHAPE)), dice(mix(f.self, SHAPE)));
  return p;
}

export function buildMesh(forms: readonly Form[]): CollectibleMesh {
  const pieces = forms.map(grow);
  const vertices = pieces.reduce((n, p) => n + p.pos.length, 0);
  const position = new Float32Array(vertices * 3);
  const normal = new Int8Array(vertices * 4);
  const shape = new Uint16Array(vertices * 2);
  const indices = pieces.reduce((n, p) => n + p.tris.length, 0);
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let i = 0;
  pieces.forEach((p, anchor) => {
    const { lean, yaw } = forms[anchor];
    const [cl, sl, cy, sy] = [Math.cos(lean), Math.sin(lean), Math.cos(yaw), Math.sin(yaw)];
    // lean about x (the base stays put), then turn about y
    const place = (q: V): V => {
      const y = q[1] * cl - q[2] * sl;
      const z = q[1] * sl + q[2] * cl;
      return [q[0] * cy + z * sy, y, z * cy - q[0] * sy];
    };
    for (const k of p.tris) index[i++] = v + k;
    const normals = p.normals();
    p.pos.forEach((q, k) => {
      const n = place(normals[k]);
      position.set(place(q), (v + k) * 3);
      normal.set([Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127), 0], (v + k) * 4);
      shape[(v + k) * 2] = packShape(p.part[k], p.t[k]);
      shape[(v + k) * 2 + 1] = anchor;
    });
    v += p.pos.length;
  });
  return { position, normal, shape, index };
}
