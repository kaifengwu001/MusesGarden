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

// Wind direction at a point: a solid-body rotation field around uWindVec.xyz.
vec3 windDir(vec3 dir) {
  vec3 w = cross(uWindVec.xyz, dir);
  float l = length(w);
  return l > 1e-5 ? w / l : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
}
