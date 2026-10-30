// A cloud: its puffs traced along the view ray (clouds.glsl), a little paler
// and bluer far off. Writes the depth of its front, so hills in front of it
// hide it.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform mat4 uProjection; // projectionMatrix is not declared in fragment shaders
uniform float uPixelAngle;

varying vec3 vPoint;
flat varying vec4 vCloudA;
flat varying vec4 vCloudB;
flat varying vec4 vCloudC;
flat varying vec4 vPuffs[PUFFS];
flat varying vec4 vShadowA;
flat varying vec4 vShadowB;

void main() {
  vec3 rd = normalize(vPoint - cameraPosition);
  Cloud cl;
  cl.centre = vCloudA.xyz;
  cl.radius = vCloudA.w;
  cl.basePoint = vCloudB.xyz;
  cl.seed = uint(vCloudB.w);
  cl.baseNormal = vCloudC.xyz;
  cl.size = vCloudC.w;
  float t;
  vec4 c = shadeCloud(cl, vPuffs, vShadowA, vShadowB, cameraPosition, rd, false, uPixelAngle, t);
  if (c.a < 0.004) discard;
  vec3 p = cameraPosition + rd * t;
  // clouds pale toward the sky's haze, not the meadow's, and only a third as fast: they keep their form
  vec3 col = mix(c.rgb / c.a, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, t - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * c.a, c.a);
  vec4 clip = uProjection * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
