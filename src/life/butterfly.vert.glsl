// A butterfly (butterflies.ts): instance → a cell of the block about the
// focus; the cell's hash says whether a butterfly lives there, where, of
// what kind, and how it flies. Two wings hinged along the body.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
uniform float uTime;
uniform vec3 uButterflyCell;  // the focus's cell (planet space)
uniform vec3 uButterflyFocus; // the focus direction
uniform vec4 uButterflies;    // cell size (m), half extent (cells), fade radius (m), visibility

varying vec2 vUv;             // out from the body (0 … 1), along it (-0.5 back … 0.6 front)
flat varying float vKind;
varying float vLight;
varying float vDist;
varying vec3 vDir;

void hide() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
}

float hashUnit(uint h, uint shift) {
  return float((h >> shift) & 255u) / 255.0;
}

void main() {
  vUv = vec2(abs(position.x), position.z);
  vKind = 0.0;
  vLight = 1.0;
  vDist = 0.0;
  vDir = vec3(0.0, 1.0, 0.0);
  int n = 2 * int(uButterflies.y) + 1;
  int i = gl_InstanceID;
  ivec3 cell = ivec3(uButterflyCell) + ivec3(i % n, (i / n) % n, i / (n * n)) - ivec3(int(uButterflies.y));
  uint h = meadowHash(cell, uTerrainSeed + 4711u);
  // the cell's candidate counts if it lies in the shell about the water table
  float C = uButterflies.x;
  vec3 cand = (vec3(cell) + vec3(hashUnit(h, 0u), hashUnit(h, 8u), hashUnit(h, 16u))) * C;
  float r = length(cand);
  if (abs(r - uRadius) > 0.5 * C) {
    hide();
    return;
  }
  vec3 home = cand / r;
  float fade = smoothstep(uButterflies.z, uButterflies.z * 0.7, chordAngle(home, uButterflyFocus) * uRadius) * uButterflies.w;
  // where the flowers are, in bloom, on dry ground away from the cottage
  vec4 flora = textureLod(uFloraBake, home, 0.0);
  float chance = clamp(dot(flora, vec4(1.0)) / 16.0, 0.0, 0.85) * bloomAt(home);
  float ground = height0(home);
  if (fade <= 0.0 || hashUnit(h, 24u) >= chance || ground < 0.1 || clearingAt(home, chordAngle(home, uCottage.xyz) * uRadius) > 0.3) {
    hide();
    return;
  }
  uint h2 = meadowHash(cell, uTerrainSeed + 4712u);
  float r0 = hashUnit(h2, 0u);
  float r1 = hashUnit(h2, 8u);
  float r2 = hashUnit(h2, 16u);
  float r3 = hashUnit(h2, 24u);
  // kind: whites, sulphurs, fritillaries, blues, a few admirals and orange tips
  float k = fract(r0 * 7.31 + r3 * 3.7);
  vKind = k < 0.3 ? 0.0 : k < 0.5 ? 1.0 : k < 0.68 ? 2.0 : k < 0.82 ? 3.0 : k < 0.9 ? 4.0 : 5.0;

  // flight: a wandering loop about home with quick jinks, now and then a rest on a flower
  float t = uTime + r0 * 60.0;
  float rest = smoothstep(0.55, 0.85, sin(0.13 * t + r1 * 6.2831853));
  vec2 a = vec2(0.53, 0.47) * (0.8 + 0.4 * r2);
  vec2 b = vec2(1.37, 1.21) * (0.8 + 0.4 * r3);
  vec2 ph = vec2(r1, r3) * 6.2831853;
  vec2 wander = vec2(1.5 * sin(a.x * t + ph.x) + 0.6 * sin(b.x * t + ph.y), 1.2 * sin(a.y * t + ph.y) + 0.6 * sin(b.y * t + ph.x))
              + 0.12 * vec2(sin(5.1 * t + r2 * 9.0), sin(4.3 * t + r3 * 9.0));
  vec2 velocity = vec2(1.5 * a.x * cos(a.x * t + ph.x) + 0.6 * b.x * cos(b.x * t + ph.y), 1.2 * a.y * cos(a.y * t + ph.y) + 0.6 * b.y * cos(b.y * t + ph.x));
  wander *= 1.0 - rest;
  float beat = sin(6.2831853 * (6.5 + 3.0 * r2) * t);
  float lift = mix(1.0 + 0.4 * sin(0.9 * t + r1 * 6.2831853) + 0.25 * sin(0.37 * t + r2 * 6.2831853) + 0.06 * beat, 0.42, rest);
  // wings: beating from nearly flat to nearly closed; at rest, slowly fanning
  float wing = mix(0.2 + 0.5 * (1.0 + beat), 0.95 + 0.45 * sin(1.7 * t + r0 * 6.2831853), rest);

  vec3 up = home;
  vec3 t1 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(up, t1);
  float restHeading = r2 * 6.2831853;
  vec3 fwd = normalize(mix(normalize(t1 * velocity.x + t2 * velocity.y + 1e-4 * t1), t1 * cos(restHeading) + t2 * sin(restHeading), rest));
  vec3 right = cross(fwd, up);
  vec3 base = up * (uRadius + ground + lift) + t1 * wander.x + t2 * wander.y;
  float span = 0.09 * (0.8 + 0.4 * r3) * smoothstep(0.0, 0.4, fade);
  vec3 local = vec3(position.x * cos(wing), abs(position.x) * sin(wing), position.z);
  vec3 world = base + (right * local.x + up * local.y + fwd * local.z) * span;
  // thin wings: lit through from either side
  vec3 nWing = normalize(up * cos(wing) - right * sign(position.x + 1e-6) * sin(wing));
  vLight = 0.82 + 0.25 * toonLight(abs(dot(nWing, uSunDir)));
  vec3 wp = warpPosition(world);
  vDist = length(cameraPosition - wp);
  vDir = home;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
