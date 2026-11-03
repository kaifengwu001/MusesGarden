// The terraces' height fog (Kai, 2026-11-02: "a general height based fog", with sliders for its density, range and
// falloff; then patchy across the globe, with sliders): a haze filling the valleys at its full density up to its
// range (a height over the radius), thinning away above it by e every falloff meters, denser in some places than
// others by a broad noise over the globe (its patches). Its amount along a view ray is worked out exactly over its
// heights, from the camera's height to the point's (so a valley seen from a hill is hazed by all the fog it holds, a
// hilltop seen from orbit hardly at all), its patches' at the point and half way to it. Its colour the sky's haze, a
// little paler, so the far land fades toward the sky behind it; tinted toward a blue or a green as light (Kai: "make
// fog slightly green / blue tinted", by sliders: how much, and which).
// Requires: the palette (toon, terraces_common), noise, uRadius.
uniform vec4 uHeightFog; // its density (1/m), its range and its falloff (m: the height it fills to, over the radius; how far above that it thins by e), the camera's height (m over the radius)
uniform vec4 uHeightFogPatches; // how patchy it is (0 … 1), its patches' size (m), -, -
uniform vec3 uHeightFogEye;     // the camera's sub-point (planet direction)
uniform vec2 uHeightFogTint;    // how tinted (0 … 1), and toward which (0: the blue, 1: the green)

// How dense the fog is over a direction, by its patches (× its density: 1 where it is even; 0 … about 2 where it is
// patchy): two octaves of noise, the patches' size and a third of it.
float heightFogPatch(vec3 d) {
  vec3 q = d * (uRadius / max(uHeightFogPatches.y, 1.0));
  float n = 0.7 * gnoise(q + 31.7, 7711u) + 0.3 * gnoise(q * 2.9 + 3.3, 7712u);
  return max(1.0 + uHeightFogPatches.x * 2.2 * n, 0.0);
}

// The fog's density summed up to height h from far below, over its full density (m): all of it up to its range,
// thinning above.
float heightFogColumn(float h) {
  float top = uHeightFog.y;
  float H = uHeightFog.z;
  return h <= top ? h : top + H * (1.0 - exp(-(h - top) / H));
}

// How much of the fog lies between the camera and a point dist m away at height h (m over the radius) in direction d: 0 … 1.
float heightFogAmount(float dist, float h, vec3 d) {
  float hc = uHeightFog.w;
  float dh = h - hc;
  // (the density's mean along the ray: the column between its two heights over their difference)
  float hm = 0.5 * (h + hc);
  float mean = abs(dh) > 0.05 ? (heightFogColumn(h) - heightFogColumn(hc)) / dh : (hm <= uHeightFog.y ? 1.0 : exp(-(hm - uHeightFog.y) / uHeightFog.z));
  // (its patches: as dense as they are at the point and half way to it, on the whole)
  float patches = 0.5 * (heightFogPatch(d) + heightFogPatch(normalize(d + 0.999 * uHeightFogEye)));
  return 1.0 - exp(-uHeightFog.x * patches * dist * mean);
}

vec3 heightFogColour() {
  vec3 haze = mix(pal(ROW_SKY, 2), pal(ROW_SKY, 3), 0.25);
  vec3 tint = mix(pal(TR_FOG, 7), pal(TR_FOG, 8), uHeightFogTint.y);
  // (the tint as light as the haze, so the sliders turn its hue, not its value)
  vec3 lum = vec3(0.2126, 0.7152, 0.0722);
  tint *= dot(haze, lum) / max(dot(tint, lum), 1e-4);
  return mix(haze, tint, uHeightFogTint.x);
}

vec3 applyHeightFog(vec3 col, float dist, float h, vec3 d) {
  return mix(col, heightFogColour(), heightFogAmount(dist, h, d));
}
