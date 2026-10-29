// A lifted petal. State is closed-form in time: cycle k = floor(t/T + phase),
// age = fract(...). The spawn point is a hash of (petal, cycle) inside the
// near field; the petal shows only on the bloom front's edge or in a gust.
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
  // spawn somewhere in the near field around the focus
  float ang = h1(aSeed, cycle) * 6.2831853;
  float dist = sqrt(h1(aSeed + 3.1, cycle)) * uPetals.x * 0.85 / uRadius;
  vec3 c = uFieldCentre.xyz;
  vec3 t2 = cross(c, uFieldT1);
  vec3 spawn = normalize(c * cos(dist) + (uFieldT1 * cos(ang) + t2 * sin(ang)) * sin(dist));
  vec4 meadow;
  float inside;
  vec4 f = fieldSample(spawn, meadow, inside);
  float front = 1.0 - abs(f.w - 0.5) * 2.0; // 1 on the front's edge
  float gust = gustAt(spawn) * uGust.z * uWindVec.w;
  float lift = max(smoothstep(0.25, 0.75, front), smoothstep(0.25, 0.6, gust)) * inside * step(0.4, f.y);
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
  vec3 base = spawn * (uRadius + f.x + 0.4 + sin(age * 3.14159) * (1.2 + 1.5 * gust)) + w * drift + side * sin(age * 9.0 + aSeed * 20.0) * 0.4;
  float spin = uGust.x * (3.0 + 4.0 * aSeed) + aSeed * 40.0;
  vec3 ax = w * cos(spin) + up * sin(spin);
  vec3 ay = side * cos(spin * 0.7) + up * sin(spin * 0.7);
  float size = 0.055 * lift * life;
  vec3 world = base + (ax * position.x + ay * position.y) * size * 1.6 + up * position.z * size;
  vec3 col = aSeed < 0.72 ? mix(pal(ROW_PINK, 0), pal(ROW_PINK, 2), h1(aSeed, 9.0)) : pal(ROW_STAR, 0);
  vec3 wp = warpPosition(world);
  vColour = applyAerial(col * (0.9 + 0.2 * toonLight(dot(up, uSunDir))), length(cameraPosition - wp), up);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
