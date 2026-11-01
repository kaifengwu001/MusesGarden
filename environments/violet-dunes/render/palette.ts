import { Color, DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { clamp, smoothstep } from '../../../src/core/math';

// Every colour in the world comes from one 16×16 palette texture generated
// here. Rows are material families; columns run light → shadow, then hue
// variations. Colours start from the brief's by-eye values (keyed to the
// reference) and shift with the time of day: the noon palette is the base,
// dawn and golden hour override the sky and light rows and warm the rest.

export const ROW = {
  SAND: 0,
  BRUSH: 1,
  WATER: 2,
  PINK: 3,
  STAR: 4,
  SCATTER: 5,
  SKY: 6,
  CLOUD: 7,
  ROCK: 8,
  SNOW: 9,
  STONE: 10,
  ROOF: 11,
  LIGHT: 12,
  BUD: 13,
  // Violet Dunes' names for rows that once held the meadow's (the old names stay until nothing uses them)
  LEAF: 3,
  CANVAS: 9,
  TIMBER: 11,
} as const;

type Rows = Partial<Record<number, readonly string[]>>;

// Noon. Column meanings per row are noted; shaders reference them by index.
// Sand, slate, leaf, ivory, timber and sky from the Violet Dunes brief
// (assets.json palette), the rest keyed to its painted boards.
const NOON: Rows = {
  // sand: lit (sand highlight), mid (sand), shade, sunlit highlight, pale, deep shade (the brief's shadow),
  // far sand, ripple light, ripple shade, warm sand
  [ROW.SAND]: ['#E9CFE0', '#BE9DCC', '#8873AE', '#F5E3EA', '#D4BADD', '#695C91', '#AA94C8', '#F1DCE7', '#7E6AAB', '#E8C6D8'],
  // drybrush light, drybrush violet, the habitat's grey-violet, warm stroke, -, -, sail-reed ochre (far wash)
  [ROW.BRUSH]: ['#F4ECF0', '#A493CB', '#9E95B8', '#DDC3D2', '#8D86A6', '#5E5874', '#D9B24A'],
  // (the meadow's water: no shader in this world draws it)
  [ROW.WATER]: ['#2E78C0', '#0D4A84', '#D7EEE8', '#F6FCFF', '#6FA6D8', '#1C5FAA', '#6FA548', '#4A7F35', '#16404A', '#8CBBE6'],
  // leaf (sail-reed, starflower leaves): leaf (the brief's), leaf shade, backlit, vein, woody stem, stem shade, far leaf
  [ROW.LEAF]: ['#E9BC42', '#C4952C', '#F7DD8A', '#B97A2E', '#8E4F2E', '#6A3B27', '#D9AC48'],
  // starflower: petal (ivory), petal shade, centre (ochre), centre bright, cream, pale lilac
  [ROW.STAR]: ['#F7F1E2', '#DDD4CA', '#D7A23A', '#EFC257', '#F5ECD1', '#E9E0F1'],
  // yellow, yellow shade, blue, blue shade, red, red shade, orange, orange shade, violet, violet shade, lemon
  [ROW.SCATTER]: ['#F2D45C', '#D7AE3A', '#6E8FD8', '#4E6BB3', '#E05A4F', '#B6433B', '#F2A03C', '#C77A24', '#9B7BD8', '#6E55AE', '#F8EA8C'],
  // zenith, horizon (the brief's pale cyan), haze, sun glow, mid sky, haze over the far dunes (lilac)
  [ROW.SKY]: ['#DCA7BD', '#F0CBD3', '#F5DEE1', '#FFF1E7', '#E5B8CB', '#D3BED8'],
  // lit, shadowed (lilac), mid, rim, base (the sand's violet through it)
  [ROW.CLOUD]: ['#EEE4EF', '#BAACD1', '#D6C9E0', '#FFFFFF', '#B5A4D3'],
  // slate: rock (the brief's), shadow, light, lilac shade, warm lichen, deep
  [ROW.ROCK]: ['#635D79', '#45405E', '#8C86A4', '#77709C', '#9A8F94', '#55506C'],
  // canvas: ivory (the brief's), mid, shade, highlight, seam and hem, weave
  [ROW.CANVAS]: ['#F5ECD1', '#E3D4B6', '#C3B092', '#FBF6E7', '#B6A07C', '#D9CBAE'],
  // the plinth's dry stone (slate laid in courses): light, stone, shade, joint, top lit, top, warm stone
  [ROW.STONE]: ['#8E86A5', '#6E6788', '#4F4A66', '#3B374E', '#A39BB5', '#7D7596', '#94898F'],
  // timber: timber (the brief's), shade, light, end grain, worn edge, door, door shade, rope, rope shade
  [ROW.TIMBER]: ['#74523E', '#55392B', '#97714F', '#3E2A20', '#B08A62', '#A8784A', '#7C5636', '#D9C9A6', '#B3A07D'],
  // sun light, sky ambient, ground bounce (violet sand), rim, shadow tint
  [ROW.LIGHT]: ['#FFF6E8', '#DFD1E3', '#C9B5DA', '#FFF4E4', '#8579B8'],
  // ahead of the bloom front: closed buds, bud tips, pale sand
  [ROW.BUD]: ['#C9BADB', '#D8CADF', '#C3B6D5'],
};

const DAWN: Rows = {
  [ROW.SKY]: ['#3F70B3', '#F2C7AE', '#F6DCCB', '#FFD9B0', '#7F9CCB'],
  [ROW.CLOUD]: ['#FCE6DA', '#B9B5CC', '#E9D2CF', '#FFF0E4', '#9D9AB6'],
  [ROW.LIGHT]: ['#FFD2A8', '#B7C4E6', '#9FAE84', '#FFD7B4', '#7C7FB0'],
};

const GOLDEN: Rows = {
  [ROW.SKY]: ['#2E68AE', '#F4D09E', '#F7E0BC', '#FFE1A6', '#6C97C9'],
  [ROW.CLOUD]: ['#FFEBCF', '#C3B9C4', '#F1DAC0', '#FFF4DF', '#A79EAF'],
  [ROW.LIGHT]: ['#FFC583', '#B4C5E2', '#B2B577', '#FFD796', '#7F7EA9'],
};

/** Warm or cool multiplier on every material row (not sky/light) per key. */
const TINT = { dawn: '#F4E2DC', noon: '#FFFFFF', golden: '#FFEACB' };

const SIZE = 16;
const toLinear = (hex: string): Color => new Color(hex); // three converts sRGB hex → linear

export interface SunState {
  /** Sun elevation above the local horizon, radians. */
  elevation: number;
  /** Azimuth from local north, radians, clockwise seen from above (east = π/2). */
  azimuth: number;
}

/**
 * Sun path over the day at the place you are looking: rises in the east
 * ~6:00, stands ~58° high in the south at 12:30, sets in the west ~19:00.
 */
export function sunAt(hours: number, out: SunState = { elevation: 0, azimuth: 0 }): SunState {
  const day = clamp((hours - 6) / 13, 0, 1);
  out.elevation = Math.max(0.06, Math.sin(Math.PI * day)) * ((58 * Math.PI) / 180);
  out.azimuth = Math.PI / 2 + Math.PI * day;
  return out;
}

export class Palette {
  readonly texture: DataTexture;
  private readonly data = new Uint8Array(SIZE * SIZE * 4);
  private readonly linear: Color[] = Array.from({ length: SIZE * SIZE }, () => new Color(1, 0, 1));
  private hours = Number.NaN;
  private readonly noon = expand(NOON);
  private readonly dawn = expand(DAWN);
  private readonly golden = expand(GOLDEN);
  private readonly tint = { dawn: toLinear(TINT.dawn), noon: toLinear(TINT.noon), golden: toLinear(TINT.golden) };

  constructor() {
    this.texture = new DataTexture(this.data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.update(12.5);
  }

  /** Linear colour of a palette cell (for CPU-side uniforms). */
  get(row: number, col: number, out = new Color()): Color {
    return out.copy(this.linear[row * SIZE + col]);
  }

  /** Rebuild for a time of day in hours; cheap, and skipped when unchanged. */
  update(hours: number): void {
    if (hours === this.hours) return;
    this.hours = hours;
    // weights for the three keys: dawn 6.2, noon 12.5, golden 18.4
    const toDawn = 1 - smoothstep(6.2, 10.5, hours);
    const toGolden = smoothstep(14.8, 18.4, hours);
    const tint = new Color().copy(this.tint.noon).lerp(this.tint.dawn, toDawn).lerp(this.tint.golden, toGolden);
    const c = new Color();
    for (let i = 0; i < SIZE * SIZE; i++) {
      const row = Math.floor(i / SIZE);
      c.copy(this.noon[i] ?? MISSING);
      if (this.dawn[i]) c.lerp(this.dawn[i]!, toDawn);
      if (this.golden[i]) c.lerp(this.golden[i]!, toGolden);
      if (row !== ROW.SKY && row !== ROW.LIGHT && row !== ROW.CLOUD) c.multiply(tint);
      this.linear[i].copy(c);
      const s = c.clone().convertLinearToSRGB();
      this.data[i * 4] = Math.round(clamp(s.r, 0, 1) * 255);
      this.data[i * 4 + 1] = Math.round(clamp(s.g, 0, 1) * 255);
      this.data[i * 4 + 2] = Math.round(clamp(s.b, 0, 1) * 255);
      this.data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}

/** Unassigned cells show magenta, so a wrong palette index is obvious. */
const MISSING = new Color(1, 0, 1);

function expand(rows: Rows): Array<Color | null> {
  const out: Array<Color | null> = Array.from({ length: SIZE * SIZE }, () => null);
  for (const [row, cols] of Object.entries(rows)) {
    cols?.forEach((hex, col) => {
      out[Number(row) * SIZE + col] = toLinear(hex);
    });
  }
  return out;
}
