// One puff's optical depth along the light: its chord, with the same lumpy
// outline the cloud is drawn with (cloudLumps.glsl), so the shadow (or the
// cover seen from below) has the cloud's shape; antialiased at the outline.
#include <meadow_noise>
#include <meadow_cloud_lumps>

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;
flat varying vec3 vSideA;
flat varying vec3 vSideB;

void main() {
  float q = length(vOff);
  // a texel of the map, in q: the outline eases out over a texel and a half,
  // so a drifting shadow slides smoothly through the texels (a hard outline
  // flips each texel it crosses from clear to full shadow, and steps)
  float aa = max(fwidth(q), 1e-4);
  if (q >= 1.0 + 1.5 * CLOUD_LUMPS + 0.75 * aa) discard;
  float rl = 1.0;
  if (q > 1.0 - CLOUD_LUMPS - 0.75 * aa) rl += CLOUD_LUMPS * puffLumps(normalize(vOff.x * vSideA + vOff.y * vSideB), vSeed);
  float cover = clamp((rl - q) / (1.5 * aa) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  float inner = min(q, rl - 0.75 * aa);
  gl_FragColor = vec4(2.0 * vRadius * sqrt(max(rl * rl - inner * inner, 0.0)) * cover, 0.0, 0.0, 1.0);
}
