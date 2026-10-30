// Cloud shadow map (clouds.ts): every puff splatted as a disc into an
// orthographic view down the sun, planet space. Adds up optical depth. The
// map has no depth, so only puffs on the sunlit half of the planet go in:
// one on the night side would shade the sunlit ground on the far side of
// the planet from it (and that phantom moves the wrong way as the globe turns).
#include <meadow_noise>
#include <meadow_cloud_lumps>
uniform highp sampler2D uCloudData;
uniform vec4 uCloudSunA; // axis A, 1 / half-extent (1/m)
uniform vec4 uCloudSunB; // axis B
uniform vec4 uCloudLook; // -, -, -, all clouds

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;
flat varying float vLit;

void main() {
  int row = gl_InstanceID / 8;
  int k = gl_InstanceID - row * 8;
  vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
  vOff = position.xy * (1.0 + 1.5 * CLOUD_LUMPS);
  vRadius = puff.w;
  vSeed = lumpSeed(uint(texelFetch(uCloudData, ivec2(2, row), 0).x), k);
  vLit = smoothstep(-0.04, 0.04, dot(normalize(puff.xyz), cross(uCloudSunA.xyz, uCloudSunB.xyz)));
  if (row >= int(uCloudLook.w) || puff.w <= 0.0 || vLit <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 s = vec2(dot(puff.xyz, uCloudSunA.xyz), dot(puff.xyz, uCloudSunB.xyz)) + vOff * puff.w;
  gl_Position = vec4(s * uCloudSunA.w, 0.0, 1.0);
}
