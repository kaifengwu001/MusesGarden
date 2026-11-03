// Shared by the terraces' shaders (the meadow's terrain.glsl and meadow.glsl
// hold the same helpers for the meadow; a terraces shader includes this
// instead). Requires: uRadius.

// This planet's palette rows (TROW in terraces/palette.ts); the sky, cloud and
// light rows are the meadow's (ROW_SKY, ROW_CLOUD, ROW_LIGHT in toon.glsl).
#define TR_RICE 0
#define TR_EARTH 1
#define TR_FOREST 3
#define TR_PEAK 4
#define TR_FOG 5

uniform uint uTerrainSeed;
uniform vec4 uWindVec; // rotation axis of the wind field (xyz), strength

float chordAngle(vec3 a, vec3 b) {
  return 2.0 * asin(clamp(0.5 * length(a - b), 0.0, 1.0));
}

void gradientFrame(vec3 dir, out vec3 a, out vec3 b) {
  a = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  b = cross(dir, a);
}

// A direction's place on a raster a cube face, the six stacked (+x, −x, +y, −y, +z, −z, as the mist's ground raster
// and the fog's map of the peaks are made), n texels a side: kept half a texel in from each face's edges.
vec2 faceAtlas(vec3 d, float n) {
  vec3 a = abs(d);
  float face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) {
    face = d.x > 0.0 ? 0.0 : 1.0;
    uv = d.yz / a.x;
  } else if (a.y >= a.z) {
    face = d.y > 0.0 ? 2.0 : 3.0;
    uv = d.xz / a.y;
  } else {
    face = d.z > 0.0 ? 4.0 : 5.0;
    uv = d.xy / a.z;
  }
  vec2 st = clamp(uv * 0.5 + 0.5, 0.5 / n, 1.0 - 0.5 / n);
  return vec2(st.x, (face + st.y) / 6.0);
}

// Wind direction at a point: a solid-body rotation field around uWindVec.xyz.
vec3 windDir(vec3 dir) {
  vec3 w = cross(uWindVec.xyz, dir);
  float l = length(w);
  return l > 1e-5 ? w / l : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
}
