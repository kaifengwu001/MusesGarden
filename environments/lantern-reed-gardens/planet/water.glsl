// Still shallow mineral pools. Sky, clouds and terrain reflect broadly;
// new props and wildlife are deliberately absent from this inexpensive mirror.
#define MAX_RIPPLES 6
uniform vec4 uWaterLook;
uniform vec4 uWaterSky;
uniform vec4 uRipples[MAX_RIPPLES];

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

vec3 waterSky(float e) {
  vec3 c = mix(pal(ROW_WATER, 4), pal(ROW_WATER, 0), smoothstep(0.0, 0.35, e));
  return mix(c, pal(ROW_WATER, 5), smoothstep(0.35, 0.9, e));
}

float bankTop(vec3 d) {
  float h = height0(d);
  return h + (uBank.x + uWaterSky.z) * smoothstep(0.0, 0.06, h);
}

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

vec3 bankColour(vec3 d, float y) {
  float variation = textureLod(uTerrainBake, d, 0.0).a;
  vec3 mineral = mix(pal(ROW_ROCK, 1), pal(ROW_ROCK, 0), 0.2 + 0.3 * variation);
  return mix(mineral, pal(ROW_WATER, 1), 0.45) * (0.8 + 0.03 * clamp(y, 0.0, 2.0));
}

vec3 waterColour(vec3 dir, vec3 wp, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  vec3 along = windDir(dir);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec3 body = mix(mix(pal(ROW_WATER, 1), pal(ROW_WATER, 0), 0.4), pal(ROW_WATER, 5), smoothstep(0.75, 0.08, depth) * 0.45 * uWaterLook.y);
  vec3 r0 = reflect(-v, n);
  vec3 r = normalize(r0 + along * stroke * 0.018 * (0.2 + gust) * uWindVec.w);
  float rise = dot(r, n);
  vec3 mirror = waterSky(rise);
  float tBank = bankAlong(wp, r, -shore, rise / sqrt(max(1.0 - rise * rise, 1e-4)));
  bool bank = tBank < 1e8;
  vec4 cl = vec4(0.0);
  if (bank) {
    vec3 q = unwarpPosition(wp + r * tBank);
    float ql = length(q);
    mirror = bankColour(q / ql, ql - uRadius);
  } else {
    if (uCloudOrbit.x < 1.0) cl = cloudsInMirror(wp, r, r0, gl_FragCoord.xy / uResolution);
    if (uCloudOrbit.x > 0.0) cl = mix(cl, cloudsFromOrbit(wp, r), uCloudOrbit.x);
  }
  float reflection = mix(0.46, 0.88, pow(1.0 - facing, 1.8)) * uWaterSky.x;
  vec3 col = mix(body, mirror, reflection);
  if (bank) col = mix(col, mirror, 0.35 * uWaterSky.x);
  col = mix(col, cl.rgb / max(cl.a, 1e-3), cl.a * 0.65 * uWaterSky.x);
  col = mix(col, pal(ROW_WATER, 9), smoothstep(0.42, 0.85, stroke) * 0.07 * uWindVec.w);
  // Sparse elongated ripples carry a little sky colour across the quiet basin.
  vec3 waveDir = normalize(dir + along * (0.08 * sin(uWaterLook.w * 0.16) / uRadius));
  float wave = strokes(waveDir, uRadius / 4.0, along, uTerrainSeed + 148u);
  float ribbon = 1.0 - smoothstep(0.035, 0.085, abs(wave - 0.15));
  float broken = smoothstep(-0.05, 0.25, gnoise(dir * (uRadius / 11.0), uTerrainSeed + 149u));
  col = mix(col, pal(ROW_WATER, 9), ribbon * broken * 0.18 * (1.0 - cloud) * (1.0 - smoothstep(0.15, 0.7, pixelMeters)));
  float f0, f1;
  uint lv;
  float t = patternOctaves(0.8, pixelMeters, 8.0, f0, f1, lv);
  float sparkle = mix(glintOctave(dir, f0, along, uTerrainSeed + 130u + lv), glintOctave(dir, f1, along, uTerrainSeed + 131u + lv), t);
  col += pal(ROW_WATER, 3) * sparkle * 0.15 * uWaterLook.z * (1.0 - cloud);
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.38);
  // A thin pale wet edge emphasizes the common waterline without foamy surf.
  float edge = smoothstep(-0.42, -0.06, shore) * (1.0 - smoothstep(0.025, 0.15, pixelMeters));
  col = mix(col, mix(pal(ROW_WATER, 9), pal(ROW_WATER, 3), 0.25), edge * 0.2);
  return col * (1.0 - 0.12 * cloud * (1.0 - reflection));
}
