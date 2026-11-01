// GPU mirror of terraces/fields.ts, used by the terraces' bake only
// (bake.frag.glsl). Change both together. Requires: meadow_noise,
// terraces_common, uRadius.

#define HILL_OCTAVES 8
#define MAX_PEAKS 96
const float HILL_BASE_FREQ = 1.2;
const float FOREST_DETAIL = 0.45;
const float SLOPE_STEP = 1.5;
const float PEAK_REACH = 2.2;
const float NOISE_STD = 0.27;
// RIVER in fields.ts: width (m), the channel's depth (m) and its banks' slope (m), the valley's floor and its hills risen (m)
const vec2 RIVER_WIDTH = vec2(7.0, 13.0);
const float RIVER_DEPTH = 1.5;
const float RIVER_BANK = 2.5;
const vec2 RIVER_VALLEY = vec2(26.0, 80.0);
const float RIVER_STEP = 2.0;

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

// The hills' raw height (m, mean 0) and their local relief (the part in the finer octaves).
vec2 hillParts(vec3 d) {
  float h = 0.0;
  float local = 0.0;
  float f = HILL_BASE_FREQ;
  for (int k = 0; k < HILL_OCTAVES; k++) {
    if (uHill[k] >= 1e-4) {
      float v = uHill[k] * gnoise(d * f, uTSeed + 600u + uint(k));
      h += v;
      if (k > 0) local += v;
    }
    f *= 2.0;
  }
  return vec2(h, local);
}

// The river's signed offset (m) from the middle of its course: its circle swung by the meander.
float riverOffset(vec3 d) {
  return uRadius * asin(clamp(dot(d, uRiver.xyz), -1.0, 1.0)) + (uRiver.w / NOISE_STD) * tPair(d, uRiverPairs.x, uRiverPairs.y, 760u);
}

// The river near a direction: the distance to its middle (m), its width there (m), how far its valley's hills have risen (0 … 1).
vec3 riverAt(vec3 d) {
  float o = riverOffset(d);
  vec3 a, b;
  gradientFrame(d, a, b);
  float e = RIVER_STEP / uRadius;
  float o1 = riverOffset(normalize(d + a * e));
  float o2 = riverOffset(normalize(d + b * e));
  float g = length(vec2(o1 - o, o2 - o)) / RIVER_STEP;
  float dist = abs(o) / max(g, 0.35);
  float width = mix(RIVER_WIDTH.x, RIVER_WIDTH.y, clamp(0.5 + 1.6 * tPair(d, uRiverPairs.z, uRiverPairs.w, 770u), 0.0, 1.0));
  return vec3(dist, width, smoothstep(RIVER_VALLEY.x, RIVER_VALLEY.y, dist));
}

float valleyFloor(float h) {
  float x = (h - uTFloor.x) / uTFloor.y;
  return x > 30.0 ? h - uTFloor.x : uTFloor.y * log(1.0 + exp(x));
}

// The hills' raw height with the river's valley laid flat (under the soft floor along it).
float inValley(float raw, float valley) {
  return raw + (uTFloor.x - 2.5 * uTFloor.y - raw) * (1.0 - valley);
}

// How deep the river's channel is cut under the valley floor (m).
float riverChannel(vec3 r) {
  return RIVER_DEPTH * (1.0 - smoothstep(0.5 * r.y, 0.5 * r.y + RIVER_BANK, r.x));
}

// The mounds round the towers' feet: the tallest one rising there (m), and how near a tower's foot (0..1).
vec2 peaksAt(vec3 d) {
  float h = 0.0;
  float mound = 0.0;
  for (int i = 0; i < MAX_PEAKS; i++) {
    if (i >= uPeakCount) break;
    vec4 a = texelFetch(uPeaks, ivec2(0, i), 0);
    vec4 b = texelFetch(uPeaks, ivec2(1, i), 0);
    if (dot(d, a.xyz) < b.y) continue;
    float s = chordAngle(d, a.xyz) * uRadius / b.x;
    float share = exp(-s * s);
    h = max(h, a.w * share);
    mound = max(mound, share);
  }
  return vec2(h, mound);
}

float naturalAt(vec3 d) {
  vec3 r = riverAt(d);
  return valleyFloor(inValley(hillParts(d).x, r.z)) - riverChannel(r) + peaksAt(d).x;
}

// 0 terraced … 1 wild: the woods, slopes too steep to terrace, the hills' crowns, the gullies, the towers' feet.
float wildAt(vec3 d, float h, float local, float mound, float slope) {
  float n = tPair(d, uTPairsA.x, uTPairsA.y, 640u) + FOREST_DETAIL * tPair(d, uTPairsA.z, uTPairsA.w, 650u);
  float woods = smoothstep(uTForest.x - uTForest.y, uTForest.x + uTForest.y, n);
  float steep = smoothstep(uTForest.z, uTForest.w, slope);
  float s = uTFloor.z;
  float crown = smoothstep(0.7 * s, 1.1 * s, local) * smoothstep(5.0, 9.0, h);
  float gully = smoothstep(-0.85 * s, -1.25 * s, local) * smoothstep(0.1, 0.22, slope);
  float tower = smoothstep(0.12, 0.4, mound);
  return max(max(max(woods, steep), max(crown, gully)), tower);
}

// 0 on the hills … 1 on a valley's flat floor (plots, not terraces), from the hills' raw height.
float flatAt(float raw) {
  return 1.0 - smoothstep(uTPairsB.x, uTPairsB.y, (raw - uTFloor.x) / uTFloor.y);
}

// The bake's terrain pass: natural height (m), slope, wild, flat (1 … 2 in the river: 1 its bank, 2 its middle).
vec4 terraceBase(vec3 dir) {
  vec2 parts = hillParts(dir);
  vec3 r = riverAt(dir);
  float raw = inValley(parts.x, r.z);
  float river = 1.0 - smoothstep(0.5 * r.y + 1.0, 0.5 * r.y + 4.0, r.x);
  vec2 peak = peaksAt(dir);
  float h = valleyFloor(raw) - riverChannel(r) + peak.x;
  vec3 a, b;
  gradientFrame(dir, a, b);
  float e = SLOPE_STEP / uRadius;
  float h1 = naturalAt(normalize(dir + a * e));
  float h2 = naturalAt(normalize(dir + b * e));
  float slope = length(vec2(h1 - h, h2 - h)) / SLOPE_STEP;
  return vec4(h, slope, wildAt(dir, h, parts.y * r.z, peak.y, slope), river > 0.0 ? 1.0 + river : flatAt(raw));
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
