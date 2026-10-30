// One puff's optical depth along the radial line, with the lumpy outline the
// cloud is drawn with (as cloudShadow.frag.glsl does toward the sun).
#include <meadow_noise>
#include <meadow_cloud_lumps>

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;
flat varying vec3 vAxisA;
flat varying vec3 vAxisB;

void main() {
  float q = length(vOff);
  if (q >= 1.0 + 1.5 * CLOUD_LUMPS) discard;
  float rl = 1.0;
  if (q > 1.0 - CLOUD_LUMPS) rl += CLOUD_LUMPS * puffLumps(normalize(vOff.x * vAxisA + vOff.y * vAxisB), vSeed);
  if (q >= rl) discard;
  gl_FragColor = vec4(2.0 * vRadius * sqrt(rl * rl - q * q), 0.0, 0.0, 1.0);
}
