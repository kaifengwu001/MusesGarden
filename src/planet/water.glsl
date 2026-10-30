// Painted water as a mirror (天光云影共徘徊). Along the view ray mirrored off
// the surface, three things can show, nearest first:
//   the banks   the meadow's edge and the ground behind it, marched over the
//               terrain (with its bank lip and its grass). This is the dark
//               band under every shore: as tall as the bank and the meadow
//               behind it, so it widens and narrows along the shore
//   the clouds  the same puffs the sky shows, drawn from the mirrored camera
//               (cloudsInMirror, clouds.glsl)
//   the sky     painted as the deep cobalt of the lakes, paler toward the horizon
// Looking down into the water you see more of its navy body, looking across
// it more of the mirror. Gusts ruffle the mirror into streaks; a few glints
// swell and fade (never pop); clicks ripple. No refraction.
// Requires: toon, meadow (windDir, patternOctaves), terrain (height0, uBank),
// warp (unwarpPosition), clouds (cloudsInMirror), uResolution.

#define MAX_RIPPLES 6
uniform vec4 uWaterLook;             // -, depth tint, glints, time (s)
uniform vec4 uWaterSky;              // reflection strength, lily pads, grass height in the mirror (m), highest meadow (m)
uniform vec4 uRipples[MAX_RIPPLES];  // centre direction, start time (s); w < 0 = unused

float rippleRing(vec3 dir) {
  float acc = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = uRipples[i];
    if (r.w < 0.0) continue;
    float age = uWaterLook.w - r.w;
    if (age < 0.0 || age > 4.0) continue;
    float d = chordAngle(dir, r.xyz) * uRadius;
    float ring = d - age * 1.6;
    float wave = exp(-ring * ring / 0.02) + 0.6 * exp(-(ring + 0.5) * (ring + 0.5) / 0.02);
    acc += wave * (1.0 - age / 4.0) * smoothstep(0.0, 0.3, age);
  }
  return acc;
}

// The open sky as the lakes paint it, by the mirrored ray's elevation (0 horizon … 1 zenith).
vec3 waterSky(float e) {
  vec3 c = mix(pal(ROW_WATER, 4), pal(ROW_WATER, 0), smoothstep(0.0, 0.35, e));
  return mix(c, pal(ROW_WATER, 5), smoothstep(0.35, 0.9, e));
}

// Height of the meadow's top at a direction for the mirror: ground, plus the
// bank lip and the grass wherever it is land (rising over the first few cm).
float bankTop(vec3 d) {
  float h = height0(d);
  return h + (uBank.x + uWaterSky.z) * smoothstep(0.0, 0.06, h);
}

// The meadow along a mirrored ray (view space), from the water outward: the
// direction it meets the meadow and how high above the water (m), or w < 0.
// shore: distance to the nearest shore (m): no land is nearer, so the march
// starts most of the way there, and is skipped when the ray will have
// climbed above the highest meadow by the time it gets there.
vec4 bankAlong(vec3 wp, vec3 r, float shore, float rise) {
  float t = 0.7 * shore;
  if (t * rise > uWaterSky.w) return vec4(0.0, 0.0, 0.0, -1.0);
  float dt = 0.08 + 0.05 * t;
  float lo = 0.0;
  for (int i = 0; i < 13; i++) {
    float tn = t + dt;
    vec3 q = unwarpPosition(wp + r * tn);
    float len = length(q);
    if (len - uRadius > uWaterSky.w) break; // above anything the meadow reaches
    if (len - uRadius < bankTop(q / len)) {
      // refine the crossing between t and tn
      lo = t;
      float hi = tn;
      for (int k = 0; k < 3; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 m = unwarpPosition(wp + r * mid);
        float ml = length(m);
        if (ml - uRadius < bankTop(m / ml)) hi = mid;
        else lo = mid;
      }
      vec3 hit = unwarpPosition(wp + r * hi);
      float hl = length(hit);
      return vec4(hit / hl, hl - uRadius);
    }
    t = tn;
    dt *= 1.4;
  }
  return vec4(0.0, 0.0, 0.0, -1.0);
}

// The meadow seen in the water: the bank's face and the grass above it,
// mostly the shaded undersides, deeper toward the water line.
vec3 bankColour(vec3 d, float y) {
  float lush = textureLod(uTerrainBake, d, 0.0).g;
  vec3 face = mix(pal(ROW_GRASS, 5), pal(ROW_WATER, 8), 0.45);
  vec3 grass = mix(pal(ROW_GRASS, 2), pal(ROW_GRASS, 1), 0.3 + 0.2 * lush);
  return mix(face, grass, smoothstep(uBank.x * 0.5, uBank.x + uWaterSky.z, y) * 0.75);
}

// One octave of glints: a third of the lattice cells hold a short dash along
// the wind that swells and fades on its own slow sine.
float glintOctave(vec3 dir, float freq, vec3 along, uint seed) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  float k = float((h >> 24) & 255u) / 255.0;
  if (k > 0.33) return 0.0;
  vec3 j = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 d = p - (cell + 0.3 + 0.4 * j);
  float a = dot(d, along);
  float r = length(vec2(a * 0.38, length(d - along * a)));
  float life = 0.5 + 0.5 * sin(uWaterLook.w * (0.9 + 1.4 * j.y) + k * 40.0 + j.x * 6.2831853);
  return life * life * life * smoothstep(0.13, 0.04, r);
}

// Lily pads: round leaves with a notch, floating in calm shallow water.
float lilyPad(vec3 dir, float freq, uint seed, out float shade) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  float k = float((h >> 24) & 255u) / 255.0;
  shade = float((h >> 4) & 255u) / 255.0;
  if (k > 0.22) return 0.0;
  vec3 j = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 d = p - (cell + 0.3 + 0.4 * j);
  float r = length(d);
  float notch = smoothstep(0.96, 0.99, dot(d / max(r, 1e-5), normalize(j - 0.5 + 1e-3)));
  return smoothstep(0.17, 0.13, r) * (1.0 - notch);
}

// dir: planet direction; wp: the surface point in view space; shore: signed
// distance to the shore (m, negative here); depth: m; b: toon light; cloud:
// cloud shadow 0..1; gust: wind on the water 0..1; stroke: brushstroke noise
// along the wind (meadow strokeAt), here the ruffles; n, v: normal and
// direction to the eye (view space).
vec3 waterColour(vec3 dir, vec3 wp, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  vec3 along = windDir(dir);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  // the body: navy looking down into it, a touch lighter over the shallows
  vec3 body = mix(pal(ROW_WATER, 1), pal(ROW_WATER, 5), smoothstep(0.5, 0.05, depth) * 0.3 * uWaterLook.y);

  // the mirror, ruffled along the wind where it gusts
  vec3 r0 = reflect(-v, n);
  vec3 r = normalize(r0 + along * stroke * 0.06 * (0.2 + gust) * uWindVec.w);
  float rise = dot(r, n);
  vec3 mirror = waterSky(rise);
  vec4 bank = bankAlong(wp, r, -shore, rise / sqrt(max(1.0 - rise * rise, 1e-4)));
  vec4 cl = vec4(0.0);
  if (bank.w >= 0.0) mirror = bankColour(bank.xyz, bank.w);
  else cl = cloudsInMirror(wp, r, r0, gl_FragCoord.xy / uResolution);
  float reflectance = mix(0.45, 0.95, pow(1.0 - facing, 1.6)) * (1.0 - 0.25 * gust) * uWaterSky.x;
  vec3 col = mix(body, mirror, reflectance);
  // banks stay dark and clouds stay bright in the mirror even looking down into the water
  if (bank.w >= 0.0) col = mix(col, mirror, 0.5 * uWaterSky.x);
  col = mix(col, cl.rgb / max(cl.a, 1e-3) * vec3(0.92, 0.96, 1.0), cl.a * 0.9 * uWaterSky.x);

  // wind ruffles: pale streaks along the wind, stronger in the gusts
  col = mix(col, pal(ROW_WATER, 9), smoothstep(0.3, 0.85, stroke) * (0.04 + 0.22 * gust) * uWindVec.w);

  // lily pads in calm shallows near the shore (when there are any)
  float pad = 0.0;
  if (uWaterSky.y > 0.0) {
    float shade;
    pad = lilyPad(dir, uRadius / 0.9, uTerrainSeed + 140u, shade) * smoothstep(0.08, 0.2, depth) * smoothstep(0.9, 0.5, depth)
        * smoothstep(-6.0, -1.0, shore) * uWaterSky.y * smoothstep(0.25, 0.05, pixelMeters);
    col = mix(col, tone3(pal(ROW_WATER, 6), mix(pal(ROW_WATER, 6), pal(ROW_WATER, 7), 0.5), pal(ROW_WATER, 7), b * (0.85 + 0.3 * shade)), pad);
  }

  // glints: small dashes catching the sun, never smaller than a couple of pixels
  float f0, f1;
  uint lv;
  float t = patternOctaves(0.7, pixelMeters, 9.0, f0, f1, lv);
  float glint = mix(glintOctave(dir, f0, along, uTerrainSeed + 130u + lv), glintOctave(dir, f1, along, uTerrainSeed + 131u + lv), t);
  vec3 hv = normalize(uSunDir + v);
  float toward = pow(clamp(dot(n, hv), 0.0, 1.0), 20.0);
  col += pal(ROW_WATER, 3) * glint * (0.25 + 1.6 * toward) * (0.4 + 0.6 * gust) * uWaterLook.z * (1.0 - cloud) * (1.0 - pad) * step(bank.w, 0.0);

  // clicks ripple out
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.5);
  // passing cloud shadows dim what you see into the water
  col *= 1.0 - 0.18 * cloud * (1.0 - reflectance);
  return col;
}
