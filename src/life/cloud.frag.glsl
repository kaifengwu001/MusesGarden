// A cloud: its puffs traced along the view ray (clouds.glsl), softened by the
// haze. Writes the depth of its front, so hills in front of it hide it.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform mat4 uProjection; // projectionMatrix is not declared in fragment shaders

varying vec3 vPoint;
flat varying int vRow;

void main() {
  vec3 rd = normalize(vPoint - cameraPosition);
  float t;
  vec4 c = shadeCloud(vRow, cameraPosition, rd, t);
  if (c.a < 0.004) discard;
  vec3 p = cameraPosition + rd * t;
  // clouds pale toward the sky's haze, not the meadow's, and only half as fast
  vec3 col = mix(c.rgb / c.a, aerialColor(), 0.5 * min(1.0 - exp(-max(0.0, t - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * c.a, c.a);
  vec4 clip = uProjection * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
