// One shell of the standing crop (ryeCanopy.ts): the planet's ground raised
// by this shell's height, warped like everything else. What stands at this
// height, and its colour, is decided per pixel (ryeCanopy.frag.glsl).
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_clouds>
#define MAX_RIPEN_DISCS 8
uniform float uCanopyTop;
uniform float uCanopyEdge; // the shells' longest triangle edge (rad)
uniform float uRyeRipeness;
uniform vec4 uUserBloom[MAX_RIPEN_DISCS];
attribute float aShell; // 0 at the ground … 1 at the top shell

varying vec3 vDir;
varying vec3 vWarped;
varying float vHeight; // this shell's height over the ground (m)
varying float vCloud;
varying float vRipe;

void main() {
  vec3 dir = normalize(position);
  // the ground is flat: one bilinear fetch is within millimetres of the terrain mesh
  float ground = textureLod(uTerrainBake, dir, 0.0).r + uBank.x;
  float h = aShell * uCanopyTop;
  // lift every shell by the most its flat triangles sag below the (warped)
  // ground between vertices, so even the lowest never dips into it (canopyLift)
  float edge = uCanopyEdge * uRadius;
  float lift = edge * edge * 0.125 * (1.0 / uRadius + 2.0 * max(uWarpK, 0.0)) + 0.005;
  vec3 planet = dir * (uRadius + ground + lift + h);
  vec3 world = warpPosition(planet);
  vDir = dir;
  vWarped = world;
  vHeight = h;
  vCloud = cloudShadowAt(dir * (uRadius + ground), 0.0);
  float ripe = uRyeRipeness;
  for (int i = 0; i < MAX_RIPEN_DISCS; i++) {
    vec4 disc = uUserBloom[i];
    if (disc.w > 0.0) ripe = max(ripe, 1.0 - smoothstep(disc.w * 0.7, disc.w, 2.0 * asin(clamp(length(dir - disc.xyz) * 0.5, 0.0, 1.0))));
  }
  vRipe = smoothstep(0.0, 1.0, ripe);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
