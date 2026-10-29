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

// meadowHash's final mix, for corners whose coordinate products are known.
uint finishHash(uint h) {
  h *= 0x27d4eb2du;
  return h ^ (h >> 15);
}

// Range ≈ [-1, 1]. The eight corner hashes share their per-axis products
// ((x + 1)·K = x·K + K, mod 2³²), so this is bit-identical to calling
// meadowHash per corner, with a third of the integer multiplies.
float gnoise(vec3 p, uint seed) {
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 f = p - fl;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uint x0 = uint(i.x) * 73856093u;
  uint y0 = uint(i.y) * 19349663u;
  uint z0 = (uint(i.z) * 83492791u) ^ seed;
  uint x1 = x0 + 73856093u;
  uint y1 = y0 + 19349663u;
  uint z1 = (uint(i.z) * 83492791u + 83492791u) ^ seed;
  float n000 = gradDot(finishHash(x0 ^ y0 ^ z0), f);
  float n100 = gradDot(finishHash(x1 ^ y0 ^ z0), f - vec3(1.0, 0.0, 0.0));
  float n010 = gradDot(finishHash(x0 ^ y1 ^ z0), f - vec3(0.0, 1.0, 0.0));
  float n110 = gradDot(finishHash(x1 ^ y1 ^ z0), f - vec3(1.0, 1.0, 0.0));
  float n001 = gradDot(finishHash(x0 ^ y0 ^ z1), f - vec3(0.0, 0.0, 1.0));
  float n101 = gradDot(finishHash(x1 ^ y0 ^ z1), f - vec3(1.0, 0.0, 1.0));
  float n011 = gradDot(finishHash(x0 ^ y1 ^ z1), f - vec3(0.0, 1.0, 1.0));
  float n111 = gradDot(finishHash(x1 ^ y1 ^ z1), f - vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}
