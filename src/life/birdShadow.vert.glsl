// A bird's shadow (birds.ts): its silhouette seen from above, turned with
// its heading, where its shadow reaches the water table down the sun its
// place sees, splatted into the clouds' shadow map a face (or the window of
// one) at a time (cloudShadow.vert.glsl). A flat shape held level casts a
// shadow of its own size, so it is only moved, not stretched.
#include <meadow_sun>
uniform float uRadius;
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;
attribute vec3 aPos;
attribute vec4 aFrame; // heading (unit tangent), bank (rad)
attribute vec4 aWing;  // wingbeat phase (rad), beat (rad), dihedral (rad), size (× the mesh)
varying vec2 vOff;     // across the quad (−1..1): the bird mesh's x over HALF.x, z over HALF.y
flat varying vec2 vSpread; // how far the inner and outer wing reach out, seen from above (cos of their angle)

// The quad's half sizes in the bird mesh's units (birds.ts birdGeometry: half span 0.48, nose 0.17, tail 0.21).
const vec2 HALF = vec2(0.5, 0.21);

void main() {
  vOff = position.xy;
  // the wings' angle now (as bird.vert.glsl turns them): seen from above they reach out by its cosine
  float shoulder = aWing.z + aWing.y * sin(aWing.x);
  float elbow = 0.6 * aWing.y * sin(aWing.x - 0.9);
  vSpread = vec2(cos(shoulder), cos(shoulder + elbow));
  vec3 L = localSun(normalize(aPos));
  float cl = dot(aPos, L);
  vec3 centre = aPos - L * (cl - sqrt(max(cl * cl - dot(aPos, aPos) + uRadius * uRadius, 0.0)));
  vec3 g = normalize(centre);
  vec3 fwd = aFrame.xyz - g * dot(aFrame.xyz, g);
  fwd = dot(fwd, fwd) > 1e-8 ? normalize(fwd) : normalize(cross(g, abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(fwd, g);
  // (the body's middle is a little behind its origin: nose 0.17, tail 0.21)
  vec3 corner = centre + (right * position.x * HALF.x + fwd * (position.y * HALF.y - 0.02)) * aWing.w;
  vec3 f = corner * uCubeFace;
  gl_Position = vec4((f.xy - uFaceWindow.xy * f.z) * uFaceWindow.z, 0.0, f.z);
}
