// Gradient noise with an integer lattice hash, bit-identical to noise.ts.
// (The usual mod-289 float noise rounds differently in float32 and float64,
// which would make CPU picking and GPU drawing disagree at some lattice
// points; integer hashing is exact on both sides.)

uint meadowHash(ivec3 c, uint seed) {
  uint h = (uint(c.x) * 73856093u) ^ (uint(c.y) * 19349663u) ^ (uint(c.z) * 83492791u) ^ seed;
  h *= 0x27d4eb2du;
  return h ^ (h >> 15);
}

float gradDot(uint h, vec3 f) {
  // Perlin's 16-entry table of the 12 cube-edge gradients (4 repeated);
  // a mask instead of % 12, which GPUs have to emulate
  uint k = (h >> 4) & 15u;
  float u = k < 8u ? f.x : f.y;
  float v = k < 4u ? f.y : (k == 12u || k == 14u ? f.x : f.z);
  return ((k & 1u) == 0u ? u : -u) + ((k & 2u) == 0u ? v : -v);
}

// Range ≈ [-1, 1].
float gnoise(vec3 p, uint seed) {
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 f = p - fl;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = gradDot(meadowHash(i, seed), f);
  float n100 = gradDot(meadowHash(i + ivec3(1, 0, 0), seed), f - vec3(1.0, 0.0, 0.0));
  float n010 = gradDot(meadowHash(i + ivec3(0, 1, 0), seed), f - vec3(0.0, 1.0, 0.0));
  float n110 = gradDot(meadowHash(i + ivec3(1, 1, 0), seed), f - vec3(1.0, 1.0, 0.0));
  float n001 = gradDot(meadowHash(i + ivec3(0, 0, 1), seed), f - vec3(0.0, 0.0, 1.0));
  float n101 = gradDot(meadowHash(i + ivec3(1, 0, 1), seed), f - vec3(1.0, 0.0, 1.0));
  float n011 = gradDot(meadowHash(i + ivec3(0, 1, 1), seed), f - vec3(0.0, 1.0, 1.0));
  float n111 = gradDot(meadowHash(i + ivec3(1, 1, 1), seed), f - vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}
