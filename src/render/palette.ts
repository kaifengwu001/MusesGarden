import { Color, DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { clamp, smoothstep } from '../core/math';

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
  WING: 14,
} as const;

type Rows = Partial<Record<number, readonly string[]>>;

// Noon. Column meanings per row are noted; shaders reference them by index.
const NOON: Rows = {
  // light, mid, shade, sunlit tips, pale (ahead of bloom), deep shade, far blue-green, pale light, wind sheen
  [ROW.GRASS]: ['#8BA44A', '#629237', '#346A28', '#A7AC5E', '#7C9250', '#235325', '#57855C', '#9AA965', '#CFD49A'],
  // painted far meadow: brush light, brush mid, brush dark, dry highlight, cool strokes, warm strokes
  [ROW.BRUSH]: ['#81A04A', '#6A933B', '#4D7D31', '#A8AE75', '#57895F', '#93A451'],
  // the mirror's cobalt, the navy body, -, highlight, pale sky low in the mirror, deep cobalt high in it,
  // lily pad, lily pad shade, a bank in the mirror, ruffle
  [ROW.WATER]: ['#2E78C0', '#0D4A84', '#D7EEE8', '#F6FCFF', '#6FA6D8', '#1C5FAA', '#6FA548', '#4A7F35', '#16404A', '#8CBBE6'],
  // cup light, cup mid, inner, cup shade, stem, stem shade, blush, rose, coral, rose shade
  [ROW.PINK]: ['#F09AA2', '#DE6F80', '#F7C2B8', '#C2566E', '#6E9E4A', '#4D7A36', '#F5BCC2', '#DA4C74', '#EE7A66', '#A63A63'],
  // petal, petal shade, centre, centre bright, cream, pale lilac
  [ROW.STAR]: ['#FBF8EE', '#E1DCD0', '#E9D9A6', '#F2D45C', '#F5EACB', '#E3DCF2'],
  // yellow, yellow shade, blue, blue shade, red, red shade, orange, orange shade, violet, violet shade, lemon
  [ROW.SCATTER]: ['#F2D45C', '#D7AE3A', '#6E8FD8', '#4E6BB3', '#E05A4F', '#B6433B', '#F2A03C', '#C77A24', '#9B7BD8', '#6E55AE', '#F8EA8C'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far meadow
  [ROW.SKY]: ['#2F7CC4', '#A9D3EE', '#D6EAF1', '#FFF4D8', '#5E9BD5', '#AFC6BE'],
  // lit, shadowed, mid, rim, base (the meadow's green through it)
  [ROW.CLOUD]: ['#F7FAFB', '#CAD7DF', '#E3EBEF', '#FFFFFF', '#B2C6C1'],
  // rock, shadow, light, lilac shade
  [ROW.ROCK]: ['#6F7C8E', '#4E5D78', '#8F99AA', '#77739D'],
  // snow, blue-lilac shade, mid, highlight
  [ROW.SNOW]: ['#F1F3F7', '#C4C8E4', '#DCE1EF', '#FFFFFF'],
  // limewash light, limewash, the eaves' shadow, stone, stone dark, mortar, damp, ochre stain, plaster top, quoin, rain streak, brick, brick dark
  [ROW.STONE]: ['#F3E3AE', '#E0C98F', '#A7A0AE', '#D9C690', '#B7A276', '#9C8F72', '#A3A57E', '#D3A35C', '#E9E1CC', '#E8D7A8', '#B9AE99', '#B8704E', '#8F5238', '#E9C6A6'],
  // tile, tile shade, wood, wood shade, iron, tile light, moss, moss shade, lichen, ridge tile, moss bright, tile gap, window frame, glass sky, glass meadow
  [ROW.ROOF]: ['#7E6F57', '#4A4136', '#B0743F', '#74472A', '#3E3A36', '#A0927A', '#A9B35A', '#6E7A42', '#D9D2A6', '#9A8E74', '#D0D070', '#2F2922', '#46433F', '#E3EEE8', '#B5D08A'],
  // sun light, sky ambient, ground bounce, rim, shadow tint
  [ROW.LIGHT]: ['#FFF3DE', '#BFD8F0', '#A7C27B', '#FFF5DA', '#7E92B8'],
  // buds and pale meadow ahead of the bloom: bud green, bud tip, dry grass
  [ROW.BUD]: ['#748C47', '#A0945C', '#8D915C'],
  // butterfly wings, a ground colour and its mark each: white (dark tips), sulphur (orange dot),
  // fritillary (dark spots), blue (white fringe), red admiral-ish (cream bar), orange tip (orange tips); body
  [ROW.WING]: ['#F7F4EA', '#3B3A3C', '#F3E07A', '#E98A2E', '#E8893A', '#5B3720', '#86A9EC', '#F6F4EE', '#B4452E', '#F4E3B4', '#F6F2E6', '#F09A3A', '#3A332C'],
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
