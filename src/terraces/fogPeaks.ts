import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three';

// The height fog's map of the spiky mountains (Kai, 2026-11-02: the fog thinning away from them, "on a 2D map to save
// performance"): how far the nearest of Kai's towers stands from each place on the planet (m, along it), on a raster
// a cube face, the six stacked as the mist's ground raster is (common.glsl `faceAtlas` reads it). Made once a build,
// when the towers are placed; read by fog.glsl at the fog's two samples along each view ray.

/** The map's side (texels a cube face: about 3 m each at the terraces' radius). */
const SIDE = 64;

export function peakMap(): DataTexture {
  const map = new DataTexture(new Uint16Array(SIDE * 6 * SIDE), SIDE, 6 * SIDE, RedFormat, HalfFloatType);
  map.minFilter = LinearFilter;
  map.magFilter = LinearFilter;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.needsUpdate = true;
  return map;
}

/** The map for the build's towers (per tower 8 floats, its direction first) on a planet of a radius (m). */
export function mapPeaks(map: DataTexture, towers: Float32Array, radius: number): void {
  const data = map.image.data as Uint16Array;
  const d = [0, 0, 0];
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const u = (2 * (i + 0.5)) / SIDE - 1;
        const v = (2 * (j + 0.5)) / SIDE - 1;
        if (face === 0) [d[0], d[1], d[2]] = [1, u, v];
        else if (face === 1) [d[0], d[1], d[2]] = [-1, u, v];
        else if (face === 2) [d[0], d[1], d[2]] = [u, 1, v];
        else if (face === 3) [d[0], d[1], d[2]] = [u, -1, v];
        else if (face === 4) [d[0], d[1], d[2]] = [u, v, 1];
        else [d[0], d[1], d[2]] = [u, v, -1];
        const l = Math.hypot(d[0], d[1], d[2]);
        // (the nearest: the one most nearly in the same direction)
        let near = -1;
        for (let k = 0; k < towers.length; k += 8) near = Math.max(near, (d[0] * towers[k] + d[1] * towers[k + 1] + d[2] * towers[k + 2]) / l);
        data[(face * SIDE + j) * SIDE + i] = DataUtils.toHalfFloat(radius * Math.acos(Math.min(Math.max(near, -1), 1)));
      }
    }
  }
  map.needsUpdate = true;
}
