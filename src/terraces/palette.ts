import { ROW, type Rows } from '../render/palette';

// The terraces' colours. The paddies, their dams and risers, the earth and
// the woods' ground are the paddy lab's (src/dev/paddyLab/build.ts), measured
// from Kai's aerial of the terraces: the paddies by their stage (a little
// lighter for the light), the dams cream, the risers olive. The trees, the
// towers' stone, the mist and the sky are from the two paintings Kai gave as
// the starting points (reference/terraces/valley-painting.webp and
// planet-painting.webp, look-dev regions.mjs). Same 16×16 texture as the
// meadow's: the sky, cloud and light rows keep their places (the sky, the
// aerial haze and the sun read them); the other rows are this planet's own
// (TR_* in terraces/common.glsl).

export const TROW = {
  RICE: 0,
  EARTH: 1,
  FOREST: 3,
  PEAK: 4,
  FOG: 5,
} as const;

export const TERRACE_ROWS: Rows = {
  // the paddies' looks (the lab's LOOKS, graded to the planet painting, 2026-11-02: as it reads on screen, its
  // flooded paddies silver grey, its young ones yellow-green, its grown ones greyer and bluer): flooded (the water's
  // own grey, half of what it mirrors), flooded and shallow, just planted (lime), growing, grown, grown deep
  [TROW.RICE]: ['#A2A89E', '#BDBCB0', '#919A0F', '#56752D', '#3D563D', '#2D4B2E'],
  // a dam (cream), a riser (olive), earth (the woods' edge, the flats' bunds), a track (packed earth, pale)
  [TROW.EARTH]: ['#CCD1A3', '#788F57', '#5C5C3D', '#CFC6AE'],
  // the trees: canopy light, mid, shade, deep, rim, trunk, floor, far, olive light (graded to the planet painting's
  // trees, 2026-11-02: a dark teal, lit #617571, mid #3C5455, shade #283B41 as it reads on screen); the woods'
  // ground under them (the lab's, two greens a noise mixes)
  [TROW.FOREST]: ['#334D4E', '#112529', '#0D2223', '#081821', '#7E9670', '#3E3A36', '#22392C', '#1F3458', '#415949', '#4D6138', '#6B6642'],
  // the towers' stone: lit, far, pale, deep, lit pale, moss (valley: lit #59718D, far #6881A1; planet: #485B6E, top #384E5E)
  [TROW.PEAK]: ['#59718D', '#6881A1', '#97A7C4', '#384E5E', '#A6B4C8', '#4D6650'],
  // the mist: lit, in shade, deep, warm paper (valley mist #B7BFCF; the cloud sea #94A1B7); the blue-green landscape's
  // ribbons of cloud (clouds-ribbons-blue-green.webp, regions): their core cream, their edge greyer, their outline;
  // the height fog's tints (fog.glsl): a soft blue, a jade green (Kai: "slightly green / blue tinted")
  [TROW.FOG]: ['#E9ECF1', '#BEC6D4', '#94A1B7', '#F2F1EC', '#EEEADB', '#D6D4C6', '#C2C5BE', '#93B4D6', '#94C9AE'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far land: the paintings' overcast grey-blue (#AAB7CB)
  [ROW.SKY]: ['#9AAAC2', '#CBD3DE', '#D6DCE4', '#F4F1EA', '#B2BED0', '#A7B4C7'],
  // the white birds read the cloud row: lit, shadowed, mid, rim, base
  [ROW.CLOUD]: ['#FAF9F5', '#C8D2DD', '#E3E8EE', '#FFFFFF', '#B2C2C6'],
  // sun light, sky ambient, ground bounce, rim, shadow tint: an overcast light, soft
  [ROW.LIGHT]: ['#FFF8EE', '#C9D3E2', '#A6B79A', '#FFF5E4', '#8495B5'],
};
