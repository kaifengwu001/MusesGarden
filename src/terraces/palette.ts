import { ROW, type Rows } from '../render/palette';

// The terraces' colours, measured from Kai's references (reference/terraces/:
// the ink-wash peaks and mist of 1, the greens of 3, 4 and 5, the forest of
// 7, the paper whites of 8). Same 16×16 texture as the meadow's: the sky,
// cloud and light rows keep their places (the sky, the aerial haze and the
// sun read them); the other rows are this planet's own (TR_* in
// terraces/common.glsl).

export const TROW = {
  RICE: 0,
  EARTH: 1,
  WATER: 2,
  FOREST: 3,
  PEAK: 4,
  FOG: 5,
} as const;

export const TERRACE_ROWS: Rows = {
  // seedling, fresh, deep, yellow-green (heading), ripe gold, pale tip, shade, sheen, far green, jade (3), sage (3)
  [TROW.RICE]: ['#A5C46A', '#7FAF3C', '#4F8D3B', '#A6BE56', '#C9BC5E', '#D3DE9C', '#2E6131', '#DDE7AC', '#7FA27A', '#4E8F6F', '#7DB296'],
  // bund grass, bund shade, riser face, riser shade, wet mud, dark mud, dry path, pale bund (1, 8)
  [TROW.EARTH]: ['#93AF62', '#5D7B3D', '#6F8650', '#3D5A36', '#6A6B4B', '#45493A', '#B5A77C', '#C9D3B3'],
  // pale sky in the mirror, high sky in it, body looking down, shallow (mud through), glint, a bank in the mirror, ruffle,
  // teal (5), white water (5)
  [TROW.WATER]: ['#D5E3E4', '#9DBCCF', '#4C7A84', '#7B8E77', '#F7FBFA', '#2E4A40', '#C5D9DE', '#87BEA6', '#DCE3CB'],
  // canopy light, canopy mid, canopy shade, deep shade, rim, trunk, forest floor, far blue-green, olive light (4)
  [TROW.FOREST]: ['#5D8A47', '#2F663B', '#174D33', '#0C3A2E', '#8DB16C', '#4B3B2D', '#1D4630', '#2F5E55', '#7E9A55'],
  // the peaks as the ink paintings lay them: teal, blue-grey, pale blue, deep teal, lit rock, moss
  [TROW.PEAK]: ['#44798C', '#73909A', '#8AA2B7', '#1B4754', '#A5B3C5', '#4F7A5C'],
  // fog in sun, fog in shade, deep fog, warm white (paper)
  [TROW.FOG]: ['#F5F5EF', '#BCCAD4', '#9FB3C1', '#FBF6EA'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far land: a paler, mistier sky than the meadow's
  [ROW.SKY]: ['#6F9CC6', '#CCDEE8', '#E5EDEF', '#FFF5E0', '#98BAD6', '#BCCFCC'],
  // the white birds read the cloud row: lit, shadowed, mid, rim, base
  [ROW.CLOUD]: ['#F7FAFB', '#CAD7DF', '#E3EBEF', '#FFFFFF', '#B2C6C1'],
  // sun light, sky ambient, ground bounce, rim, shadow tint
  [ROW.LIGHT]: ['#FFF3DE', '#C6DAEC', '#A7C27B', '#FFF5DA', '#7E92B8'],
};
