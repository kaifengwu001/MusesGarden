// The paddies as the paddy lab paints them (src/dev/paddyLab/), the built
// paddies' paint and the blades': each paddy one colour, its look by its stage
// (the lab's LOOKS, measured from Kai's aerial), lit as the lab lights them.
// Requires: meadow_toon, terraces_common.

// A paddy's look by its place in the season (maturity, 0 flooded … 1 ripe; variant, 0..1 its own): flooded, the
// sky's white with a touch of lilac (one in five shallow, a greyer white), then just planted (lime), growing,
// grown, grown deep. At the season's default front the paddies share the looks as the lab's do (build/construct.ts
// LOOK_SHARE).
vec3 paddyLook(float maturity, float variant) {
  vec3 c = mix(pal(TR_RICE, 0), pal(TR_RICE, 1), step(variant, 0.18));
  c = mix(c, pal(TR_RICE, 2), smoothstep(0.0, 0.02, maturity));
  c = mix(c, pal(TR_RICE, 3), smoothstep(0.29, 0.31, maturity));
  c = mix(c, pal(TR_RICE, 4), smoothstep(0.64, 0.66, maturity));
  return mix(c, pal(TR_RICE, 5), smoothstep(0.985, 0.995, maturity));
}

// How much of a paddy's floor shows its water, by its look (Kai: "white is full water, dark green is very dense
// grass, and everything in between"): all of it flooded, under half just planted, a fifth growing, a little grown,
// none grown deep; its stages changing where paddyLook's do. The rest is its crop.
float paddyWater(float maturity) {
  float w = mix(1.0, 0.45, smoothstep(0.0, 0.02, maturity));
  w = mix(w, 0.2, smoothstep(0.29, 0.31, maturity));
  w = mix(w, 0.06, smoothstep(0.64, 0.66, maturity));
  return mix(w, 0.0, smoothstep(0.985, 0.995, maturity));
}

// The lab's light (src/dev/paddyLab/lab.ts), as three.js lights a matt surface of colour albedo with normal n where
// up is up: the sky's hemisphere (its sky above, its ground's bounce below; 1.6) and the sun (2.2), Lambert, over π.
// Their colours the lab's, in linear light; the time of day tints them as it does the rest of the planet.
const vec3 LAB_SKY = vec3(0.7484, 0.8276, 0.9551) * 1.6;
const vec3 LAB_GROUND = vec3(0.1473, 0.1706, 0.0835) * 1.6;
const vec3 LAB_SUN = vec3(1.0, 0.9114, 0.7874) * 2.2;

// shade: a passing cloud's shadow there (0 … 1): the sun's share dimmed under it, the light a little cooler.
vec3 labLight(vec3 albedo, vec3 n, vec3 up, float shade) {
  vec3 sky = mix(LAB_GROUND, LAB_SKY, 0.5 + 0.5 * dot(n, up)) * uShadeTint;
  vec3 sun = LAB_SUN * max(dot(n, uSunDir), 0.0) * uSunTint * (1.0 - 0.85 * shade);
  return albedo * (sky * mix(vec3(1.0), vec3(0.9, 0.96, 1.04), shade) + sun) * 0.31830989;
}

vec3 labLight(vec3 albedo, vec3 n, vec3 up) {
  return labLight(albedo, n, up, 0.0);
}
