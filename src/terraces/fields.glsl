// GPU mirror of terraces/fields.ts, used by the terraces' bake only
// (bake.frag.glsl). Change both together. Requires: meadow_noise,
// terraces_common, uRadius.

#define HILL_OCTAVES 8
#define MAX_PEAKS 96
const float HILL_BASE_FREQ = 1.2;
const float GRAIN = 0.4;
const float FOREST_DETAIL = 0.45;
const float SLOPE_STEP = 1.5;
const float PEAK_REACH = 2.6;

uniform uint uTSeed;
uniform float uHill[HILL_OCTAVES];
uniform vec4 uTGrain;   // grain axis xyz, compression
uniform vec4 uTFloor;   // valley floor (m), softness (m), spread of the hills' local relief (m), -
uniform vec4 uTForest;  // forest threshold, softness, steepest terraced slope (start, full)
uniform vec4 uTPairsA;  // octave pairs (level, t): forest, forest detail
uniform vec4 uTPairsB;  // the flat floors' edge (FLAT in fields.ts); -
uniform vec4 uTPairsC;  // fog A, fog B
uniform vec4 uTPairsD;  // season, -
uniform sampler2D uPeaks; // per peak: direction xyz, height (m); radius (m), cos of its reach
uniform int uPeakCount;
uniform vec4 uTTwirl[4];
uniform vec4 uTTwirlRadius;

// A direction turned through the twirls (twirl() in planet/fields.ts).
vec3 tTwirl(vec3 d) {
  for (int i = 0; i < 4; i++) {
    vec3 c = uTTwirl[i].xyz;
    float cs = clamp(dot(d, c), -1.0, 1.0);
    float th = acos(cs) / uTTwirlRadius[i];
    float a = uTTwirl[i].w * exp(-th * th);
    float ca = cos(a);
    d = d * ca + cross(c, d) * sin(a) + c * (cs * (1.0 - ca));
  }
  return d;
}

// Noise at dir·f, compressed along the grain.
float tStretched(vec3 dir, float f, uint seed) {
  float k = GRAIN * dot(dir, uTGrain.xyz);
  return gnoise((dir - uTGrain.xyz * k) * f, seed);
}

// A pattern at its two bracketing octaves, blended and renormalised.
float tPair(vec3 dir, float level, float t, uint base) {
  float f0 = exp2(level);
  uint s = uTSeed + base + uint(int(level) + 16);
  float a = tStretched(dir, f0, s);
  float b = tStretched(dir, 2.0 * f0, s + 1u);
  return (a * (1.0 - t) + b * t) / sqrt((1.0 - t) * (1.0 - t) + t * t);
}

// The hills' raw height (m, mean 0) and their local relief (the part in the finer octaves).
vec2 hillParts(vec3 t) {
  float h = 0.0;
  float local = 0.0;
  float f = HILL_BASE_FREQ;
  for (int k = 0; k < HILL_OCTAVES; k++) {
    if (uHill[k] >= 1e-4) {
      float v = uHill[k] * tStretched(t, f, uTSeed + 600u + uint(k));
      h += v;
      if (k > 0) local += v;
    }
    f *= 2.0;
  }
  return vec2(h, local);
}

float hillsTwirled(vec3 t) {
  return hillParts(t).x;
}

float valleyFloor(float h) {
  float x = (h - uTFloor.x) / uTFloor.y;
  return x > 30.0 ? h - uTFloor.x : uTFloor.y * log(1.0 + exp(x));
}

float peakProfile(float s) {
  float q = s / 0.66;
  return exp(-q * q * q) + 0.16 * exp(-(s / 1.35) * (s / 1.35));
}

float peaksAt(vec3 d) {
  float h = 0.0;
  for (int i = 0; i < MAX_PEAKS; i++) {
    if (i >= uPeakCount) break;
    vec4 a = texelFetch(uPeaks, ivec2(0, i), 0);
    vec4 b = texelFetch(uPeaks, ivec2(1, i), 0);
    if (dot(d, a.xyz) < b.y) continue;
    h = max(h, a.w * peakProfile(chordAngle(d, a.xyz) * uRadius / b.x));
  }
  return h;
}

float naturalAt(vec3 d) {
  return valleyFloor(hillsTwirled(tTwirl(d))) + peaksAt(d);
}

// 0 terraced … 1 wild: the woods, slopes too steep to terrace, the hills' crowns, the gullies, the peaks.
float wildAt(vec3 t, float h, float local, float peak, float slope) {
  float n = tPair(t, uTPairsA.x, uTPairsA.y, 640u) + FOREST_DETAIL * tPair(t, uTPairsA.z, uTPairsA.w, 650u);
  float woods = smoothstep(uTForest.x - uTForest.y, uTForest.x + uTForest.y, n);
  float steep = smoothstep(uTForest.z, uTForest.w, slope);
  float s = uTFloor.z;
  float crown = smoothstep(0.7 * s, 1.1 * s, local) * smoothstep(5.0, 9.0, h);
  float gully = smoothstep(-0.85 * s, -1.25 * s, local) * smoothstep(0.1, 0.22, slope);
  float tower = smoothstep(1.2, 3.5, peak);
  return max(max(max(woods, steep), max(crown, gully)), tower);
}

// 0 on the hills … 1 on a valley's flat floor (plots, not terraces), from the hills' raw height.
float flatAt(float raw) {
  return 1.0 - smoothstep(uTPairsB.x, uTPairsB.y, (raw - uTFloor.x) / uTFloor.y);
}

// The bake's terrain pass: natural height (m), slope, wild, flat.
vec4 terraceBase(vec3 dir) {
  vec3 t = tTwirl(dir);
  vec2 parts = hillParts(t);
  float peak = peaksAt(dir);
  float h = valleyFloor(parts.x) + peak;
  vec3 a, b;
  gradientFrame(dir, a, b);
  float e = SLOPE_STEP / uRadius;
  float h1 = naturalAt(normalize(dir + a * e));
  float h2 = naturalAt(normalize(dir + b * e));
  float slope = length(vec2(h1 - h, h2 - h)) / SLOPE_STEP;
  return vec4(h, slope, wildAt(t, h, parts.y, peak, slope), flatAt(parts.x));
}

// The season's spread over the hillsides, 0..1: where paddies are planted early or late.
float seasonAt(vec3 dir) {
  return clamp(0.5 + 1.7 * tPair(tTwirl(dir), uTPairsD.x, uTPairsD.y, 700u), 0.0, 1.0);
}

// The fog's two layers, each 0..1 (the life pass's first two channels).
vec2 terraceFog(vec3 dir) {
  vec3 t = tTwirl(dir);
  float fogA = 0.5 + 1.6 * tPair(t, uTPairsC.x, uTPairsC.y, 680u);
  float fogB = 0.5 + 1.6 * tPair(t, uTPairsC.z, uTPairsC.w, 690u);
  return clamp(vec2(fogA, fogB), 0.0, 1.0);
}
