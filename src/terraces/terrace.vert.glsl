// The terraces as built (terraceMesh.ts): planet-space geometry, warped as
// everything on the planet is. The paint (terrace.frag.glsl) reads what each
// vertex is (a floor, a riser, a bund, a skirt, a ridge) and its paddy.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute float aPart;
attribute vec4 aPaddy; // its paddy's colour, stage, plants' height (m), water depth (m)
attribute vec4 aFloor; // its floor (m), fallow, share across its band, -

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy;
varying vec4 vFloor;
varying float vHeight;

void main() {
  vec3 w = warpPosition(position);
  vDir = normalize(position);
  vWarped = w;
  vNormal = warpNormal(position, normal);
  vPart = aPart;
  vPaddy = aPaddy;
  vFloor = aFloor;
  vHeight = length(position) - uRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
