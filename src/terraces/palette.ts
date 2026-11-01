import { ROW, type Rows } from '../render/palette';

// The terraces' colours, measured from the two paintings Kai gave as the
// starting points (reference/terraces/valley-painting.webp and
// planet-painting.webp, look-dev regions.mjs): fields in yellow-greens from
// lime to deep, water a pale silver, towers and trees dark blue-grey and
// blue-green, mist and sky a cool grey-blue, white plaster and dark roofs.
// The contrast is theirs: dark trees and towers against silver water and
// lime fields. Same 16×16 texture as the meadow's: the sky, cloud and light
// rows keep their places (the sky, the aerial haze and the sun read them);
// the other rows are this planet's own (TR_* in terraces/common.glsl).

export const TROW = {
  RICE: 0,
  EARTH: 1,
  WATER: 2,
  FOREST: 3,
  PEAK: 4,
  FOG: 5,
} as const;

export const TERRACE_ROWS: Rows = {
  // the paddies' crop, from the paintings' fields (valley: grown #4B6C49 lit #698754, seedlings over water #8C9977;
  // planet: lime #ACB08A, greens #5F7060 #4F6357): seedling, fresh, deep, heading, ripe straw, pale tip, shade,
  // sheen, far, jade, sage, lime, blue-green (each paddy leans a little toward jade, lime or blue-green)
  [TROW.RICE]: ['#93A673', '#86A65E', '#4E6E48', '#9AA85E', '#BDB57A', '#C6D09C', '#2A4632', '#D9E2C2', '#6B8779', '#557F5E', '#7E9472', '#A9BC6C', '#4C7462'],
  // bund grass (the paintings' lime rims), bund shade, riser face (grass on earth), riser shade, wet mud, dark mud, courtyard and path, lit bund
  [TROW.EARTH]: ['#86A158', '#4F6A3A', '#4E6640', '#2C3F2A', '#6C6F5C', '#484B3F', '#C9C0A8', '#9DB769'],
  // pale sky in the mirror, high sky in it, body looking down, shallow, glint, a bank in the mirror, ruffle, teal, white water:
  // the flooded fields silver (#B1BCBE, light #B8C2C4), the river a little bluer (#9EB0BC), its darks the banks (#7D9497)
  [TROW.WATER]: ['#CDD5D8', '#B3C1CA', '#7D9497', '#93A39B', '#EDF1F1', '#3C5446', '#B9C5C9', '#8EA4AA', '#D2D9DA'],
  // the trees: canopy light, mid, shade, deep, rim, trunk, floor, far, olive light (valley: round #3A5538 lit #5C775F, cypress #223A42)
  [TROW.FOREST]: ['#5C775F', '#3A5538', '#24402F', '#1A2E2C', '#7E9670', '#3E3A36', '#22392C', '#4C6570', '#74895A'],
  // the towers' stone: lit, far, pale, deep, lit pale, moss (valley: lit #59718D, far #6881A1; planet: #485B6E, top #384E5E)
  [TROW.PEAK]: ['#59718D', '#6881A1', '#97A7C4', '#384E5E', '#A6B4C8', '#4D6650'],
  // the mist: lit, in shade, deep, warm paper (valley mist #B7BFCF; the cloud sea #94A1B7)
  [TROW.FOG]: ['#E9ECF1', '#BEC6D4', '#94A1B7', '#F2F1EC'],
  // zenith, horizon, haze, sun glow, mid sky, haze over the far land: the paintings' overcast grey-blue (#AAB7CB)
  [ROW.SKY]: ['#9AAAC2', '#CBD3DE', '#D6DCE4', '#F4F1EA', '#B2BED0', '#A7B4C7'],
  // the white birds read the cloud row: lit, shadowed, mid, rim, base
  [ROW.CLOUD]: ['#FAF9F5', '#C8D2DD', '#E3E8EE', '#FFFFFF', '#B2C2C6'],
  // sun light, sky ambient, ground bounce, rim, shadow tint: an overcast light, soft
  [ROW.LIGHT]: ['#FFF8EE', '#C9D3E2', '#A6B79A', '#FFF5E4', '#8495B5'],
};
