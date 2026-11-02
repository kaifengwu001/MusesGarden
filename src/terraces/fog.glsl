// The terraces' height fog (Kai, 2026-11-02: "a general height based fog", with sliders for its density, range and
// falloff): a haze filling the valleys at its full density up to its range (a height over the radius), thinning away
// above it by e every falloff meters. Its amount along a view ray is worked out exactly, from the camera's height to
// the point's (so a valley seen from a hill is hazed by all the fog it holds, a hilltop seen from orbit hardly at all).
// Its colour the sky's haze, a little paler, so the far land fades toward the sky behind it.
// Requires: the palette (toon).
uniform vec4 uHeightFog; // its density (1/m), its range and its falloff (m: the height it fills to, over the radius; how far above that it thins by e), the camera's height (m over the radius)

// The fog's density summed up to height h from far below, over its full density (m): all of it up to its range,
// thinning above.
float heightFogColumn(float h) {
  float top = uHeightFog.y;
  float H = uHeightFog.z;
  return h <= top ? h : top + H * (1.0 - exp(-(h - top) / H));
}

// How much of the fog lies between the camera and a point dist m away at height h (m over the radius): 0 … 1.
float heightFogAmount(float dist, float h) {
  float hc = uHeightFog.w;
  float dh = h - hc;
  // (the density's mean along the ray: the column between its two heights over their difference)
  float hm = 0.5 * (h + hc);
  float mean = abs(dh) > 0.05 ? (heightFogColumn(h) - heightFogColumn(hc)) / dh : (hm <= uHeightFog.y ? 1.0 : exp(-(hm - uHeightFog.y) / uHeightFog.z));
  return 1.0 - exp(-uHeightFog.x * dist * mean);
}

vec3 heightFogColour() {
  return mix(pal(ROW_SKY, 2), pal(ROW_SKY, 3), 0.25);
}

vec3 applyHeightFog(vec3 col, float dist, float h) {
  return mix(col, heightFogColour(), heightFogAmount(dist, h));
}
