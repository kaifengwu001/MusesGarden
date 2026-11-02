#include <meadow_common>
#include <meadow_noise>
uniform float uCirrusOpacity;
uniform sampler2D uCirrusDepth;
uniform vec2 uCirrusDepthSize;
// Ordinary interpolation shades this soft layer at pixel centres.
varying vec3 vRibbon;
flat varying float vCloudPhase;
varying float vCloudDistance;
void main() {
  // The cirrus pass runs after the opaque scene's MSAA colour/depth resolve.
  // It uses the same camera and viewport; depth prevents far-side clouds
  // showing through the planet while keeping the soft cloud layer single-sample.
  float groundDepth = texture2D(uCirrusDepth, gl_FragCoord.xy / uCirrusDepthSize).r;
  if (gl_FragCoord.z > groundDepth) discard;
  float t = clamp(vRibbon.x, 0.0, 1.0);
  float side = clamp(vRibbon.y, -1.0, 1.0);
  float phase = vCloudPhase;
  // A soft continuous cloud body with irregular shoulders and fine wisps.
  // Fibre contrast stays low so the band never resolves as parallel wires.
  float ragged = gnoise(vec3(t * 19.0, side * 2.7, phase), 711u);
  float curl = gnoise(vec3(t * 6.0, phase, 2.0), 719u) * 0.24;
  float edge = 1.0 - smoothstep(0.06, 1.0, abs(side + curl) + ragged * 0.42);
  float ends = smoothstep(0.0, 0.17, t) * (1.0 - smoothstep(0.73, 1.0, t));
  float fibre = 0.94 + 0.06 * gnoise(vec3(t * 5.0, side * 13.0, phase), 723u);
  float wisps = smoothstep(-0.55, 0.18, gnoise(vec3(t * 7.0, side * 1.6, phase + 9.0), 717u));
  float alpha = edge * ends * fibre * wisps * uCirrusOpacity;
  alpha *= smoothstep(4.0, 16.0, vCloudDistance);
  // Soft ivory light with a little lilac, distinct against violet terrain.
  vec3 colour = mix(vec3(0.72, 0.66, 0.82), vec3(0.98, 0.92, 0.88), 0.74 + 0.14 * side);
  gl_FragColor = vec4(colour * alpha, alpha);
}
