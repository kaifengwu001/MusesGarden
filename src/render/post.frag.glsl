// Final grade: painterly tone curve and highlight bloom, then the output
// transform, then paper grain.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uGrain;

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
  vec3 color = texture2D(tScene, vUv).rgb;
  color += texture2D(tBloom, vUv).rgb * uBloom;
  color = toneCurve(color);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>

  // Paper grain in display space: fine fibre noise plus a coarser tooth,
  // fixed to the screen like the sheet under a painting, so it never shimmers.
  vec2 p = gl_FragCoord.xy;
  float fibre = hash12(p) - 0.5;
  float tooth = hash12(floor(p / 3.0) + 17.0) - 0.5;
  gl_FragColor.rgb += (fibre * 0.7 + tooth * 0.3) * 2.0 * uGrain;
}
