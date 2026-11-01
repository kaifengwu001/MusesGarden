// The paddies' water: a still mirror over a shallow, muddy body, as the
// lakes are painted on the meadow (planet/water.glsl). Along the view ray
// mirrored off the water, nearest first: the terraced ground (marched, each
// step unwarped back to the planet: the riser behind a paddy as a dark band,
// the hills across the valley, the peaks), and past it the sky, pale and
// misty; the valley fog lies over whatever the mirror shows. Looking down
// into a paddy you see more of its muddy body, looking across it more of
// the mirror. Gusts ruffle it a little.
// Requires: toon, warp, terraces_common, terraces_ground, terraces_fog.

uniform vec4 uPaddyWater; // reflection strength, the march's highest ground (m), -, time (s)

// The open sky as the paddies show it, by the mirrored ray's elevation (0 horizon … 1 zenith).
vec3 paddySky(float e) {
  return mix(pal(TR_WATER, 0), pal(TR_WATER, 1), smoothstep(0.02, 0.6, e));
}

// The ground along a mirrored ray (view space) from the water at wp: how far
// along it the ray meets the ground (1e9: never), as far as the riser and
// the bund round the paddy (the painting keeps its flooded fields white, a
// darker band only along their inner edge: the riser behind, mirrored).
float groundAlong(vec3 wp, vec3 r, float rise) {
  float t = 0.12;
  float dt = 0.2;
  for (int i = 0; i < 12; i++) {
    float tn = t + dt;
    vec3 q = unwarpPosition(wp + r * tn);
    float len = length(q);
    float above = len - uRadius;
    if (above > uPaddyWater.y) break;
    if (above < terraceHeight(q / len)) {
      float lo = t;
      float hi = tn;
      for (int k = 0; k < 4; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 m = unwarpPosition(wp + r * mid);
        float ml = length(m);
        if (ml - uRadius < terraceHeight(m / ml)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    t = tn;
    dt *= 1.33;
  }
  return 1e9;
}

// What the mirror shows of the ground at q (planet space): broad strokes, a
// little darker than in the air; the riser right behind a paddy reads as its
// dark band.
vec3 mirroredGround(vec3 q) {
  float l = length(q);
  vec3 d = q / l;
  Terrace t = terraceAt(d);
  vec3 wild = mix(pal(TR_FOREST, 1), pal(TR_PEAK, 0), smoothstep(1.1, 1.8, t.slope));
  vec3 tame = mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), t.rise);
  vec3 c = mix(tame, wild, t.wild);
  return mix(c, pal(TR_WATER, 5), 0.3) * 0.9;
}

// dir: planet direction of the water; wp: the water's point in view space;
// n, v: its normal and the direction to the eye (view space); b: toon light;
// gust: the wind on the water (0..1); tint: this paddy's own water (0 teal … 1 white).
vec3 paddyWater(vec3 dir, vec3 wp, vec3 n, vec3 v, float b, float gust, float tint) {
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec3 body = mix(pal(TR_WATER, 2), pal(TR_WATER, 3), 0.45);
  vec3 along = windDir(dir);
  vec3 r = reflect(-v, n);
  r = normalize(r + along * (gust - 0.4) * 0.025 * uWindVec.w);
  float rise = dot(r, n);
  vec3 mirror = paddySky(rise);
  // a little of the paddies' own: teal in some, milky white in others (reference 5)
  mirror = mix(mirror, mix(pal(TR_WATER, 7), pal(TR_WATER, 8), tint), 0.22);
  float tHit = groundAlong(wp, r, rise);
  vec3 q0 = unwarpPosition(wp);
  vec3 far;
  if (tHit < 1e8) {
    far = unwarpPosition(wp + r * tHit);
    mirror = mirroredGround(far);
  } else {
    // the sky past the fog's top
    far = q0 + normalize(unwarpPosition(wp + r) - q0) * (uValleyFog.w * 3.0 + 40.0);
  }
  // the valley fog along the mirrored ray, as it lies over what the mirror shows
  float fog = valleyFog(q0, far);
  mirror = mix(mirror, fogColour(length(far) - uRadius), fog);
  // shallow water over mud under a bright sky: a mirror even looking down into it (the paintings lay the
  // flooded fields near white)
  float reflectance = mix(0.74, 0.97, pow(1.0 - facing, 1.5)) * (1.0 - 0.15 * gust) * uPaddyWater.x;
  vec3 col = mix(body * mix(0.75, 1.0, b), mirror, reflectance);
  // the wind's ruffles: faint pale streaks
  col = mix(col, pal(TR_WATER, 6), smoothstep(0.55, 0.95, gust) * 0.12 * uWindVec.w);
  return col;
}
