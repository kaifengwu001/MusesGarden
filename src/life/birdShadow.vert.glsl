// A bird's shadow (birds.ts): a small disc in the clouds' sun-space map.
uniform vec4 uCloudSunA; // axis A, 1 / half-extent (1/m)
uniform vec4 uCloudSunB; // axis B
attribute vec3 aPos;
attribute vec4 aWing;    // -, -, -, size (× the mesh)
varying vec2 vOff;

void main() {
  vOff = position.xy;
  // only on the sunlit half (see cloudShadow.vert.glsl)
  if (dot(aPos, cross(uCloudSunA.xyz, uCloudSunB.xyz)) <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 s = vec2(dot(aPos, uCloudSunA.xyz), dot(aPos, uCloudSunB.xyz)) + position.xy * 0.42 * aWing.w;
  gl_Position = vec4(s * uCloudSunA.w, 0.0, 1.0);
}
