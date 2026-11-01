// The terraces' backdrop (backdrop.ts), as the planet painting lays it
// round its little world: a sea of mist, soft puffs drifting in it, and karst
// towers standing up out of it all round the frame in three ranks, bluer and
// paler the farther back, their feet lost in the mist. Painted on the frame
// itself behind the planet (as the sky's own backdrop is from orbit), fading
// out as the view comes down to stand on the planet.
#include <meadow_noise>

uniform vec4 uBackFrame;    // the frame's aspect, -, the mist's drift, how much of the backdrop shows
uniform vec4 uTowers[40];   // per tower: its middle across the frame, its foot and its top up it, its half-width at its foot (frame units)
uniform vec3 uMistLit;
uniform vec3 uMistShade;
uniform vec3 uMistDeep;
uniform vec3 uTowerNear;
uniform vec3 uTowerFar;

varying vec3 vRay;
varying vec2 vScreen;

void main() {
  if (uBackFrame.w <= 0.0) discard;
  vec2 p = vec2(vScreen.x * uBackFrame.x, vScreen.y);
  // the mist: slow puffs, paler where it heaps up, in bands that lie level
  vec2 q = p * vec2(1.6, 3.2) + vec2(uBackFrame.z, 0.0);
  float puff = 0.6 * gnoise(vec3(q, 0.0), 911u) + 0.4 * gnoise(vec3(q * 2.7 - vec2(uBackFrame.z * 1.7, 0.0), 1.0), 912u);
  vec3 col = mix(uMistShade, uMistLit, smoothstep(-0.3, 0.35, puff));
  col = mix(col, uMistDeep, smoothstep(0.05, -0.5, puff) * 0.3);
  // the towers, back to front: each a column rounding to its top, its sides wandering, lit on one side,
  // streaked down its face, the ranks behind paler and bluer, every foot sunk in the mist
  for (int i = 0; i < 40; i++) {
    vec4 t = uTowers[i];
    float rank = float(i / 14) / 2.0;
    float s = (p.y - t.y) / (t.z - t.y);
    if (s < 0.0 || s > 1.0) continue;
    float wander = 0.74 + 0.26 * gnoise(vec3(s * 3.5, t.x * 13.0, 2.0), 914u) + 0.08 * gnoise(vec3(s * 11.0, t.x * 7.0, 3.0), 916u);
    float half_ = t.w * sqrt(max(1.0 - pow(s, 2.2), 0.0)) * wander * mix(1.25, 1.0, smoothstep(0.0, 0.3, s));
    float dx = p.x - t.x;
    if (abs(dx) > half_) continue;
    float side = dx / max(half_, 1e-4);
    vec3 rock = mix(mix(uTowerFar, uMistShade, 0.35), uTowerNear, rank);
    // (lit from the left, its face streaked down in long strokes)
    rock *= 0.88 - 0.12 * side + 0.1 * gnoise(vec3(side * 5.0, s * 2.2, t.x * 9.0), 913u);
    // dark tufts of trees on its ledges and crown
    float tuft = smoothstep(0.55, 0.8, gnoise(vec3(dx * 40.0, p.y * 40.0, t.x), 915u)) * smoothstep(0.45, 0.9, s);
    rock = mix(rock, rock * 0.72, tuft);
    float foot = smoothstep(0.42, 0.0, s) * (0.6 + 0.4 * smoothstep(-0.2, 0.3, puff));
    col = mix(rock, col, foot);
  }
  gl_FragColor = vec4(col, uBackFrame.w);
}
