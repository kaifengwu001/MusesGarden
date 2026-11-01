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
  [ROW.GRASS]: ['#A9B8A1', '#8C9F90', '#6D8178', '#C2CCAC', '#ACB8A5', '#526E69', '#8FA9A3', '#CBD1B9', '#E9E6CC'],
  // painted far meadow: brush light, brush mid, brush dark, dry highlight, cool strokes, warm strokes
  [ROW.BRUSH]: ['#D7E0DA', '#CCD6D3', '#ADBEC1', '#E9E5CF', '#9EB5BC', '#C4CBB3'],
  // the mirror's cobalt, the navy body, -, highlight, pale sky low in the mirror, deep cobalt high in it,
  // lily pad, lily pad shade, a bank in the mirror, ruffle
  [ROW.WATER]: ['#2E78C0', '#0D4A84', '#D7EEE8', '#F6FCFF', '#6FA6D8', '#1C5FAA', '#6FA548', '#4A7F35', '#16404A', '#8CBBE6'],
  // cup light, cup mid, inner, cup shade, stem, stem shade, blush, rose, coral, rose shade
  [ROW.PINK]: ['#E76C61', '#CA4D50', '#F5A48A', '#9E3E4F', '#B79A78', '#8E7661', '#F2B6A1', '#CC4C59', '#E87860', '#7C384C'],
  // petal, petal shade, centre, centre bright, cream, pale lilac
  [ROW.STAR]: ['#FBF8EE', '#E1DCD0', '#E9D9A6', '#F2D45C', '#F5EACB', '#E3DCF2'],
  // yellow, yellow shade, blue, blue shade, red, red shade, orange, orange shade, violet, violet shade, lemon
  [ROW.SCATTER]: ['#E2C888', '#BFA76A', '#88A5AA', '#617F8B', '#C95556', '#973A4C', '#D99265', '#A66C4E', '#9CA3BA', '#737D99', '#F3E4B5'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far meadow
  [ROW.SKY]: ['#82BEC2', '#C6DFDA', '#E6EBDD', '#FFF0CF', '#A9D3CF', '#BDCFCE'],
  // lit, shadowed, mid, rim, base (the meadow's green through it)
  [ROW.CLOUD]: ['#F5F1DC', '#B9CED0', '#E5E8DA', '#FFF7DE', '#C0D1CD'],
  // rock, shadow, light, lilac shade
  [ROW.ROCK]: ['#C0CDD1', '#8FA4B3', '#E3E8DE', '#A8B4C5'],
  // snow, blue-lilac shade, mid, highlight
  [ROW.SNOW]: ['#F1F3F7', '#C4C8E4', '#DCE1EF', '#FFFFFF'],
  // the cottage's plaster (colours taken from the reference): wall light (pale butter cream), wall, pink-lavender patch,
  // stone, stone dark, joint, damp at the waterline, ochre bloom, landing top, landing side, eaves' shadow (lavender blue),
  // -, brick, brick dark, stone where the plaster has fallen, damp at the foot
  [ROW.STONE]: ['#E6D1A4', '#DCC69A', '#DCC6B0', '#BCA889', '#A68F72', '#9A876C', '#858C6A', '#D9BC80', '#DED0AA', '#C7B98E', '#8F8D6C', '#EFE6CE', '#A65B3E', '#7E4330', '#BFA78C', '#A3A486'],
  // tile, tile shade, door wood, door wood shade, iron, tile light, moss light, moss dark, capping tiles, window frames,
  // glass: the meadow, glass: the sky, bench wood, under the eaves, tile edge (lit), tile grey
  [ROW.ROOF]: ['#6C624A', '#35332A', '#94784A', '#6E5734', '#2E2A26', '#7E7558', '#8E8C55', '#5F6337', '#A59D7E', '#3E3A2E', '#6F7553', '#A9B7B4', '#AE8748', '#4E3D30', '#BDB394', '#6E675A'],
  // sun light, sky ambient, ground bounce, rim, shadow tint
  [ROW.LIGHT]: ['#FFF3DD', '#CDDFE4', '#CFD7BF', '#FFF4D7', '#8DA6B2'],
  // buds and pale meadow ahead of the bloom: bud green, bud tip, dry grass
  [ROW.BUD]: ['#A5AA8B', '#D8CDB0', '#BDBDA2'],
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
