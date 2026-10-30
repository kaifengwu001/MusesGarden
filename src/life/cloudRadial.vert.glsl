// The clouds seen from the planet's centre (clouds.ts): every puff splatted
// as a disc facing the centre into a cube map, adding up its optical depth
// along the radial line. From orbit the lakes look their reflections up in
// it (cloudsFromOrbit, clouds.glsl).
#include <meadow_noise>
#include <meadow_cloud_lumps>
uniform highp sampler2D uCloudData;
uniform vec4 uCloudLook; // -, -, -, all clouds

varying vec2 vOff;
flat varying float vRadius;
flat varying uint vSeed;
flat varying vec3 vAxisA;
flat varying vec3 vAxisB;

void main() {
  int row = gl_InstanceID / 8;
  int k = gl_InstanceID - row * 8;
  vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
  vOff = position.xy * (1.0 + 1.5 * CLOUD_LUMPS);
  vRadius = puff.w;
  vSeed = lumpSeed(uint(texelFetch(uCloudData, ivec2(2, row), 0).x), k);
  vec3 n = normalize(puff.xyz);
  vAxisA = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vAxisB = cross(n, vAxisA);
  if (row >= int(uCloudLook.w) || puff.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 p = puff.xyz + (vAxisA * vOff.x + vAxisB * vOff.y) * puff.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
