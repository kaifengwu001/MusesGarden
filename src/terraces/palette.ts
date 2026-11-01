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
  // the paddies' crop, in the ink painting's greens (its fields: teal-green #467F81, sage #7E9894), at the
  // values of the vista's fields (vista-target.png: mid #90AAB2, light #C2CFD5, deep #698793):
  // seedling, fresh, deep, heading, ripe straw, pale tip, shade, sheen, far, jade, sage
  [TROW.RICE]: ['#A3C3B2', '#7AA497', '#5A8A84', '#B4C49B', '#CCC79E', '#D3DDD8', '#365F62', '#E3ECE8', '#8EA6AC', '#5F968A', '#8FA6A2'],
  // bund grass (a pale line), bund shade, riser face, riser shade, wet mud, dark mud, courtyard (paper), pale bund
  [TROW.EARTH]: ['#A4BDB2', '#5F807E', '#6D8F8A', '#3D5F66', '#7C8C88', '#55666A', '#D8D3C2', '#E0E7E3'],
  // pale sky in the mirror, high sky in it, body looking down, shallow, glint (paper white), a bank in the mirror,
  // ruffle, teal (the painting's water #88A3AC), white water: the flooded fields read near white (vista #EAECFF)
  [TROW.WATER]: ['#E8EDF0', '#BCCBD8', '#7E9CA4', '#9DB0B0', '#FAF9F3', '#4A6A72', '#DDE5E8', '#9FB5BC', '#EEF0EE'],
  // the forest as the painting's dark masses: canopy light, mid, shade, deep, rim, trunk, floor, far, olive light
  [TROW.FOREST]: ['#5F8C88', '#3F6E74', '#2A4F5B', '#163B43', '#88AAA3', '#3E3A36', '#23464D', '#4F6B80', '#6F907E'],
  // the peaks' ink: blue-teal, blue-grey, pale, deep, lit pale, moss
  [TROW.PEAK]: ['#5380A2', '#7790B1', '#A6B3CE', '#2F6589', '#B9C4DB', '#4F7A6E'],
  // the mist: in sun (paper white), in shade, deep, warm paper
  [TROW.FOG]: ['#F9F8F4', '#CDD0DE', '#9BA9C2', '#FAF9F3'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far land: the painting's pale paper sky
  [ROW.SKY]: ['#94AACA', '#E2E5EC', '#EFEEEC', '#FFF8EC', '#B6C3D8', '#AEBBD6'],
  // the white birds read the cloud row: lit, shadowed, mid, rim, base
  [ROW.CLOUD]: ['#FAF9F5', '#C8D2DD', '#E3E8EE', '#FFFFFF', '#B2C2C6'],
  // sun light, sky ambient, ground bounce, rim, shadow tint
  [ROW.LIGHT]: ['#FFF5E6', '#C9D5E7', '#9FB8A8', '#FFF5E4', '#7E92B8'],
};
