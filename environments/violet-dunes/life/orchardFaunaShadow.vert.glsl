#include <meadow_sun>
uniform float uRadius;
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 light = localSun(normalize(p));
  float cl = dot(p, light);
  vec3 g = p - light * (cl - sqrt(max(cl * cl - dot(p, p) + uRadius * uRadius, 0.0)));
  vec3 face = g * uCubeFace;
  gl_Position = vec4((face.xy - uFaceWindow.xy * face.z) * uFaceWindow.z, 0.0, face.z);
}
