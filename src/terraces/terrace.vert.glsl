// The terraces as built (terraceMesh.ts): planet-space geometry, warped as
// everything on the planet is. The paint (terrace.frag.glsl) reads what each
// vertex is (a floor, a riser, a bund, a skirt, a ridge) and its paddy.
#include <meadow_common>
#include <meadow_warp>
#include <meadow_noise>
uniform float uRadius;
#include <terraces_common>
#include <terraces_plots>
#include <terraces_paddy>

attribute float aPart;
attribute vec4 aPaddy; // its paddy's constants: colour, place in the season, its plants' and its water's own share
attribute vec4 aFloor; // its floor (m), fallow, share across its band, -

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy; // its crop now: colour, stage, plants' height (m), water depth (m)
varying vec4 vFloor;
varying float vHeight;

void main() {
  // a floor lies under its water, at its own level this season
  Crop c = cropFrom(aPaddy.x, aPaddy.y, aPaddy.z, aPaddy.w, aFloor.y);
  vec3 p = aPart < 0.5 ? position + normalize(position) * c.water : position;
  vec3 w = warpPosition(p);
  vDir = normalize(p);
  vWarped = w;
  vNormal = warpNormal(p, normal);
  vPart = aPart;
  vPaddy = vec4(c.variant, c.maturity, c.height, c.water);
  vFloor = aFloor;
  vHeight = length(p) - uRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
