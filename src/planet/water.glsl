// Painted water as a mirror (天光云影共徘徊). Along the view ray mirrored off
// the surface, three things can show, nearest first:
//   the banks   the meadow's edge and the ground behind it, marched over the
//               terrain (with its bank lip and its grass). This is the dark
//               navy band under every shore: as tall as the bank and the
//               meadow behind it, so it widens and narrows along the shore
//   the cottage its terrace, pier, walls, roof and chimney as plain solids
//               (homeSegment), painted in a few broad strokes (homeColour);
//               stepped along the same ray as the banks (homeAlong after
//               bankAlong), so whichever is nearer shows
//   the clouds  the same puffs the sky shows, drawn from the mirrored camera
//               (cloudsInMirror, clouds.glsl); from orbit, the cloud cover
//               seen from below (cloudsFromOrbit)
//   the sky     painted as the deep cobalt of the lakes, paler toward the horizon
// Looking down into the water you see more of its navy body, looking across
// it more of the mirror. Gusts ruffle the mirror into streaks; a few glints
// swell and fade (never pop); clicks ripple. No refraction.
// Requires: toon, meadow (windDir, patternOctaves), terrain (height0, uBank,
// uCottage), warp (unwarpPosition), clouds (cloudsInMirror, localSun), uResolution.

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

// The meadow seen in the water: the bank's face and the grass above it,
// mostly the shaded undersides, taking on the lake's own deep blue and
// darker than in the air (as the paintings lay a dark navy band under every
// bank).
vec3 bankColour(vec3 d, float y) {
  float lush = textureLod(uTerrainBake, d, 0.0).g;
  vec3 face = mix(pal(ROW_GRASS, 5), pal(ROW_WATER, 8), 0.45);
  vec3 grass = mix(pal(ROW_GRASS, 2), pal(ROW_GRASS, 1), 0.3 + 0.2 * lush);
  vec3 c = mix(face, grass, smoothstep(uBank.x * 0.5, uBank.x + uWaterSky.z, y) * 0.6);
  return mix(c, pal(ROW_WATER, 1), 0.45) * 0.62;
}

// The homestead's stand-ins for the mirror (props.ts COTTAGE, ROOF, TERRACE,
// STEPS, PIER, ARCH, CHIMNEY), in its local meters as the bent cottage
// stands (props.vert.glsl): x and z from cottageLocal(), y the height above
// its clearing. Ids: 1 the terrace, the steps and the pier (the tunnel's
// mouth a dark face: from under the water its inside is only dark), 2 the
// walls, 3 the roof, 4 the chimney.
const float HOME_TOP = 7.1; // the chimney's cap above the clearing (m)

// A point (planet space) in the homestead's local meters (the inverse of the
// bend in props.vert.glsl).
vec3 homeLocal(vec3 q) {
  float l = length(q);
  vec2 c = cottageLocal(q / l);
  return vec3(c.x, l - (uRadius + uCottage.w + uBank.x), c.y);
}

// 1 in the water under the pier, inside the tunnel, where it lies in the dark
// (and near the cottage's level: its frame folds the far side of the planet onto it).
float underPier(vec3 c) {
  return step(-8.2, c.x) * step(c.x, -3.4) * step(1.83, c.z) * step(c.z, 5.63) * step(abs(c.y), 6.0);
}

// Where a mirrored ray (view space) is inside the homestead's bounding
// sphere: from x to y along it (x = 1e9: never); most rays never come near.
vec2 homeSpan(vec3 wp, vec3 r) {
  vec3 U = uCottage.xyz;
  vec3 Z = uCottageB.xyz;
  vec3 c = normalize(U * uRadius - cross(U, Z) * 2.0 + Z * 1.5) * (uRadius + uCottage.w + uBank.x + 2.5);
  vec3 o = wp - warpPosition(c);
  float rad = 10.5 + abs(uWarpK) * (2.0 * length(warpTangent(c)) * 10.5 + 110.0);
  float b = dot(o, r);
  float disc = b * b - dot(o, o) + rad * rad;
  if (disc < 0.0) return vec2(1e9);
  float s = sqrt(disc);
  return -b + s < 0.0 ? vec2(1e9) : vec2(max(-b - s, 0.0), -b + s);
}

// Where a segment a → a + d first enters a box (lo, hi): its fraction along
// the segment (0 when a is inside; 2 when it misses), and the face's normal.
float segmentBox(vec3 a, vec3 d, vec3 lo, vec3 hi, out vec3 n) {
  vec3 dd = d + vec3(1e-7) * (1.0 - step(1e-7, abs(d)));
  vec3 t0 = (lo - a) / dd;
  vec3 t1 = (hi - a) / dd;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float near = max(max(tn.x, tn.y), tn.z);
  float far = min(min(tf.x, tf.y), tf.z);
  n = near == tn.x ? vec3(-sign(dd.x), 0.0, 0.0) : near == tn.y ? vec3(0.0, -sign(dd.y), 0.0) : vec3(0.0, 0.0, -sign(dd.z));
  if (near > far || far < 0.0 || near > 1.0) return 2.0;
  return max(near, 0.0);
}

// Clip the part [s0, s1] of a segment to where p + s q > 0 (one face of a convex solid; m: the face's normal).
void clipHalf(float p, float q, vec3 m, inout float s0, inout float s1, inout vec3 n) {
  if (abs(q) < 1e-7) {
    if (p <= 0.0) s1 = -1.0;
    return;
  }
  float s = -p / q;
  if (q > 0.0) {
    if (s > s0) {
      s0 = s;
      n = m;
    }
  } else {
    s1 = min(s1, s);
  }
}

// The first of the homestead's stand-ins a segment a → a + d (local meters)
// enters: x its fraction along the segment (2: none), y which (the ids
// above); n the face's normal. Exact, so no step of the march can pass
// through an edge of the cottage between its samples.
vec2 homeSegment(vec3 a, vec3 d, out vec3 n) {
  vec2 best = vec2(2.0, 0.0);
  vec3 m;
  // most steps pass nowhere near the house: one box round all of it first
  vec3 lo = min(a, a + d);
  vec3 hi = max(a, a + d);
  if (any(lessThan(hi, vec3(-8.2, -3.0, -3.08))) || any(greaterThan(lo, vec3(4.75, HOME_TOP, 5.72)))) return best;
  float s = segmentBox(a, d, vec3(-4.4, -3.0, 2.33), vec3(4.1, 0.72, 4.73), m);
  if (s < best.x) { best = vec2(s, 1.0); n = m; }
  s = segmentBox(a, d, vec3(-8.2, -3.0, 1.83), vec3(-3.4, 0.72, 5.63), m);
  if (s < best.x) { best = vec2(s, 1.0); n = m; }
  for (int k = 0; k < 3; k++) {
    float z0 = 4.73 + 0.33 * float(k);
    s = segmentBox(a, d, vec3(2.0, -3.0, z0), vec3(3.8, 0.48 - 0.24 * float(k), z0 + 0.33), m);
    if (s < best.x) { best = vec2(s, 1.0); n = m; }
  }
  s = segmentBox(a, d, vec3(-4.3, -0.7, -2.63), vec3(4.3, 3.45, 2.63), m);
  if (s < best.x) { best = vec2(s, 2.0); n = m; }
  s = segmentBox(a, d, vec3(-0.19, 5.0, -0.89), vec3(0.39, HOME_TOP, -0.31), m);
  if (s < best.x) { best = vec2(s, 4.0); n = m; }
  // the roof: above the eaves and under all four slopes (45°)
  float s0 = 0.0;
  float s1 = 1.0;
  m = vec3(0.0, 1.0, 0.0);
  clipHalf(a.y - 3.12, d.y, vec3(0.0, -1.0, 0.0), s0, s1, m);
  clipHalf(6.2 - a.y - a.z, -d.y - d.z, vec3(0.0, 0.7071, 0.7071), s0, s1, m);
  clipHalf(6.2 - a.y + a.z, -d.y + d.z, vec3(0.0, 0.7071, -0.7071), s0, s1, m);
  clipHalf(7.87 - a.y - a.x, -d.y - d.x, vec3(0.7071, 0.7071, 0.0), s0, s1, m);
  clipHalf(7.87 - a.y + a.x, -d.y + d.x, vec3(-0.7071, 0.7071, 0.0), s0, s1, m);
  if (s0 <= s1 && s0 < best.x) { best = vec2(s0, 3.0); n = m; }
  return best;
}

// The meadow along a mirrored ray (view space), from the water outward: how
// far along the ray it meets the meadow (its ground, bank lip and grass),
// refined, or 1e9. Each step is unwarped back to the planet, so the tiny-
// planet warp and the planet's curve bend the ray as they bend the view.
// shore: distance to the nearest shore (m): no land is nearer, so the march
// starts most of the way there, and is skipped when the ray will have
// climbed above the highest meadow by the time it gets there. rise: the
// ray's climb per meter.
float bankAlong(vec3 wp, vec3 r, float shore, float rise) {
  float t = 0.7 * shore;
  if (t * rise > uWaterSky.w) return 1e9;
  float dt = 0.08 + 0.05 * t;
  for (int i = 0; i < 13; i++) {
    float tn = t + dt;
    vec3 q = unwarpPosition(wp + r * tn);
    float len = length(q);
    if (len - uRadius > uWaterSky.w) break; // above anything the meadow reaches
    if (len - uRadius < bankTop(q / len)) {
      // refine the crossing between t and tn
      float lo = t;
      float hi = tn;
      for (int k = 0; k < 3; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 m = unwarpPosition(wp + r * mid);
        float ml = length(m);
        if (ml - uRadius < bankTop(m / ml)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    t = tn;
    dt *= 1.4;
  }
  return 1e9;
}

// The cottage along the same mirrored ray, before `until` (where the meadow
// was met): stepped through the warped view as the meadow is, and met exactly
// on the straight segment between two steps, so no step passes through an
// edge of it. Only rays that come near it look. Returns how far along the
// ray (1e9: not before `until`) and which stand-in (the ids above); c: the
// point in its local meters, n: the face's normal. With bankAlong this finds
// whichever is nearer: the pier hides the ground under it, a bank in front
// hides the house.
vec2 homeAlong(vec3 wp, vec3 r, float until, out vec3 c, out vec3 n) {
  vec2 span = homeSpan(wp, r);
  float end = min(until, span.y);
  if (span.x >= end) return vec2(1e9, 0.0);
  float t = span.x;
  float dt = 0.05 + 0.05 * t;
  vec3 a = homeLocal(unwarpPosition(wp + r * t));
  for (int i = 0; i < 13; i++) {
    float tn = min(t + dt, end);
    vec3 b = homeLocal(unwarpPosition(wp + r * tn));
    vec3 m;
    vec2 hit = homeSegment(a, b - a, m);
    if (hit.x <= 1.0) {
      c = mix(a, b, hit.x);
      n = m;
      return vec2(mix(t, tn, hit.x), hit.y);
    }
    if (tn >= end) break;
    a = b;
    t = tn;
    // (short enough that the segments follow the ray's curve)
    dt = min(dt * 1.4, 3.0);
  }
  return vec2(1e9, 0.0);
}

// The cottage as the water shows it at a point c (local meters) on one of
// its stand-ins (id s, face normal n): painted in a few broad strokes (cream
// plaster with the eaves' band, the dark door and windows, the pier's arch
// and the dark of its tunnel, the roof striped by its courses and mossy low
// down, damp and moss at the stone's foot), lit by the sun the cottage sees
// and a little darker than in the air.
vec3 homeColour(vec3 c, float s, vec3 n) {
  vec3 col;
  if (s < 1.5) {
    // stone: damp and mossy toward the water
    col = mix(pal(ROW_STONE, 9), pal(ROW_STONE, 6), smoothstep(-0.4, -1.1, c.y) * 0.85);
    vec2 a = (c.xy - vec2(-7.2, -0.78)) / 0.55;
    float ra = length(vec2(a.x, max(a.y, 0.0)));
    if (c.z > 5.58 && ra > 1.0 && ra < 1.3 && a.y > -0.05) col *= 0.86;
    // the tunnel: its mouth, and the water under the pier
    if (c.z > 4.0 && abs(a.x) < 1.0 && (a.y < 0.0 || ra < 1.0)) col = vec3(0.04, 0.07, 0.07);
  } else if (s < 2.5) {
    col = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 10), smoothstep(2.6, 2.95, c.y));
    vec3 pane = mix(pal(ROW_ROOF, 9), pal(ROW_ROOF, 10), 0.45);
    if (n.z > 0.5) {
      if (abs(c.x - 0.85) < 0.55 && c.y > 0.72 && c.y < 2.87) col = mix(pal(ROW_ROOF, 3), pal(ROW_ROOF, 2), 0.4);
      if (abs(c.x + 2.38) < 0.6 && c.y > 1.57 && c.y < 2.87) col = pane;
    }
    if (n.x > 0.5 && abs(c.z + 0.95) < 0.28 && c.y > 2.07 && c.y < 2.77) col = pane;
  } else if (s < 3.5) {
    float up = clamp((c.y - 3.12) / 3.08, 0.0, 1.0);
    float course = fract(up * 14.0);
    vec3 tile = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 7), (1.0 - smoothstep(0.1, 0.6, up)) * 0.6);
    tile *= 1.0 - 0.45 * smoothstep(0.65, 0.9, course);
    col = mix(tile, pal(ROW_ROOF, 14), (1.0 - smoothstep(0.0, 0.14, course)) * 0.5);
    if (n.y < -0.5) col = pal(ROW_ROOF, 13); // the soffit, under the eaves
  } else {
    col = pal(ROW_STONE, 1) * 0.95;
  }
  // lit by the sun the cottage sees
  vec3 U = uCottage.xyz;
  vec3 Z = uCottageB.xyz;
  vec3 sun = localSun(U);
  vec3 sunLocal = vec3(dot(sun, cross(U, Z)), dot(sun, U), dot(sun, Z));
  float light = smoothstep(-0.3, 0.6, dot(n, sunLocal));
  return col * mix(vec3(0.74, 0.76, 0.8), vec3(1.0), light) * 0.88;
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
  // the meadow, then the cottage (if it comes first): what the mirrored ray meets nearest
  float tBank = bankAlong(wp, r, -shore, rise / sqrt(max(1.0 - rise * rise, 1e-4)));
  vec3 hc;
  vec3 hn;
  vec2 home = homeAlong(wp, r, tBank, hc, hn);
  float met = home.x < 1e8 ? 2.0 : tBank < 1e8 ? 1.0 : 0.0;
  vec4 cl = vec4(0.0);
  if (met > 1.5) {
    mirror = homeColour(hc, home.y, hn);
  } else if (met > 0.5) {
    vec3 q = unwarpPosition(wp + r * tBank);
    float ql = length(q);
    mirror = bankColour(q / ql, ql - uRadius);
  } else {
    // the clouds only past the meadow and the cottage: whatever the mirrored
    // ray meets stands in front of every cloud (they float above it all), so
    // the clouds show only where the ray clears the land. From near the
    // ground the mirror pass; from far above the cloud cover; cross-faded on
    // the way
    if (uCloudOrbit.x < 1.0) cl = cloudsInMirror(wp, r, r0, gl_FragCoord.xy / uResolution);
    if (uCloudOrbit.x > 0.0) cl = mix(cl, cloudsFromOrbit(wp, r), uCloudOrbit.x);
  }
  float reflectance = mix(0.45, 0.95, pow(1.0 - facing, 1.6)) * (1.0 - 0.25 * gust) * uWaterSky.x;
  vec3 col = mix(body, mirror, reflectance);
  // banks and the cottage stay solid, and clouds bright, in the mirror even looking down into the water
  if (met > 0.5) col = mix(col, mirror, 0.5 * uWaterSky.x);
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
  col += pal(ROW_WATER, 3) * glint * (0.25 + 1.6 * toward) * (0.4 + 0.6 * gust) * uWaterLook.z * (1.0 - cloud) * (1.0 - pad) * (1.0 - step(0.5, met));

  // clicks ripple out
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.5);
  // in the tunnel under the pier the water lies in the dark, a little light off its mouth
  col *= mix(1.0, 0.3, underPier(homeLocal(unwarpPosition(wp))));
  // passing cloud shadows dim what you see into the water
  col *= 1.0 - 0.18 * cloud * (1.0 - reflectance);
  return col;
}
