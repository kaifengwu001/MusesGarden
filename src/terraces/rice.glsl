// The crop's colour lit by b (the paint's and the blades'): by its stage
// (seedlings a pale yellow-green, then fresh, then deep green, heading out
// yellow-green at the tips, a few turning gold), each paddy its own shade of
// green, slightly: lighter or darker, toward jade, lime or blue-green; the
// taller and denser, the deeper its shade.
// Requires: meadow_toon, terraces_common, terraces_paddy.

vec3 riceLit(float maturity, float variant) {
  float m = maturity;
  vec3 lit = mix(pal(TR_RICE, 0), pal(TR_RICE, 1), smoothstep(0.1, 0.45, m));
  lit = mix(lit, pal(TR_RICE, 2), smoothstep(0.45, 0.85, m));
  lit = mix(lit, pal(TR_RICE, 3), smoothstep(0.86, 1.0, m) * smoothstep(0.35, 0.9, variant) * 0.7);
  lit = mix(lit, pal(TR_RICE, 4), smoothstep(0.93, 1.0, m) * smoothstep(0.85, 0.97, variant));
  float v2 = fract(variant * 7.13);
  float v3 = fract(variant * 3.71);
  lit = mix(lit, pal(TR_RICE, 9), 0.28 * smoothstep(0.5, 0.95, v2));
  lit = mix(lit, pal(TR_RICE, 11), 0.26 * smoothstep(0.45, 0.05, v2));
  lit = mix(lit, pal(TR_RICE, 12), 0.24 * smoothstep(0.62, 0.95, v3));
  return lit * (0.86 + 0.26 * fract(variant * 5.17));
}

vec3 riceShade(vec3 lit) {
  return mix(pal(TR_RICE, 6), lit * 0.45, 0.35);
}

vec3 riceColour(Crop c, float b) {
  vec3 lit = riceLit(c.maturity, c.variant);
  vec3 shade = riceShade(lit);
  return tone3(lit, mix(lit, shade, 0.35 + 0.25 * smoothstep(0.3, 0.9, c.height)), shade, b);
}
