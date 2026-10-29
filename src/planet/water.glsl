// Painted water: clear teal shallows deepening to ultramarine, a dark band
// under the banks, the sky and the passing clouds mirrored in it (天光云影共徘徊),
// wind ruffles that break the mirror into streaks, glints that swell and fade
// smoothly (never pop), sparse lily pads in the calm shallows, and click
// ripples. No refraction.
// Requires: toon, meadow (windDir, strokes, patternOctaves), clouds (cloudSeen).

#define MAX_RIPPLES 6
uniform vec4 uWaterLook;             // dark band under the banks (m), depth tint, glints, time (s)
uniform vec4 uWaterSky;              // reflection strength, lily pads, -, -
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

// Sky colour along a ray at elevation e (0 horizon … 1 zenith).
vec3 skyAlong(float e) {
  return mix(pal(ROW_SKY, 1), pal(ROW_SKY, 0), pow(clamp(e, 0.0, 1.0), 0.62));
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

// shore: signed distance to the shore (m, negative here); depth: m; b: toon
// light; cloud: cloud shadow 0..1; gust: wind on the water 0..1; stroke: the
// brushstroke noise along the wind (meadow strokeAt), here the ruffles.
vec3 waterColour(vec3 dir, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  vec3 along = windDir(dir);
  // body: shallows → depths, and a dark band under the banks
  float dt = smoothstep(0.05, 1.3, depth) * (0.35 + 0.65 * uWaterLook.y);
  vec3 body = mix(pal(ROW_WATER, 0), pal(ROW_WATER, 1), dt);
  float under = 1.0 - smoothstep(0.0, max(uWaterLook.x, 0.01), -shore);
  body = mix(body, pal(ROW_WATER, 8), under * 0.7);

  // the mirror: sky and clouds along the reflected ray (n: the water's normal as you see it)
  vec3 up = n;
  vec3 r = reflect(-v, up);
  vec3 sky = skyAlong(dot(r, up));
  float c = cloudSeen(dir * uRadius, r);
  vec3 mirror = mix(sky, mix(pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 0), 0.6), c * 0.92);
  float fresnel = 0.08 + 0.92 * pow(1.0 - clamp(dot(up, v), 0.0, 1.0), 4.0);
  float calm = 1.0 - 0.5 * gust;
  float reflect_ = clamp((fresnel + 0.22 * c) * calm * uWaterSky.x, 0.0, 1.0);
  vec3 col = mix(body, mirror, reflect_ * (1.0 - under * 0.6));

  // wind ruffles: pale streaks along the wind, stronger in the gusts
  col = mix(col, pal(ROW_WATER, 9), smoothstep(0.25, 0.8, stroke) * (0.12 + 0.4 * gust) * (1.0 - under));

  // lily pads in calm shallows near the shore
  float shade;
  float pad = lilyPad(dir, uRadius / 0.9, uTerrainSeed + 140u, shade) * smoothstep(0.08, 0.2, depth) * smoothstep(0.9, 0.5, depth)
            * smoothstep(-6.0, -1.0, shore) * uWaterSky.y * smoothstep(0.25, 0.05, pixelMeters);
  col = mix(col, tone3(pal(ROW_WATER, 6), mix(pal(ROW_WATER, 6), pal(ROW_WATER, 7), 0.5), pal(ROW_WATER, 7), b * (0.85 + 0.3 * shade)), pad);

  // glints: dashes catching the sun, never smaller than a couple of pixels
  float f0, f1;
  uint lv;
  float t = patternOctaves(0.7, pixelMeters, 9.0, f0, f1, lv);
  float glint = mix(glintOctave(dir, f0, along, uTerrainSeed + 130u + lv), glintOctave(dir, f1, along, uTerrainSeed + 131u + lv), t);
  vec3 hv = normalize(uSunDir + v);
  float toward = pow(clamp(dot(n, hv), 0.0, 1.0), 20.0);
  col += pal(ROW_WATER, 3) * glint * (0.3 + 1.8 * toward) * (0.4 + 0.6 * gust) * uWaterLook.z * (1.0 - cloud) * (1.0 - pad) * (1.0 - under);

  // clicks ripple out
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.5);
  // passing cloud shadows dim the water a little
  col *= 1.0 - 0.22 * cloud;
  return col;
}
