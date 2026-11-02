// The terraces' height fog (Kai, 2026-11-02: "a general height based fog"): a haze denser the lower it lies, settled
// in the valleys and thinning up the hills, its density falling off exponentially with height over the radius. Its
// amount along a view ray is worked out exactly, from the camera's height to the point's (so a valley seen from a
// hill is hazed through all the fog it holds, a hilltop seen from orbit hardly at all). Its colour the sky's haze, a
// little paler, so the far land fades toward the sky behind it.
// Requires: the palette (toon).
uniform vec4 uHeightFog; // its density at its base (1/m), its base's height and its scale height (m over the radius), the camera's height (m over the radius)

// How much of the fog lies between the camera and a point dist m away at height h (m over the radius): 0 … 1.
float heightFogAmount(float dist, float h) {
  float h0 = uHeightFog.y;
  float H = uHeightFog.z;
  float hc = max(uHeightFog.w, h0 - 2.0 * H);
  float hp = max(h, h0 - 2.0 * H);
  float ec = exp(-(hc - h0) / H);
  float ep = exp(-(hp - h0) / H);
  float dh = hp - hc;
  // (the density's mean along the ray, its exact integral over the heights it passes)
  float mean = abs(dh) > 0.05 ? H * (ec - ep) / dh : 0.5 * (ec + ep);
  return 1.0 - exp(-uHeightFog.x * dist * mean);
}

vec3 heightFogColour() {
  return mix(pal(ROW_SKY, 2), pal(ROW_SKY, 3), 0.25);
}

vec3 applyHeightFog(vec3 col, float dist, float h) {
  return mix(col, heightFogColour(), heightFogAmount(dist, h));
}
