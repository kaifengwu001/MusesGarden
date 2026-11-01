// Muse's shadow (muse.ts): its skin, skinned and set down as Muse is drawn,
// each point carried on down the sun its place sees to the water table and
// splatted into the clouds' shadow map a face (or the window of one) at a
// time (cloudShadow.vert.glsl), as the birds are. The ground reads it
// directly, the grass and the flowers through the field map.
#include <meadow_sun>
uniform float uRadius;
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;

#define MUSE_JOINTS 13
uniform mat4 uBones[MUSE_JOINTS];
uniform vec3 uMusePos;
uniform mat3 uMuseFrame;
uniform vec4 uMuseSize;

attribute vec4 skinIndex;
attribute vec4 skinWeight;

void main() {
  mat4 skin = uBones[int(skinIndex.x)] * skinWeight.x + uBones[int(skinIndex.y)] * skinWeight.y
    + uBones[int(skinIndex.z)] * skinWeight.z + uBones[int(skinIndex.w)] * skinWeight.w;
  vec3 p = uMusePos + uMuseFrame * ((skin * vec4(position, 1.0)).xyz * uMuseSize.x);
  vec3 L = localSun(normalize(uMusePos));
  float cl = dot(p, L);
  vec3 g = p - L * (cl - sqrt(max(cl * cl - dot(p, p) + uRadius * uRadius, 0.0)));
  vec3 f = g * uCubeFace;
  gl_Position = vec4((f.xy - uFaceWindow.xy * f.z) * uFaceWindow.z, 0.0, f.z);
}
