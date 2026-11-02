// The cauliflower lumps over a cloud's puffs (clouds.glsl), shared with the
// shadow splat so a cloud's shadow has the cloud's outline. The lumps are
// billows (|noise|, round bulges with creases between) baked once into a
// small cube map (cloudLumpsBake.frag.glsl), four patterns in its channels;
// each puff reads one of them, turned its own way and slowly churning.
uniform float uTime;
uniform samplerCube uCloudLumps;

/** How far lumps push a puff's outline in and out (× its radius). */
const float CLOUD_LUMPS = 0.035;

// Lumps over a puff, by the direction from its centre: roughly -1 in a
// crease … +1.5 on a bulge, 0 on average.
float puffLumps(vec3 side, uint seed) {
  uint perm = (seed >> 2u) % 6u;
  vec3 s = perm == 0u ? side : perm == 1u ? side.yzx : perm == 2u ? side.zxy : perm == 3u ? side.xzy : perm == 4u ? side.yxz : side.zyx;
  uint flip = (seed >> 5u) & 7u;
  s *= vec3((flip & 1u) != 0u ? -1.0 : 1.0, (flip & 2u) != 0u ? -1.0 : 1.0, (flip & 4u) != 0u ? -1.0 : 1.0);
  float a = uTime * 0.02;
  float c = cos(a);
  float sn = sin(a);
  s.xy = vec2(c * s.x - sn * s.y, sn * s.x + c * s.y);
  vec4 l = textureLod(uCloudLumps, s, 0.0);
  uint ch = seed & 3u;
  return (ch == 0u ? l.r : ch == 1u ? l.g : ch == 2u ? l.b : l.a) * 2.5 - 1.0;
}

// Seed of puff k's lumps.
uint lumpSeed(uint cloudSeed, int k) {
  return cloudSeed * 16u + uint(k) * 2u + 9001u;
}
