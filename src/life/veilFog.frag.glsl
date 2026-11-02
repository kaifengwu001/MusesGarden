// The veil as ground fog (veil.ts, veilFog.ts): a layer on the meadow wherever
// the unfolding has yet to clear it, dense at the ground and thinning upward
// to a top that lies in banks, wisps on it, and comes down to the ground at
// its edge. Marched along the view ray (in view space, each sample unwarped
// onto the planet) until it meets the ground or leaves the layer, or the fog
// has hidden what lies behind. Lit pale on top and grey-blue in its depths,
// the drifting clouds' shadows on it; it writes the depth of its front, so
// what stands in front of it hides it. The lakes do not mirror it: it covers
// the lakes it lies on.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform samplerCube uVeilField; // the turn, the bank's height 0..1, the wisps 0..1 (veilField.frag.glsl)
uniform vec4 uVeil;      // the turn below which it is clear, the edge's softness (turns), how high the layer reaches over the water table (m), -
uniform vec4 uVeilShape; // the top of its lowest banks and of its highest (m over the ground), its density at the ground (1/m), the wisps' reach (m)
uniform mat4 uProjection; // projectionMatrix is not declared in fragment shaders

varying vec3 vRay;

void main() {
  vec3 rd = normalize(vRay);
  vec3 ro = cameraPosition;
  float far = length(ro) + 2.0 * uRadius;
  float t = 0.0;
  // from high up (no warp there), where the view comes down into the layer; missing it, the sky
  if (abs(uWarpK) * uRadius < 0.01) {
    float shell = uRadius + uVeil.z;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - shell * shell;
    if (c > 0.0) {
      float disc = b * b - c;
      if (disc <= 0.0 || b > 0.0) discard;
      t = -b - sqrt(disc);
    }
  }
  float reach = uVeilShape.y + uVeilShape.w;
  float turn = uVeil.x;
  float edge = uVeil.y;
  // (each pixel starts a little further along, so the steps leave no bands)
  t += 0.4 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float seen = 1.0; // what the fog has left of what lies behind it
  vec3 col = vec3(0.0);
  float front = -1.0;
  float shade = 1.0; // the light where the fog begins: its bank's slope to the sun, the drifting clouds' shadow
  vec3 low = mix(pal(ROW_CLOUD, 1), pal(ROW_CLOUD, 4), 0.2);
  for (int i = 0; i < 80; i++) {
    if (t > far) break;
    vec3 p = unwarpPosition(ro + rd * t);
    float r = length(p);
    vec3 dir = p / r;
    float h = r - uRadius - max(height0(dir), 0.0);
    // the ground, or the water, hides the rest
    if (h < 0.0) break;
    if (h > reach) {
      // up and out of the layer, or down toward it
      if (dot(dir, rd) > 0.0) break;
      t += max(h - reach, 0.5);
      continue;
    }
    vec4 f = textureLod(uVeilField, dir, 0.0);
    float cover = smoothstep(turn - edge, turn + edge, f.r);
    if (cover <= 0.0) {
      // in the clearing: on toward its edge (a turn grows about as fast as the angle from the hut)
      t += clamp((turn - edge - f.r) * uRadius * 0.6, 0.4, 24.0);
      continue;
    }
    // its top here: its bank, coming down toward its edge, ragged with wisps
    float span = uVeilShape.y - uVeilShape.x;
    float top = (uVeilShape.x + span * f.g) * (0.35 + 0.65 * cover) + uVeilShape.w * (2.0 * f.b - 1.0);
    float dt = clamp(0.3 + 0.025 * t, 0.3, 2.5);
    if (h >= top) {
      t += max(h - top, dt);
      continue;
    }
    // dense at the ground, thinning over the upper half
    float rho = uVeilShape.z * cover * (1.0 - smoothstep(0.45 * top, top, h));
    // (going down, the step ends at the ground: the fog meets it smoothly, in no steps)
    float down = -dot(dir, rd);
    float step_ = down > 1e-3 ? min(dt, h / down) : dt;
    float a = 1.0 - exp(-rho * step_);
    if (front < 0.0) {
      front = t;
      // the bank's surface here, lit as it slopes to the sun this place sees (its slope from the field's banks)
      vec3 ga, gb;
      gradientFrame(dir, ga, gb);
      float e = 2.0 / uRadius;
      vec2 slope = vec2(textureLod(uVeilField, normalize(dir + ga * e), 0.0).g - f.g, textureLod(uVeilField, normalize(dir + gb * e), 0.0).g - f.g) * span / 2.0;
      vec3 n = normalize(dir - ga * slope.x - gb * slope.y);
      // (its crests catch more of the light than the hollows between its banks)
      shade = (0.62 + 0.38 * smoothstep(-0.2, 0.7, dot(n, localSun(dir)))) * mix(0.84, 1.0, f.g);
      // the drifting clouds' shadows, where the light comes in at its top, softened by the fog
      shade *= 1.0 - 0.55 * cloudShadowAt(dir * (r - h + top), 0.0);
    }
    // pale on top in the sun, grey-blue down in it (the fog above shades it)
    float sun = exp(-0.35 * uVeilShape.z * (top - h)) * shade;
    col += seen * a * mix(low, pal(ROW_CLOUD, 0), sun);
    seen *= 1.0 - a;
    if (seen < 0.02 || step_ < dt) break;
    t += dt;
  }
  float alpha = 1.0 - seen;
  if (alpha < 0.004) discard;
  vec3 c = col / alpha;
  // farther off it pales toward the sky's haze, as the clouds do
  c = mix(c, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, front - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(c * alpha, alpha);
  vec4 clip = uProjection * viewMatrix * vec4(ro + rd * front, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
