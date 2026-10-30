// A bird's shadow (birds.ts): a small soft disc where its shadow reaches the
// water table, down the sun its place sees, splatted into the clouds' shadow
// map a face (or the window of one) at a time (cloudShadow.vert.glsl).
#include <meadow_sun>
uniform float uRadius;
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;
attribute vec3 aPos;
attribute vec4 aWing; // -, -, -, size (× the mesh)
varying vec2 vOff;

void main() {
  vOff = position.xy;
  vec3 L = localSun(normalize(aPos));
  float cl = dot(aPos, L);
  vec3 centre = aPos - L * (cl - sqrt(max(cl * cl - dot(aPos, aPos) + uRadius * uRadius, 0.0)));
  vec3 g = normalize(centre);
  vec3 a = normalize(cross(g, abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(g, a);
  vec3 corner = centre + (a * position.x + b * position.y) * 0.42 * aWing.w;
  vec3 f = corner * uCubeFace;
  gl_Position = vec4((f.xy - uFaceWindow.xy * f.z) * uFaceWindow.z, 0.0, f.z);
}
