// GPU mirror of fields.ts, used by the terrain bake only (bake.frag.glsl).
// Change both together. Requires: meadow_noise.

#define RELIEF_OCTAVES 9
const float RELIEF_BASE_FREQ = 1.6;
const float COLONY_EDGE = 0.06;
const float DETAIL = 0.3;
const float WET_HUMMOCKS = 1.4;

uniform uint uFieldSeed;
uniform float uRelief[RELIEF_OCTAVES];
uniform float uHummock[RELIEF_OCTAVES];
uniform vec4 uGrain;           // grain axis xyz, compression
uniform vec4 uWet;             // wetness threshold, softness, lift (m), drop (m)
uniform vec4 uLevel;           // water level (m)
uniform vec4 uPatternA;        // octave pairs (level, t): lushness, variant
uniform vec4 uPatternB;        // octave pair (level, t): richness; -; patchiness
uniform vec4 uColonyLevel;     // per species
uniform vec4 uColonyT;
uniform vec4 uDetailLevel;
uniform vec4 uDetailT;
uniform vec4 uColonyThreshold;
uniform vec4 uColonyCover;
uniform vec4 uSpeciesDensity;  // mean flowers per m², per species

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

// Rolling hills plus hummocks, the hummocks raised by wetness.
float reliefAt(vec3 dir, float wet) {
  float h = 0.0;
  float f = RELIEF_BASE_FREQ;
  float lift = 1.0 + WET_HUMMOCKS * wet;
  for (int k = 0; k < RELIEF_OCTAVES; k++) {
    float amp = uRelief[k] + uHummock[k] * lift;
    if (amp >= 1e-4) h += amp * stretched(dir, f, uFieldSeed + uint(k));
    f *= 2.0;
  }
  return h;
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

float lushAt(vec3 dir) {
  return clamp(pairNoise(dir, uPatternA.x, uPatternA.y, 170u) * 2.6, -1.0, 1.0);
}

float variantAt(vec3 dir) {
  return 0.5 + 0.5 * clamp(pairNoise(dir, uPatternA.z, uPatternA.w, 190u) * 2.8, -1.0, 1.0);
}

float dampFactor(int s, float wet) {
  if (s == 0) return 0.7 + 0.8 * wet;
  if (s == 1) return 1.1 - 0.3 * wet;
  if (s == 2) return 1.15 - 0.45 * wet;
  return 0.9 + 0.25 * wet;
}

// Flowers per m²: pink, star, yellow, blue.
vec4 floraAt(vec3 dir, float wet) {
  float p = uPatternB.w;
  float rich = 1.0 + 0.75 * p * clamp(pairNoise(dir, uPatternB.x, uPatternB.y, 180u) * 3.2, -1.0, 1.0);
  vec4 d;
  for (int s = 0; s < 4; s++) {
    float c = pairNoise(dir, uColonyLevel[s], uColonyT[s], 200u + uint(s) * 32u)
            + DETAIL * pairNoise(dir, uDetailLevel[s], uDetailT[s], 300u + uint(s) * 32u);
    float thr = uColonyThreshold[s];
    float colony = smoothstep(thr - COLONY_EDGE, thr + COLONY_EDGE, c);
    d[s] = uSpeciesDensity[s] * rich * (1.0 - p + p * colony / uColonyCover[s]) * dampFactor(s, wet);
  }
  return d;
}
