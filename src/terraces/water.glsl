// The paddies' water: a still mirror over a shallow, muddy body, as the
// lakes are painted on the meadow (planet/water.glsl): the sky it mirrors,
// pale toward the horizon, a little of each paddy's own (teal in some, milky
// white in others); looking down into a paddy you see more of its muddy
// body, looking across it more of the mirror. Gusts ruffle it a little.
// Requires: toon, terraces_common.

uniform vec4 uPaddyWater; // reflection strength, -, -, time (s)

// The open sky as the paddies show it, by the mirrored ray's elevation (0 horizon … 1 zenith).
vec3 paddySky(float e) {
  return mix(pal(TR_WATER, 0), pal(TR_WATER, 1), smoothstep(0.02, 0.6, e));
}

// dir: planet direction of the water; n, v: its normal and the direction to the eye (view space); b: toon light;
// gust: the wind on the water (0..1); tint: this paddy's own water (0 teal … 1 white).
vec3 paddyWater(vec3 dir, vec3 n, vec3 v, float b, float gust, float tint) {
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec3 body = mix(pal(TR_WATER, 2), pal(TR_WATER, 3), 0.45);
  vec3 along = windDir(dir);
  vec3 r = reflect(-v, n);
  r = normalize(r + along * (gust - 0.4) * 0.025 * uWindVec.w);
  vec3 mirror = paddySky(dot(r, n));
  mirror = mix(mirror, mix(pal(TR_WATER, 7), pal(TR_WATER, 8), tint), 0.22);
  // shallow water over mud under a bright sky: a mirror even looking down into it (the paintings lay the
  // flooded fields near white)
  float reflectance = mix(0.74, 0.97, pow(1.0 - facing, 1.5)) * (1.0 - 0.15 * gust) * uPaddyWater.x;
  vec3 col = mix(body * mix(0.75, 1.0, b), mirror, reflectance);
  // the wind's ruffles: faint pale streaks
  col = mix(col, pal(TR_WATER, 6), smoothstep(0.55, 0.95, gust) * 0.12 * uWindVec.w);
  return col;
}
