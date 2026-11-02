// The terraces' mist (mist.vert.glsl), painted as the blue-green landscape paints its ribbons of cloud (Kai's
// references, clouds-*): its strokes (mist.glsl) flat cream bodies, greyer toward their edges and finely outlined,
// translucent the thinner they are (Kai: "add some translucency to them, and vary based on width"), a little uneven
// as brushed; thinning where the ground comes up to the layer, so it lies round the hills, not through them. A little
// denser seen aslant, thinning round the camera; its underside greyer, its top as lit as the sun reaches it; paling
// with distance a third as fast as the land, and in the height fog.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <terraces_common>
#include <terraces_fog>
#include <terraces_mist>

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vUp;
varying float vHeight;

void main() {
  vec3 dir = normalize(vDir);
  vec2 s = mistStroke(dir);
  if (s.x < -0.5) discard;
  vec2 h = mistHeight(dir);
  vec3 p = dir * (uRadius + h.x);
  float fray = 0.3 * gnoise(p / 6.0, 0u);
  float clear = h.x - h.y;
  float body = mistBody(s.x, fray) * smoothstep(0.0, 0.8, clear);
  if (body < 0.003) discard;
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec3 up = normalize(vUp);
  float mu = abs(dot(v, up));
  float even = 0.92 + 0.08 * gnoise(p / 14.0, 2u);
  // (translucent by its breadth; a little denser seen aslant, but for where it meets a hillside)
  float alpha = body * even * min(mistOpacity(s.y) * mix(1.0, 1.25, (1.0 - mu) * smoothstep(1.0, 6.0, clear)), 0.94) * smoothstep(2.0, 10.0, dist);
  if (alpha < 0.004) discard;
  float above = smoothstep(-0.15, 0.15, dot(v, up));
  float sunUp = clamp(dot(up, uSunDir), 0.0, 1.0);
  vec3 col = mistColour(s.x, fray) * mix(0.86, 1.0, above) * mix(0.93, 1.03, sunUp);
  col = mix(col, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, dist - uFog.z) * uFog.x), uFog.w));
  col = applyHeightFog(col, dist, vHeight, dir);
  gl_FragColor = vec4(col * alpha, alpha);
}
