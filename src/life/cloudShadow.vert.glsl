// Cloud shadow map (clouds.ts): every puff splatted as a disc into an
// orthographic view down the sun, planet space. Adds up optical depth.
uniform highp sampler2D uCloudData;
uniform vec4 uCloudSunA; // axis A, 1 / half-extent (1/m)
uniform vec4 uCloudSunB; // axis B
uniform vec4 uCloudLook; // -, -, clouds, -

varying vec2 vOff;
varying float vRadius;

void main() {
  int row = gl_InstanceID / 8;
  int k = gl_InstanceID - row * 8;
  vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
  vOff = position.xy;
  vRadius = puff.w;
  if (row >= int(uCloudLook.z) || puff.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 s = vec2(dot(puff.xyz, uCloudSunA.xyz), dot(puff.xyz, uCloudSunB.xyz)) + position.xy * puff.w;
  gl_Position = vec4(s * uCloudSunA.w, 0.0, 1.0);
}
