// The terraces as built (build/construct.ts): planet-space geometry, warped
// as everything on the planet is. The paint (terrace.frag.glsl) reads what
// each vertex is (a floor, a riser, a dam, a ridge, earth, the woods' own
// ground) and its paddy.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <terraces_common>
#include <terraces_paddy>

attribute float aPart;
attribute vec4 aPaddy; // its paddy's constants: colour, place in the season, its plants' and its water's own share
attribute vec4 aFloor; // its floor or ground (m); fallow (the woods: their slope); its share across its band; meters from its bank

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy; // its crop now: colour, stage, plants' height (m), water depth (m)
varying vec4 vFloor;
varying float vHeight;

void main() {
  // a floor lies under its water, at its own level this season
  Crop c = cropFrom(aPaddy.x, aPaddy.y, aPaddy.z, aPaddy.w, aPart < 0.5 ? aFloor.y : 0.0);
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
