// The terraces' height fog (Kai, 2026-11-02: "a general height based fog", with sliders for its density, range and
// falloff; then patchy across the globe, with sliders): a haze filling the valleys at its full density up to its
// range (a height over the radius), thinning away above it by e every falloff meters, denser in some places than
// others by a broad noise over the globe (its patches). Its amount along a view ray is worked out exactly over its
// heights, from the camera's height to the point's (so a valley seen from a hill is hazed by all the fog it holds, a
// hilltop seen from orbit hardly at all), its patches' at the point and half way to it. Its colour the sky's haze, a
// little paler, so the far land fades toward the sky behind it; tinted toward a blue or a green as light (Kai: "make
// fog slightly green / blue tinted", by sliders: how much, and which). Thinner away from the spiky mountains and near
// the camera's place on the planet (Kai: "reduce density the further away from spiky mountains" and "when near the
// position of camera on planet surface", "on a 2D map": by how far a place lies from the nearest tower, on the map
// fogPeaks.ts makes once a build, and from the camera's place, along the planet), each by sliders: how much, within
// what range, and how gradually.
// Requires: the palette (toon, terraces_common), noise, uRadius.
uniform vec4 uHeightFog; // its density (1/m), its range and its falloff (m: the height it fills to, over the radius; how far above that it thins by e), the camera's height (m over the radius)
uniform vec4 uHeightFogPatches; // how patchy it is (0 … 1), its patches' size (m), -, -
uniform vec3 uHeightFogEye;     // the camera's sub-point (planet direction)
uniform vec2 uHeightFogTint;    // how tinted (0 … 1), and toward which (0: the blue, 1: the green)
uniform sampler2D uHeightFogPeaks; // how far the nearest spiky mountain is (m, along the planet): a raster a cube face, the six stacked
uniform vec3 uHeightFogPeak;    // how much it thins away from them (0 … 1), how far from one it is whole (m), how far past that it thins by e (m)
uniform vec3 uHeightFogNear;    // how much it thins near the camera (0 … 1), how far from the camera's place it is thinned (m), how far past that it comes back by e (m)

// How dense the fog is over a direction (× its density): by its patches (1 where it is even; 0 … about 2 where it is
// patchy: two octaves of noise, the patches' size and a third of it), thinner away from the spiky mountains and near
// the camera's place.
float heightFogLocal(vec3 d) {
  vec3 q = d * (uRadius / max(uHeightFogPatches.y, 1.0));
  float n = 0.7 * gnoise(q + 31.7, 7711u) + 0.3 * gnoise(q * 2.9 + 3.3, 7712u);
  float patches = max(1.0 + uHeightFogPatches.x * 2.2 * n, 0.0);
  float fromPeak = textureLod(uHeightFogPeaks, faceAtlas(d, float(textureSize(uHeightFogPeaks, 0).x)), 0.0).r;
  float peaks = 1.0 - uHeightFogPeak.x * (1.0 - exp(-max(fromPeak - uHeightFogPeak.y, 0.0) / uHeightFogPeak.z));
  float fromEye = uRadius * acos(clamp(dot(d, uHeightFogEye), -1.0, 1.0));
  float near = 1.0 - uHeightFogNear.x * exp(-max(fromEye - uHeightFogNear.y, 0.0) / uHeightFogNear.z);
  return patches * peaks * near;
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
  // (as dense across the globe as it is at the point and half way to it, on the whole)
  float local = 0.5 * (heightFogLocal(d) + heightFogLocal(normalize(d + 0.999 * uHeightFogEye)));
  return 1.0 - exp(-uHeightFog.x * local * dist * mean);
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
