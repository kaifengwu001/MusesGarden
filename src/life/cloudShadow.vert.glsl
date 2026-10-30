// Cloud shadow map (clouds.ts): every puff splatted as a disc into an
// orthographic view down the sun, planet space. Adds up optical depth.
#include <meadow_noise>
#include <meadow_cloud_lumps>
uniform highp sampler2D uCloudData;
uniform vec4 uCloudSunA; // axis A, 1 / half-extent (1/m)
uniform vec4 uCloudSunB; // axis B
uniform vec4 uCloudLook; // -, -, clouds, -

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;

void main() {
  int row = gl_InstanceID / 8;
  int k = gl_InstanceID - row * 8;
  vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
  vOff = position.xy * (1.0 + 1.5 * CLOUD_LUMPS);
  vRadius = puff.w;
  vSeed = lumpSeed(uint(texelFetch(uCloudData, ivec2(2, row), 0).x), k);
  if (row >= int(uCloudLook.z) || puff.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 s = vec2(dot(puff.xyz, uCloudSunA.xyz), dot(puff.xyz, uCloudSunB.xyz)) + vOff * puff.w;
  gl_Position = vec4(s * uCloudSunA.w, 0.0, 1.0);
}
