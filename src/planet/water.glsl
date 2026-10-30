// Painted water as a mirror (天光云影共徘徊). Along the view ray mirrored off
// the surface, three things can show, nearest first:
//   the banks   the meadow's edge and the ground behind it, marched over the
//               terrain (with its bank lip and its grass). This is the dark
//               band under every shore: as tall as the bank and the meadow
//               behind it, so it widens and narrows along the shore
//   the cottage its landing, walls and roof as plain solids, painted in a
//               few broad strokes (cottageInMirror)
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

// Where a ray (planet space) enters a box (lo, hi); x > y when it misses.
vec2 boxEntry(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out vec3 nrm) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (lo - ro) * inv;
  vec3 t1 = (hi - ro) * inv;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float near = max(max(tn.x, tn.y), tn.z);
  float far = min(min(tf.x, tf.y), tf.z);
  nrm = near == tn.x ? vec3(-sign(rd.x), 0.0, 0.0) : near == tn.y ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z));
  return vec2(near, far);
}

// The cottage seen in the water (props.ts COTTAGE, ROOF, TERRACE, PIER,
// CHIMNEY): the mirrored ray from p (planet space) traced in the cottage's
// own frame against its terrace, its pier, its walls, its chimney and its
// hipped roof (a convex solid: four slopes at 45° above the eaves), and
// painted in a few broad strokes: cream plaster with the eaves' blue band,
// the dark door and windows, the pier's arch, the olive roof striped by its
// courses and mossy low down. Colour, and the distance along the ray (w < 0:
// it misses).
// The cottage's frame (props.ts): a point in planet space to cottage-local meters.
vec3 cottageFrame(vec3 p) {
  vec3 U = uCottage.xyz;
  vec3 Z = uCottageB.xyz;
  vec3 o = p - U * (uRadius + uCottage.w + uBank.x);
  return vec3(dot(o, cross(U, Z)), dot(o, U), dot(o, Z));
}

// 1 under the pier (cottage-local x, z: props.ts PIER), where the tunnel's water lies in the dark
// (and near the cottage's level: the frame folds the far side of the planet onto it).
float underPier(vec3 local) {
  return step(-8.2, local.x) * step(local.x, -3.4) * step(1.83, local.z) * step(local.z, 5.63) * step(abs(local.y), 6.0);
}

vec4 cottageInMirror(vec3 p, vec3 r) {
  vec3 U = uCottage.xyz;
  vec3 Z = uCottageB.xyz;
  vec3 X = cross(U, Z);
  vec3 o = p - U * (uRadius + uCottage.w + uBank.x);
  vec3 ro = vec3(dot(o, X), dot(o, U), dot(o, Z));
  vec3 rd = vec3(dot(r, X), dot(r, U), dot(r, Z));
  // the water under the pier (seen through its arch) mirrors the dark of the tunnel's vault
  if (underPier(ro) > 0.5) return vec4(vec3(0.04, 0.07, 0.07), 0.3);
  // most of the water's rays pass nowhere near it (the house, its terrace and its pier)
  vec3 oc = vec3(-2.0, 1.8, 1.5) - ro;
  float tc = dot(oc, rd);
  if (tc < 0.0 || dot(oc, oc) - tc * tc > 100.0) return vec4(0.0, 0.0, 0.0, -1.0);
  const float TAN = 1.0; // tan 45°
  const vec4 EAVES = vec4(4.75, 3.08, 3.12, 6.2); // half x, half z, eave height, ridge height
  float best = 1e9;
  vec3 col = vec3(0.0);
  vec3 nrm = vec3(0.0);
  vec3 n;
  // the terrace along the front, and the pier with its arch at the waterline; each solid
  // stops at the ground (the pier at the water), so the mirror never shows what is buried
  vec2 t = boxEntry(ro, rd, vec3(-4.4, -0.05, 2.33), vec3(4.1, 0.72, 4.73), n);
  if (t.x < t.y && t.x > 0.0 && t.x < best) {
    best = t.x;
    nrm = n;
    col = mix(pal(ROW_STONE, 9), pal(ROW_STONE, 6), smoothstep(-0.8, -1.1, (ro + rd * t.x).y));
  }
  t = boxEntry(ro, rd, vec3(-8.2, -1.3, 1.83), vec3(-3.4, 0.72, 5.63), n);
  if (t.x < t.y && t.x > 0.0 && t.x < best) {
    best = t.x;
    nrm = n;
    vec3 h = ro + rd * t.x;
    col = mix(pal(ROW_STONE, 9), pal(ROW_STONE, 6), smoothstep(-0.8, -1.1, h.y));
    vec2 q = (h.xy - vec2(-7.2, -0.78)) / vec2(0.55, 0.55);
    if (n.z > 0.5 && abs(q.x) < 1.0 && (q.y < 0.0 || length(q) < 1.0)) col = vec3(0.06, 0.09, 0.09);
  }
  // the walls (the door and the tall window on the front, the small window on the right end)
  t = boxEntry(ro, rd, vec3(-4.3, -0.05, -2.63), vec3(4.3, 3.45, 2.63), n);
  if (t.x < t.y && t.x > 0.0 && t.x < best) {
    best = t.x;
    nrm = n;
    vec3 h = ro + rd * t.x;
    col = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 10), smoothstep(2.75, 2.95, h.y));
    vec3 pane = mix(pal(ROW_ROOF, 9), pal(ROW_ROOF, 10), 0.45);
    if (n.z > 0.5) {
      if (abs(h.x - 0.85) < 0.55 && h.y > 0.72 && h.y < 2.87) col = mix(pal(ROW_ROOF, 3), pal(ROW_ROOF, 2), 0.4);
      if (abs(h.x + 2.38) < 0.6 && h.y > 1.57 && h.y < 2.87) col = pane;
    }
    if (n.x > 0.5 && abs(h.z + 0.95) < 0.28 && h.y > 2.07 && h.y < 2.77) col = pane;
  }
  // the chimney on the ridge
  t = boxEntry(ro, rd, vec3(-0.19, 5.55, -0.29), vec3(0.39, 7.3, 0.29), n);
  if (t.x < t.y && t.x > 0.0 && t.x < best) {
    best = t.x;
    nrm = n;
    col = pal(ROW_STONE, 1) * 0.95;
  }
  // the roof: inside every slope's plane and above the eaves
  vec3 planes[4] = vec3[4](vec3(0.0, 1.0, TAN), vec3(0.0, 1.0, -TAN), vec3(TAN, 1.0, 0.0), vec3(-TAN, 1.0, 0.0));
  float limits[4] = float[4](EAVES.y * TAN + EAVES.z, EAVES.y * TAN + EAVES.z, EAVES.x * TAN + EAVES.z, EAVES.x * TAN + EAVES.z);
  float near = (EAVES.z - ro.y) / rd.y;
  float far = 1e9;
  vec3 nearN = vec3(0.0, -1.0, 0.0);
  if (rd.y < 0.0) {
    far = near;
    near = -1e9;
  }
  for (int i = 0; i < 4; i++) {
    float d = dot(planes[i], rd);
    float num = limits[i] - dot(planes[i], ro);
    if (abs(d) < 1e-6) {
      if (num < 0.0) far = -1e9;
      continue;
    }
    float ti = num / d;
    if (d < 0.0) {
      if (ti > near) {
        near = ti;
        nearN = normalize(planes[i]);
      }
    } else {
      far = min(far, ti);
    }
  }
  if (near < far && near > 0.0 && near < best) {
    best = near;
    nrm = nearN;
    vec3 h = ro + rd * near;
    float up = clamp((h.y - EAVES.z) / (EAVES.w - EAVES.z), 0.0, 1.0);
    float course = fract(up * 14.0);
    vec3 tile = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 6), (1.0 - smoothstep(0.1, 0.55, up)) * 0.75);
    tile *= 1.0 - 0.45 * smoothstep(0.65, 0.9, course);
    col = mix(tile, pal(ROW_ROOF, 14), (1.0 - smoothstep(0.0, 0.14, course)) * 0.6);
  }
  if (best > 1e8) return vec4(0.0, 0.0, 0.0, -1.0);
  // lit by the sun the cottage sees, a little darker in the water
  vec3 sun = localSun(U);
  vec3 sunLocal = vec3(dot(sun, X), dot(sun, U), dot(sun, Z));
  float light = smoothstep(-0.3, 0.6, dot(nrm, sunLocal));
  return vec4(col * mix(vec3(0.74, 0.76, 0.8), vec3(1.0), light) * 0.9, best);
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
  // the cottage stands over its pond: in front of whatever bank is behind it
  vec3 pw = unwarpPosition(wp);
  vec4 house = cottageInMirror(pw, r);
  // the cottage is traced along a straight ray: the meadow along that same ray hides what lies behind it
  if (house.w > 0.0) {
    for (int k = 1; k <= 6; k++) {
      vec3 q = pw + r * (house.w * float(k) / 7.0);
      float ql = length(q);
      if (ql - uRadius < bankTop(q / ql)) {
        house.w = -1.0;
        break;
      }
    }
  }
  if (house.w >= 0.0 && (bank.w < 0.0 || house.w < distance(pw, bank.xyz * (uRadius + bank.w)))) {
    mirror = house.rgb;
    bank.w = max(bank.w, 0.0);
  }
  else if (bank.w < 0.0) {
    // the clouds only past the meadow: a bank or hill the mirrored ray meets
    // stands in front of every cloud (they float above anything the meadow
    // reaches), so the clouds show only where the ray clears the land.
    // From near the ground the mirror pass; from far above the cloud cover;
    // cross-faded on the way
    if (uCloudOrbit.x < 1.0) cl = cloudsInMirror(wp, r, r0, gl_FragCoord.xy / uResolution);
    if (uCloudOrbit.x > 0.0) cl = mix(cl, cloudsFromOrbit(wp, r), uCloudOrbit.x);
  }
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
  // in the tunnel under the pier the water lies in the dark, a little light off its mouth
  col *= mix(1.0, 0.3, underPier(cottageFrame(pw)));
  // passing cloud shadows dim what you see into the water
  col *= 1.0 - 0.18 * cloud * (1.0 - reflectance);
  return col;
}
