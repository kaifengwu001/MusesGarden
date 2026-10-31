import { hash32, mix, salt, unit } from '../core/hash';

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
 * (packShape), then the find's index in the list given to buildMesh.
 */
export interface CollectibleMesh {
  readonly position: Float32Array;
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
  return m.position.byteLength + m.shape.byteLength + m.index.byteLength;
}

const KIN = salt('collectible kin');
const SELF = salt('collectible self');

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

// placeholder until lane F: the family from the ground, sizes and turns from the hashes, one swatch
export function formOf(c: Collectible, g: Ground): Form {
  const self = mix(SELF, hashString(c.id));
  const kin = c.kin === null ? self : mix(KIN, hashString(c.kin));
  const [a, b] = familiesFor(g);
  const family = unit(kin) < 0.65 ? a : b;
  const [lo, hi] = family === 'stone' ? HEIGHT.stone : HEIGHT.plant;
  return {
    family,
    height: lo + (hi - lo) * unit(hash32(self ^ 1)),
    yaw: unit(hash32(self ^ 2)) * Math.PI * 2,
    lean: (unit(hash32(self ^ 3)) - 0.5) * 0.2,
    kin,
    self,
    open: c.open,
    colour: { row: 3, lit: 0, mid: 1, shade: 3 },
  };
}

// placeholder until lane F: a plain stem ribbon per find
export function buildMesh(forms: readonly Form[]): CollectibleMesh {
  const position: number[] = [];
  const shape: number[] = [];
  const index: number[] = [];
  forms.forEach((f, anchor) => {
    const base = position.length / 3;
    const segments = 4;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      for (const side of [-1, 1]) {
        position.push(side * 0.012 * Math.cos(f.yaw), t * f.height, side * 0.012 * Math.sin(f.yaw));
        shape.push(packShape(PART.stem, t), anchor);
      }
      if (s > 0) {
        const p = base + (s - 1) * 2;
        index.push(p, p + 1, p + 3, p, p + 3, p + 2);
      }
    }
  });
  const big = position.length / 3 > 0xffff;
  return { position: new Float32Array(position), shape: new Uint16Array(shape), index: big ? new Uint32Array(index) : new Uint16Array(index) };
}
