// One puff's optical depth toward the sun: its chord, with the same lumpy
// outline the cloud is drawn with (cloudLumps.glsl), so the shadow is the
// cloud's shape.
#include <meadow_noise>
#include <meadow_cloud_lumps>
uniform vec4 uCloudSunA; // axis A, 1 / half-extent (1/m)
uniform vec4 uCloudSunB; // axis B

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;

void main() {
  float q = length(vOff);
  if (q >= 1.0 + 1.5 * CLOUD_LUMPS) discard;
  float rl = 1.0;
  if (q > 1.0 - CLOUD_LUMPS) rl += CLOUD_LUMPS * puffLumps(normalize(vOff.x * uCloudSunA.xyz + vOff.y * uCloudSunB.xyz), vSeed);
  if (q >= rl) discard;
  gl_FragColor = vec4(2.0 * vRadius * sqrt(rl * rl - q * q), 0.0, 0.0, 1.0);
}
