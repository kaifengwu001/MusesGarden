// A lifted petal. State is closed-form in time: cycle k = floor(t/T + phase),
// age = fract(...). The spawn point is a hash of (petal, cycle) inside the
// near field, more of them near you; the petal shows where flowers grow
// (the flora bake), as a gust's crest passes over them or on the bloom
// front's edge, and takes the colour of one of the flowers there.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_field>
#include <meadow_wind>

attribute float aSeed;
uniform vec4 uPetals; // near radius (m)
varying vec3 vColour;

float h1(float a, float b) {
  return fract(sin(a * 127.1 + b * 311.7) * 43758.5453);
}

void main() {
  float period = 3.5 + 3.0 * aSeed;
  float cycle = floor(uGust.x / period + aSeed * 7.0);
  float age = fract(uGust.x / period + aSeed * 7.0);
  // spawn somewhere in the near field around the focus, more of them near
  float ang = h1(aSeed, cycle) * 6.2831853;
  float dist = pow(h1(aSeed + 3.1, cycle), 0.7) * uPetals.x * 0.85 / uRadius;
  vec3 c = uFieldCentre.xyz;
  vec3 t2 = cross(c, uFieldT1);
  vec3 spawn = normalize(c * cos(dist) + (uFieldT1 * cos(ang) + t2 * sin(ang)) * sin(dist));
  vec4 meadow;
  vec4 wind;
  float inside;
  vec4 f = fieldSample(spawn, meadow, wind, inside);
  // the flowers there (per m²: pink, star, yellow, blue): petals come from where they grow
  vec4 flora = textureLod(uFloraBake, spawn, 0.0);
  float total = flora.x + flora.y + flora.z + flora.w;
  float front = 1.0 - abs(f.w - 0.5) * 2.0; // 1 on the front's edge
  // a gust's crest lifts them off, as the wind and its gusts allow
  float gust = max(wind.w, 0.0) * (0.4 + uGust.z) * smoothstep(0.05, 0.4, uWindVec.w);
  float lift = max(smoothstep(0.25, 0.75, front), smoothstep(0.2, 0.65, gust)) * smoothstep(0.3, 3.0, total) * inside * step(0.4, f.y);
  float life = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.75, 1.0, age));
  if (lift * life < 0.02) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  // rise, drift downwind, flutter and spin
  vec3 up = spawn;
  vec3 w = windDir(spawn);
  vec3 side = cross(up, w);
  float drift = age * (2.0 + 9.0 * uWindVec.w);
  vec3 base = spawn * (uRadius + f.x + 0.3 + sin(age * 3.14159) * (0.5 + 1.0 * gust)) + w * drift + side * sin(age * 9.0 + aSeed * 20.0) * 0.4;
  float spin = uGust.x * (3.0 + 4.0 * aSeed) + aSeed * 40.0;
  vec3 ax = w * cos(spin) + up * sin(spin);
  vec3 ay = side * cos(spin * 0.7) + up * sin(spin * 0.7);
  float size = 0.055 * lift * life;
  vec3 world = base + (ax * position.x + ay * position.y) * size * 1.6 + up * position.z * size;
  // one of the flowers there, by how many of each grow
  float pick = h1(aSeed + 5.3, cycle) * total;
  int species = pick < flora.x ? 0 : pick < flora.x + flora.y ? 1 : pick < flora.x + flora.y + flora.z ? 2 : 3;
  vec3 col = floraColour(species, colonyVariant(h1(aSeed + 7.9, cycle)), 0.85);
  vec3 wp = warpPosition(world);
  vColour = applyAerial(col * (0.9 + 0.2 * toonLight(dot(up, uSunDir))), length(cameraPosition - wp), up);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
