// Final grade: tone curve, then output transform, then paper grain.
uniform sampler2D tScene;
uniform float uGrain;

varying vec2 vUv;

#include <meadow_common>

// Placeholder until S2 tunes the painted tone curve against the reference.
vec3 toneCurve(vec3 c) {
  return c;
}

void main() {
  vec3 color = toneCurve(texture2D(tScene, vUv).rgb);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>

  // Paper grain in display space: fine fibre noise plus a coarser tooth,
  // fixed to the screen like the sheet under a painting, so it never shimmers.
  vec2 p = gl_FragCoord.xy;
  float fibre = hash12(p) - 0.5;
  float tooth = hash12(floor(p / 3.0) + 17.0) - 0.5;
  gl_FragColor.rgb += (fibre * 0.7 + tooth * 0.3) * 2.0 * uGrain;
}
