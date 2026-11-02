// GPU mirror of terraces/fields.ts, used by the terraces' bake only
// (bake.frag.glsl). Change both together. Requires: meadow_noise,
// terraces_common, uRadius.

#define HILL_OCTAVES 8
#define MAX_PEAKS 96
const float HILL_BASE_FREQ = 1.2;
const float FOREST_DETAIL = 0.45;
const float PEAK_REACH = 2.2;
const float NOISE_STD = 0.27;
// RIVER in fields.ts: width (m), the channel's depth (m) and its banks' slope (m), the valley's floor and its hills risen (m)
const vec2 RIVER_WIDTH = vec2(7.0, 13.0);
const float RIVER_DEPTH = 1.5;
const float RIVER_BANK = 2.5;
const vec2 RIVER_VALLEY = vec2(10.0, 40.0);
const float RIVER_REACH = 0.5;

uniform uint uTSeed;
uniform float uHill[HILL_OCTAVES];
uniform vec4 uRiver;      // the river's axis xyz (its course a circle round it), how far its course swings (m)
uniform vec4 uRiverPairs; // octave pairs (level, t): the river's swing, its width
uniform vec4 uTFloor;   // valley floor (m), softness (m), spread of the hills' local relief (m), -
uniform vec4 uTForest;  // forest threshold, softness, steepest terraced slope (start, full)
uniform vec4 uTPairsA;  // octave pairs (level, t): forest, forest detail
uniform vec4 uTPairsB;  // the flat floors' edge (FLAT in fields.ts); -
uniform vec4 uTPairsC;  // fog A, fog B
uniform vec4 uTPairsD;  // season, -
uniform sampler2D uPeaks; // per tower: direction xyz, its mound's height (m); the mound's radius (m), cos of its reach
uniform int uPeakCount;

// A pattern at its two bracketing octaves, blended and renormalised.
float tPair(vec3 dir, float level, float t, uint base) {
  float f0 = exp2(level);
  uint s = uTSeed + base + uint(int(level) + 16);
  float a = gnoise(dir * f0, s);
  float b = gnoise(dir * 2.0 * f0, s + 1u);
  return (a * (1.0 - t) + b * t) / sqrt((1.0 - t) * (1.0 - t) + t * t);
}

// Gradient noise (gnoise, value for value) and its gradient: (value, ∂/∂x, ∂/∂y, ∂/∂z); gnoiseGrad in fields.ts.
vec3 gradVec(uint h) {
  uint k = (h >> 4) & 15u;
  vec3 g = vec3(0.0);
  float su = (k & 1u) == 0u ? 1.0 : -1.0;
  float sv = (k & 2u) == 0u ? 1.0 : -1.0;
  if (k < 8u) g.x += su;
  else g.y += su;
  if (k < 4u) g.y += sv;
  else if (k == 12u || k == 14u) g.x += sv;
  else g.z += sv;
  return g;
}

vec4 gnoiseGrad(vec3 p, uint seed) {
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 f = p - fl;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 dw = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  uint x0 = uint(i.x) * 73856093u;
  uint y0 = uint(i.y) * 19349663u;
  uint z0 = (uint(i.z) * 83492791u) ^ seed;
  uint x1 = x0 + 73856093u;
  uint y1 = y0 + 19349663u;
  uint z1 = (uint(i.z) * 83492791u + 83492791u) ^ seed;
  vec3 g000 = gradVec(finishHash(x0 ^ y0 ^ z0));
  vec3 g100 = gradVec(finishHash(x1 ^ y0 ^ z0));
  vec3 g010 = gradVec(finishHash(x0 ^ y1 ^ z0));
  vec3 g110 = gradVec(finishHash(x1 ^ y1 ^ z0));
  vec3 g001 = gradVec(finishHash(x0 ^ y0 ^ z1));
  vec3 g101 = gradVec(finishHash(x1 ^ y0 ^ z1));
  vec3 g011 = gradVec(finishHash(x0 ^ y1 ^ z1));
  vec3 g111 = gradVec(finishHash(x1 ^ y1 ^ z1));
  float n000 = dot(g000, f);
  float n100 = dot(g100, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(g010, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(g110, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(g001, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(g101, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(g011, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(g111, f - vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0v = mix(x00, x10, w.y);
  float y1v = mix(x01, x11, w.y);
  float du = mix(mix(n100 - n000, n110 - n010, w.y), mix(n101 - n001, n111 - n011, w.y), w.z);
  float dv = mix(x10 - x00, x11 - x01, w.z);
  float dz = y1v - y0v;
  vec3 G = mix(mix(mix(g000, g100, w.x), mix(g010, g110, w.x), w.y), mix(mix(g001, g101, w.x), mix(g011, g111, w.x), w.y), w.z);
  return vec4(mix(y0v, y1v, w.z), G + dw * vec3(du, dv, dz));
}

// A direction-space gradient made a gradient on the planet: in the tangent plane at d, per meter.
vec3 onPlanet(vec3 g, vec3 d) {
  return (g - d * dot(g, d)) / uRadius;
}

// smoothstep's slope at x.
float smoothstepD(float e0, float e1, float x) {
  float t = (x - e0) / (e1 - e0);
  return t <= 0.0 || t >= 1.0 ? 0.0 : 6.0 * t * (1.0 - t) / (e1 - e0);
}

// A pattern at its two bracketing octaves (tPair) and its gradient in direction space: (value, gradient).
vec4 tPairGrad(vec3 dir, float level, float t, uint base) {
  float f0 = exp2(level);
  uint s = uTSeed + base + uint(int(level) + 16);
  vec4 a = gnoiseGrad(dir * f0, s);
  vec4 b = gnoiseGrad(dir * 2.0 * f0, s + 1u);
  float norm = sqrt((1.0 - t) * (1.0 - t) + t * t);
  return vec4(a.x * (1.0 - t) + b.x * t, a.yzw * (f0 * (1.0 - t)) + b.yzw * (2.0 * f0 * t)) / norm;
}

// The river's signed offset (m) from the middle of its course, and its gradient on the planet (per meter).
vec4 riverOffsetGrad(vec3 d) {
  float s = clamp(dot(d, uRiver.xyz), -1.0, 1.0);
  float k = uRiver.w / NOISE_STD;
  vec4 p = tPairGrad(d, uRiverPairs.x, uRiverPairs.y, 760u);
  vec3 g = p.yzw * k + uRiver.xyz * (uRadius / sqrt(max(1.0 - s * s, 1e-6)));
  return vec4(uRadius * asin(s) + k * p.x, onPlanet(g, d));
}

// The river near a direction (riverAt in fields.ts): the distance to its middle (m), its width (m), how far
// its valley's hills have risen (0 … 1), and the distance's and the width's gradients (per meter).
struct River {
  float dist;
  float width;
  float valley;
  vec3 grad;
  vec3 widthGrad;
};

River riverAt(vec3 d) {
  River r;
  vec4 o = riverOffsetGrad(d);
  float g0 = length(o.yzw);
  float g = max(g0, 0.35);
  r.dist = abs(o.x) / g;
  r.grad = o.yzw * (sign(o.x) / g);
  if (r.dist < RIVER_VALLEY.y + 5.0 && g0 > 0.35) {
    vec3 a, b;
    gradientFrame(d, a, b);
    float e = RIVER_REACH / uRadius;
    float ga = (length(riverOffsetGrad(normalize(d + a * e)).yzw) - length(riverOffsetGrad(normalize(d - a * e)).yzw)) / (2.0 * RIVER_REACH);
    float gb = (length(riverOffsetGrad(normalize(d + b * e)).yzw) - length(riverOffsetGrad(normalize(d - b * e)).yzw)) / (2.0 * RIVER_REACH);
    float k = -abs(o.x) / (g * g);
    r.grad += a * (k * ga) + b * (k * gb);
  }
  vec4 wp4 = tPairGrad(d, uRiverPairs.z, uRiverPairs.w, 770u);
  float wp = 0.5 + 1.6 * wp4.x;
  r.width = mix(RIVER_WIDTH.x, RIVER_WIDTH.y, clamp(wp, 0.0, 1.0));
  r.widthGrad = wp > 0.0 && wp < 1.0 ? onPlanet(wp4.yzw, d) * (1.6 * (RIVER_WIDTH.y - RIVER_WIDTH.x)) : vec3(0.0);
  r.valley = smoothstep(RIVER_VALLEY.x, RIVER_VALLEY.y, r.dist);
  return r;
}

float valleyFloor(float h) {
  float x = (h - uTFloor.x) / uTFloor.y;
  return x > 30.0 ? h - uTFloor.x : uTFloor.y * log(1.0 + exp(x));
}

// The towers' mounds: the tallest one rising there (m), how near a tower's foot (0..1), and the tallest's gradient (per meter).
vec2 peaksAt(vec3 d, out vec3 grad) {
  float h = 0.0;
  float mound = 0.0;
  grad = vec3(0.0);
  for (int i = 0; i < MAX_PEAKS; i++) {
    if (i >= uPeakCount) break;
    vec4 a = texelFetch(uPeaks, ivec2(0, i), 0);
    vec4 b = texelFetch(uPeaks, ivec2(1, i), 0);
    if (dot(d, a.xyz) < b.y) continue;
    float s = chordAngle(d, a.xyz) * uRadius / b.x;
    float share = exp(-s * s);
    float m = a.w * share;
    if (m > h) {
      h = m;
      vec3 away = d * dot(d, a.xyz) - a.xyz;
      grad = s > 1e-6 ? normalize(away) * (-2.0 * s * m / b.x) : vec3(0.0);
    }
    mound = max(mound, share);
  }
  return vec2(h, mound);
}

// The natural height (m) and all the bake reads with it: its gradient on the planet (per meter, exact: each
// part with its own derivative, the chain rule through the river's valley and the soft valley floor; naturalGrad
// in fields.ts), the hills' local relief, their raw height laid into the valley, how near a tower's foot, the river.
float terrain(vec3 d, out vec3 grad, out float local, out float iv, out float mound, out River r) {
  float raw = 0.0;
  local = 0.0;
  vec3 gr = vec3(0.0);
  float f = HILL_BASE_FREQ;
  for (int k = 0; k < HILL_OCTAVES; k++) {
    if (uHill[k] >= 1e-4) {
      vec4 n = gnoiseGrad(d * f, uTSeed + 600u + uint(k));
      raw += uHill[k] * n.x;
      if (k > 0) local += uHill[k] * n.x;
      gr += n.yzw * (uHill[k] * f);
    }
    f *= 2.0;
  }
  gr = onPlanet(gr, d);
  r = riverAt(d);
  float C = uTFloor.x - 2.5 * uTFloor.y;
  iv = raw + (C - raw) * (1.0 - r.valley);
  grad = gr * r.valley + r.grad * ((raw - C) * smoothstepD(RIVER_VALLEY.x, RIVER_VALLEY.y, r.dist));
  float x = (iv - uTFloor.x) / uTFloor.y;
  grad *= x > 30.0 ? 1.0 : 1.0 / (1.0 + exp(-x));
  float half_ = 0.5 * r.width;
  float channel = RIVER_DEPTH * (1.0 - smoothstep(half_, half_ + RIVER_BANK, r.dist));
  float edge = RIVER_DEPTH * smoothstepD(half_, half_ + RIVER_BANK, r.dist);
  grad += r.grad * edge - r.widthGrad * (0.5 * edge);
  vec3 gm;
  vec2 peak = peaksAt(d, gm);
  grad += gm;
  mound = peak.y;
  return valleyFloor(iv) - channel + peak.x;
}

// 0 terraced … 1 wild: the woods, slopes too steep to terrace, the hills' crowns, the gullies, the towers' feet.
float wildAt(vec3 d, float h, float local, float mound, float slope) {
  float n = tPair(d, uTPairsA.x, uTPairsA.y, 640u) + FOREST_DETAIL * tPair(d, uTPairsA.z, uTPairsA.w, 650u);
  float woods = smoothstep(uTForest.x - uTForest.y, uTForest.x + uTForest.y, n);
  float steep = smoothstep(uTForest.z, uTForest.w, slope);
  float s = uTFloor.z;
  float crown = smoothstep(0.7 * s, 1.1 * s, local) * smoothstep(5.0, 9.0, h);
  float gully = smoothstep(-0.85 * s, -1.25 * s, local) * smoothstep(0.1, 0.22, slope);
  float tower = smoothstep(0.4, 0.7, mound);
  return max(max(max(woods, steep), max(crown, gully)), tower);
}

// 0 on the hills … 1 on a valley's flat floor (plots, not terraces), from the hills' raw height.
float flatAt(float raw) {
  return 1.0 - smoothstep(uTPairsB.x, uTPairsB.y, (raw - uTFloor.x) / uTFloor.y);
}

// The bake's terrain pass: natural height (m), slope (the length of its exact gradient), wild, flat (1 … 2 in
// the river: 1 its bank, 2 its middle).
vec4 terraceBase(vec3 dir) {
  vec3 g;
  float local, iv, mound;
  River r;
  float h = terrain(dir, g, local, iv, mound, r);
  float slope = length(g);
  float river = 1.0 - smoothstep(0.5 * r.width + 1.0, 0.5 * r.width + 4.0, r.dist);
  // (no trees in the river's water; along its banks, yes)
  float wild = wildAt(dir, h, local * r.valley, mound, slope) * (1.0 - smoothstep(0.4, 0.7, river));
  return vec4(h, slope, wild, river > 0.0 ? 1.0 + river : flatAt(iv));
}

// The bake's gradient pass: the natural height's exact gradient (m per m, on the planet: xyz as dir's).
vec4 terraceGradient(vec3 dir) {
  vec3 g;
  float local, iv, mound;
  River r;
  terrain(dir, g, local, iv, mound, r);
  return vec4(g, 0.0);
}

// The season's spread over the hillsides, 0..1: where paddies are planted early or late.
float seasonAt(vec3 dir) {
  return clamp(0.5 + 1.7 * tPair(dir, uTPairsD.x, uTPairsD.y, 700u), 0.0, 1.0);
}

// The fog's two layers, each 0..1 (the life pass's first two channels).
vec2 terraceFog(vec3 dir) {
  float fogA = 0.5 + 1.6 * tPair(dir, uTPairsC.x, uTPairsC.y, 680u);
  float fogB = 0.5 + 1.6 * tPair(dir, uTPairsC.z, uTPairsC.w, 690u);
  return clamp(vec2(fogA, fogB), 0.0, 1.0);
}
