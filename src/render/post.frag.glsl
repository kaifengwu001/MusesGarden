// Final grade: painterly tone curve and highlight bloom, then the output
// transform, the grade in display space (contrast about mid grey, then
// brightness), then paper grain.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uGrain;
uniform vec2 uGrade; // contrast, brightness
// the part of each target the frame was drawn into (uv, the render scale's), and the farthest a lookup may reach
uniform vec4 uSceneExtent;
uniform vec4 uBloomExtent;

varying vec2 vUv;

#include <meadow_common>

// A gentle S-curve with a soft shoulder above 0.85 (glints and snow roll off
// instead of clipping) and a touch more saturation, like gouache.
vec3 toneCurve(vec3 c) {
  vec3 over = max(c - 0.85, 0.0);
  c = c - over + over / (1.0 + over * 2.2);
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, 0.18);
  float l = luma(c);
  return max(mix(vec3(l), c, 1.07), 0.0);
}

void main() {
  vec3 color = texture2D(tScene, min(vUv * uSceneExtent.xy, uSceneExtent.zw)).rgb;
  color += texture2D(tBloom, min(vUv * uBloomExtent.xy, uBloomExtent.zw)).rgb * uBloom;
  color = toneCurve(color);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb = clamp((gl_FragColor.rgb - 0.5) * uGrade.x + 0.5, 0.0, 1.0) * uGrade.y;

  // Paper grain in display space: fine fibre noise plus a coarser tooth,
  // fixed to the screen like the sheet under a painting, so it never shimmers.
  vec2 p = gl_FragCoord.xy;
  float fibre = hash12(p) - 0.5;
  float tooth = hash12(floor(p / 3.0) + 17.0) - 0.5;
  gl_FragColor.rgb += (fibre * 0.7 + tooth * 0.3) * 2.0 * uGrain;
}
