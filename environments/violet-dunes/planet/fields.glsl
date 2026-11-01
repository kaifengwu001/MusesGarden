// GPU mirror of fields.ts, used by the terrain bake only (bake.frag.glsl).
// Change both together. Requires: meadow_noise.

#define RELIEF_OCTAVES 9
const float RELIEF_BASE_FREQ = 1.6;
const float NOISE_STD = 0.27;
const float DUNE_RIDGE = 0.42;
const float DUNE_FLOOR = -0.85;
const float DUNE_FLOOR_SOFT = 0.55;
const float BASE = 3.2;
const float DRIFT_EDGE = 0.07;
const float STRAY = 0.04;

uniform uint uFieldSeed;
uniform float uDune[RELIEF_OCTAVES];   // dune octave weights (normalised)
uniform float uSwell[RELIEF_OCTAVES];  // swell amplitudes (m)
uniform vec4 uGrain;                   // grain axis xyz, compression
uniform vec4 uHabitat;                 // threshold, softness, calm, dune amplitude (m)
uniform vec4 uPatternA;                // octave pairs (level, t): sand tone, variant
uniform vec4 uDrift;                   // octave pair (level, t): drifts; drift threshold; patchiness
uniform vec4 uStar;                    // starflower density, normalisation; the clusters' threshold and edge

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

// The dune noise, normalised to unit spread (Fields.duneNoise).
float duneNoise(vec3 dir) {
  float n = 0.0;
  float f = RELIEF_BASE_FREQ;
  for (int k = 0; k < RELIEF_OCTAVES; k++) {
    if (uDune[k] > 0.0) n += uDune[k] * stretched(dir, f, uFieldSeed + uint(k));
    f *= 2.0;
  }
  return n / NOISE_STD;
}

// A soft ridge on the noise's zero contour, a soft floor in the troughs (duneProfile).
float duneProfile(float u) {
  float ridge = 1.0 - sqrt(u * u + DUNE_RIDGE * DUNE_RIDGE);
  float d = ridge - DUNE_FLOOR;
  return 0.5 * (ridge + DUNE_FLOOR + sqrt(d * d + DUNE_FLOOR_SOFT * DUNE_FLOOR_SOFT));
}

float swellAt(vec3 dir) {
  float h = 0.0;
  float f = RELIEF_BASE_FREQ;
  for (int k = 0; k < RELIEF_OCTAVES; k++) {
    if (uSwell[k] >= 1e-4) h += uSwell[k] * stretched(dir, f, uFieldSeed + 40u + uint(k));
    f *= 2.0;
  }
  return h;
}

float habitatNoise(vec3 dir) {
  vec3 p = dir * 2.4;
  vec3 w = vec3(gnoise(p, uFieldSeed + 31u), gnoise(p, uFieldSeed + 32u), gnoise(p, uFieldSeed + 33u));
  vec3 q = dir * 1.7 + w * 0.55;
  return 0.72 * gnoise(q, uFieldSeed + 34u) + 0.28 * gnoise(q * 2.2, uFieldSeed + 35u);
}

float habitatAt(vec3 dir) {
  return smoothstep(uHabitat.x - uHabitat.y, uHabitat.x + uHabitat.y, habitatNoise(dir));
}

// Ground height before the homestead (Fields.natural).
float naturalAt(vec3 dir, float habitat) {
  return BASE + uHabitat.w * duneProfile(duneNoise(dir)) * (1.0 - uHabitat.z * habitat) + swellAt(dir);
}

float toneAt(vec3 dir) {
  return clamp(pairNoise(dir, uPatternA.x, uPatternA.y, 170u) * 2.6, -1.0, 1.0);
}

float variantAt(vec3 dir) {
  return 0.5 + 0.5 * clamp(pairNoise(dir, uPatternA.z, uPatternA.w, 190u) * 2.8, -1.0, 1.0);
}

// Where the slate and sail-reeds gather (Fields.clusters).
float clustersAt(vec3 dir, float habitat) {
  if (habitat <= 0.0) return 0.0;
  float n = 0.7 * gnoise(dir * 12.0, uFieldSeed + 250u) + 0.3 * gnoise(dir * 29.0, uFieldSeed + 251u);
  return habitat * smoothstep(uStar.z - uStar.w, uStar.z + uStar.w, n);
}

// Starflowers per m² in channel 1, the clusters in channel 0 (Fields.flora); 2 and 3 stay empty.
vec4 floraAt(vec3 dir, float habitat) {
  float bare = 1.0 - uDrift.w;
  float drift = smoothstep(uDrift.z - DRIFT_EDGE, uDrift.z + DRIFT_EDGE, pairNoise(dir, uDrift.x, uDrift.y, 230u));
  float star = uStar.x * uStar.y * (bare + (1.0 - bare) * drift) * (STRAY + (1.0 - STRAY) * habitat);
  return vec4(clustersAt(dir, habitat), star, 0.0, 0.0);
}
