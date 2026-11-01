#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
uniform float uSceneryTime;
uniform vec4 uWindVec;
#ifdef HAMLET_SHADOW
#include <meadow_sun>
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;
#endif
attribute float aKind;
attribute float aGround;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vVariation;

vec3 hamletRotate(vec3 value, vec3 axis, float angle) {
  return value * cos(angle) + cross(axis, value) * sin(angle) + axis * dot(axis, value) * (1.0 - cos(angle));
}

void main() {
  vec3 up0 = normalize(aAnchor.xyz);
  vec3 across = normalize(aAcross);
  vec3 forward = normalize(cross(across, up0));
  vec3 p = position * aPlacement.x;
  // Subtle whole-branch motion keeps the snow, ink and needles attached.
  // Reeds bend more; the solid tree trunk stays still at ground level.
  float bend = 0.007 * aPlacement.w;
  float sway = sin(uSceneryTime * 0.48 + aPlacement.y + position.y * 0.17) * bend * uWindVec.w * max(position.y, 0.0);
  vec3 breeze = cross(uWindVec.xyz, up0);
  p.xz += vec2(dot(breeze, across), dot(breeze, forward)) * sway * aPlacement.x;
  float distanceXZ = length(p.xz);
  float angle = asin(min(distanceXZ / uRadius, 0.9));
  vec3 tangent = distanceXZ > 0.00001 ? (across * p.x + forward * p.z) / distanceXZ : across;
  vec3 axis = normalize(cross(up0, tangent));
  vec3 up = up0 * cos(angle) + tangent * sin(angle);
  float height = aAnchor.w + p.y;
  // Only the bottom ring conforms to the true terrain. Rock caps, branches
  // and attached snow retain their authored shape on sloping banks.
  if (aGround > 0.5) {
    Ground ground = sampleGround(up);
    height = ground.height - ground.depth - 0.10;
  }
  vec3 planet = up * (uRadius + height);
  vec3 normalPlanet = hamletRotate(normalize(across * normal.x + up0 * normal.y + forward * normal.z), axis, angle);
  vPlanet = planet;
  vPlanetNormal = normalPlanet;
  vWorld = warpPosition(planet);
  vLocal = position;
  vKind = aKind;
  vVariation = aPlacement.z;
#ifdef HAMLET_SHADOW
  vec3 L = localSun(up0);
  float cl = dot(planet, L);
  vec3 projected = planet - L * (cl - sqrt(max(cl * cl - dot(planet, planet) + uRadius * uRadius, 0.0)));
  vec3 face = projected * uCubeFace;
  gl_Position = vec4((face.xy - uFaceWindow.xy * face.z) * uFaceWindow.z, 0.0, face.z);
#else
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
#endif
}
