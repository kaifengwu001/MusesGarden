// GPU mirror of fields.ts, used by the terrain bake only (bake.frag.glsl).
// Change both together. Every field takes the twirled direction (twirl()).
// Requires: meadow_noise.

#define RELIEF_OCTAVES 9
const float RELIEF_BASE_FREQ = 1.6;
const float COLONY_EDGE = 0.06;
const float DRIFT_EDGE = 0.07;
const float DETAIL = 0.3;
const float WET_HUMMOCKS = 1.4;
const float WET_PLATEAU = 0.55;
const float WET_PLATEAU_KEEP = 0.12;

uniform uint uFieldSeed;
uniform float uRelief[RELIEF_OCTAVES];
uniform float uHummock[RELIEF_OCTAVES];
uniform vec4 uGrain;           // grain axis xyz, compression
uniform vec4 uWet;             // wetness threshold, softness, lift (m), drop (m)
uniform vec4 uLevel;           // water level (m)
uniform vec4 uPatternA;        // octave pairs (level, t): lushness, variant
uniform vec4 uPatternB;        // octave pair (level, t): richness; -; patchiness
uniform vec4 uDrift;           // octave pair (level, t): drifts; drift threshold; -
uniform vec4 uSpeciesNorm;     // per species: density normalisation
uniform vec4 uColonyLevel;     // per species
uniform vec4 uColonyT;
uniform vec4 uDetailLevel;
uniform vec4 uDetailT;
uniform vec4 uColonyThreshold;
uniform vec4 uColonyCover;
uniform vec4 uSpeciesDensity;  // mean flowers per m², per species
uniform vec4 uTwirl[4];        // twirls: centre xyz, turn at the centre (rad)
uniform vec4 uTwirlRadius;     // their angular radii (rad)
uniform vec4 uHome;            // the home's tuned ground (Fields.anchorHome): the cottage's direction, R / the tuned R (1: none)
uniform vec4 uHomeReach;       // its reach (m along the ground): full to, gone by; R (m), -
uniform float uReliefTuned[RELIEF_OCTAVES]; // uRelief and uHummock on the planet it was tuned on
uniform float uHummockTuned[RELIEF_OCTAVES];
uniform vec4 uTuned;           // there: lift (m), drop (m), -, -
uniform vec4 uPatternTuned;    // there: octave pairs (level, t) of lushness and variant

// A direction turned through the twirls (twirl() in fields.ts): every field
// here is sampled at it, so hills, lakes and drifts swirl.
vec3 twirl(vec3 d) {
  for (int i = 0; i < 4; i++) {
    vec3 c = uTwirl[i].xyz;
    float cs = clamp(dot(d, c), -1.0, 1.0);
    float th = acos(cs) / uTwirlRadius[i];
    float a = uTwirl[i].w * exp(-th * th);
    float ca = cos(a);
    d = d * ca + cross(c, d) * sin(a) + c * (cs * (1.0 - ca));
  }
  return d;
}

// Noise at dir·f, compressed along the grain.
float stretched(vec3 dir, float f, uint seed) {
  float k = uGrain.w * dot(dir, uGrain.xyz);
  return gnoise((dir - uGrain.xyz * k) * f, seed);
}

// A pattern at its two bracketing octaves, blended and renormalised.
float pairNoise(vec3 dir, float level, float t, uint base) {
  float f0 = exp2(level);
  uint s = uFieldSeed + base + uint(int(level) + 16);
  float a = stretched(dir, f0, s);
  float b = stretched(dir, 2.0 * f0, s + 1u);
  return (a * (1.0 - t) + b * t) / sqrt((1.0 - t) * (1.0 - t) + t * t);
}

// Rolling hills plus hummocks, the hummocks raised by wetness, with one planet's amplitudes.
float reliefWith(vec3 dir, float wet, float relief[RELIEF_OCTAVES], float hummock[RELIEF_OCTAVES]) {
  float h = 0.0;
  float f = RELIEF_BASE_FREQ;
  float lift = 1.0 + WET_HUMMOCKS * wet;
  for (int k = 0; k < RELIEF_OCTAVES; k++) {
    float amp = relief[k] + hummock[k] * lift;
    if (amp >= 1e-4) h += amp * stretched(dir, f, uFieldSeed + uint(k));
    f *= 2.0;
  }
  return h;
}

float reliefAt(vec3 dir, float wet) {
  return reliefWith(dir, wet, uRelief, uHummock);
}

float wetNoise(vec3 dir) {
  vec3 p = dir * 2.4;
  vec3 w = vec3(gnoise(p, uFieldSeed + 31u), gnoise(p, uFieldSeed + 32u), gnoise(p, uFieldSeed + 33u));
  vec3 q = dir * 1.7 + w * 0.55;
  return 0.72 * gnoise(q, uFieldSeed + 34u) + 0.28 * gnoise(q * 2.2, uFieldSeed + 35u);
}

float wetnessAt(vec3 dir) {
  return smoothstep(uWet.x - uWet.y, uWet.x + uWet.y, wetNoise(dir));
}

// Lushness and colour variant at one planet's octave pair (level, t).
float lushWith(vec3 dir, vec2 pair) {
  return clamp(pairNoise(dir, pair.x, pair.y, 170u) * 2.6, -1.0, 1.0);
}

float variantWith(vec3 dir, vec2 pair) {
  return 0.5 + 0.5 * clamp(pairNoise(dir, pair.x, pair.y, 190u) * 2.8, -1.0, 1.0);
}

float lushAt(vec3 dir) {
  return lushWith(dir, uPatternA.xy);
}

float variantAt(vec3 dir) {
  return variantWith(dir, uPatternA.zw);
}

// How much of the ground at dir is the home's tuned ground (Fields.homeWeight): 1 about the home … 0 away from it.
float homeWeight(vec3 dir) {
  if (uHome.w == 1.0) return 0.0;
  float d = atan(length(cross(dir, uHome.xyz)), dot(dir, uHome.xyz)) * uHomeReach.z;
  return smoothstep(uHomeReach.y, uHomeReach.x, d);
}

// The direction on the tuned planet whose ground stands at dir here (Fields.homeDirection): the one at
// the same cottage-local meters, on the same bearing.
vec3 homeDirection(vec3 dir) {
  vec3 c = uHome.xyz;
  vec3 side = (dir - c * dot(dir, c)) * uHome.w;
  return side + c * sqrt(max(0.0, 1.0 - dot(side, side)));
}

float dampFactor(int s, float wet) {
  if (s == 0) return 0.7 + 0.8 * wet;
  if (s == 1) return 1.1 - 0.3 * wet;
  if (s == 2) return 1.15 - 0.45 * wet;
  return 0.9 + 0.25 * wet;
}

// Flowers per m² from the drifts and colonies (Fields.flora): pink, star, yellow, blue.
vec4 floraAt(vec3 dir, float wet) {
  float bare = 1.0 - uPatternB.w;
  float n = pairNoise(dir, uDrift.x, uDrift.y, 230u) + 0.5 * pairNoise(dir, uPatternB.x, uPatternB.y, 180u);
  float drift = smoothstep(uDrift.z - DRIFT_EDGE, uDrift.z + DRIFT_EDGE, n);
  vec4 d;
  for (int s = 0; s < 4; s++) {
    float c = pairNoise(dir, uColonyLevel[s], uColonyT[s], 200u + uint(s) * 32u)
            + DETAIL * pairNoise(dir, uDetailLevel[s], uDetailT[s], 300u + uint(s) * 32u);
    float thr = uColonyThreshold[s];
    float colony = smoothstep(thr - COLONY_EDGE, thr + COLONY_EDGE, c);
    d[s] = uSpeciesDensity[s] * uSpeciesNorm[s] * (bare + (1.0 - bare) * drift * colony) * dampFactor(s, wet);
  }
  return d;
}
