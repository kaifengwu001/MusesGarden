import { Color, DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { clamp, smoothstep } from '../../../src/core/math';

// Every colour in the world comes from one 16×16 palette texture generated
// here. Rows are material families; columns run light → shadow, then hue
// variations. Colours start from the brief's by-eye values (keyed to the
// reference) and shift with the time of day: the noon palette is the base,
// dawn and golden hour override the sky and light rows and warm the rest.

export const ROW = {
  GRASS: 0,
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
} as const;

type Rows = Partial<Record<number, readonly string[]>>;

// Noon. Column meanings per row are noted; shaders reference them by index.
const NOON: Rows = {
  // light, mid, shade, sunlit tips, pale (ahead of bloom), deep shade, far blue-green, pale light, wind sheen
  [ROW.GRASS]: ['#ACD578', '#7DB75C', '#4D8D55', '#C4DD91', '#8CB579', '#326C50', '#65A77B', '#B6D891', '#E1EBB0'],
  // painted far meadow: brush light, brush mid, brush dark, dry highlight, cool strokes, warm strokes
  [ROW.BRUSH]: ['#B0D780', '#88BC68', '#5D9B5D', '#D1DCA3', '#75B193', '#A1C975'],
  // the mirror's cobalt, the navy body, -, highlight, pale sky low in the mirror, deep cobalt high in it,
  // lily pad, lily pad shade, a bank in the mirror, ruffle
  [ROW.WATER]: ['#69C1CE', '#3C9CAF', '#C6EBE8', '#F5FBEE', '#B4D8E8', '#65ACCF', '#95BD76', '#5F9672', '#548B88', '#B5DFEA'],
  // cup light, cup mid, inner, cup shade, stem, stem shade, blush, rose, coral, rose shade
  [ROW.PINK]: ['#F8C8D9', '#ECA6C4', '#FFF0E7', '#C78BAF', '#7DAB68', '#4D7E58', '#FFE1E5', '#E891BA', '#F3BCC3', '#B97DA3'],
  // petal, petal shade, centre, centre bright, cream, pale lilac
  [ROW.STAR]: ['#FBF8EE', '#E1DCD0', '#E9D9A6', '#F2D45C', '#F5EACB', '#E3DCF2'],
  // yellow, yellow shade, blue, blue shade, red, red shade, orange, orange shade, violet, violet shade, lemon
  [ROW.SCATTER]: ['#F2D45C', '#D7AE3A', '#6E8FD8', '#4E6BB3', '#E05A4F', '#B6433B', '#F2A03C', '#C77A24', '#9B7BD8', '#6E55AE', '#F8EA8C'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far meadow
  [ROW.SKY]: ['#8DBDE2', '#D4E5EE', '#E6EDE9', '#FFF4DB', '#ABD0E8', '#C7DDD5'],
  // lit, shadowed, mid, rim, base: white with a faint blossom-pink blush (Kai)
  [ROW.CLOUD]: ['#FFF2F5', '#E6D6E2', '#F8E8EE', '#FFFAFC', '#DDD2D9'],
  // rock, shadow, light, lilac shade
  [ROW.ROCK]: ['#8C9D9A', '#657A80', '#BDC7BB', '#9396AC'],
  // snow, blue-lilac shade, mid, highlight
  [ROW.SNOW]: ['#F1F3F7', '#C4C8E4', '#DCE1EF', '#FFFFFF'],
  // the cottage's plaster (colours taken from the reference): wall light (pale butter cream), wall, pink-lavender patch,
  // stone, stone dark, joint, damp at the waterline, ochre bloom, landing top, landing side, eaves' shadow (lavender blue),
  // -, brick, brick dark, stone where the plaster has fallen, damp at the foot
  [ROW.STONE]: ['#F0ECD8', '#E0E1CB', '#E6D9D7', '#C5C9B5', '#A2AF9E', '#95A195', '#7B9D81', '#DFCFAB', '#F0E8CF', '#C6CDB8', '#9AA9AA', '#FAF4E4', '#C88B7A', '#A3665F', '#C7C9B3', '#9DB19A'],
  // tile, tile shade, door wood, door wood shade, iron, tile light, moss light, moss dark, capping tiles, window frames,
  // glass: the meadow, glass: the sky, bench wood, under the eaves, tile edge (lit), tile grey
  [ROW.ROOF]: ['#6D899D', '#425F77', '#C78470', '#A46659', '#343C45', '#91AAB5', '#8EA793', '#617D71', '#9FB3BC', '#4A555B', '#95AD8F', '#C1DDE0', '#C78F78', '#655763', '#B8C8CB', '#778D9A'],
  // sun light, sky ambient, ground bounce, rim, shadow tint
  [ROW.LIGHT]: ['#FFF8E6', '#D2E2F1', '#BFDA9B', '#FFF7E5', '#A0AEC6'],
  // buds and pale meadow ahead of the bloom: bud green, bud tip, dry grass
  [ROW.BUD]: ['#8BAF72', '#BBC98E', '#B4C68D'],
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
