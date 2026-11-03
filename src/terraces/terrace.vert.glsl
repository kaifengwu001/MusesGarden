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
uniform vec4 uHutSite;     // Muse's hut (hut.ts): its site's up, its floor's radius (m; 0: none)
uniform vec4 uHutX;        // its x way (along its hall)
uniform vec4 uHutZ;        // its z way (out to its gate)
uniform vec4 uHutRects[2]; // its footing (m, its frame): x0, x1, z0, z1

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy; // its crop now: colour, stage, plants' height (m), water depth (m)
varying vec4 vFloor;
varying float vHeight;

void main() {
  // (a floor stays at its band's level, the water on it a look of the paint: raised by its water a flooded paddy
  // stood over its own dam and apart from the paddy beside it, open between)
  Crop c = cropFrom(aPaddy.x, aPaddy.y, aPaddy.z, aPaddy.w, aPart < 0.5 ? aFloor.y : 0.0);
  vec3 p = position;
  // (none of it over Muse's hut's floor within its footing: sunk a little under its paving)
  vec3 d = normalize(p);
  float f = dot(d, uHutSite.xyz);
  if (uHutSite.w > 0.0 && f > 0.9) {
    vec2 q = vec2(dot(d, uHutX.xyz), dot(d, uHutZ.xyz)) * (uHutSite.w / f);
    for (int i = 0; i < 2; i++) {
      vec4 r = uHutRects[i];
      if (q.x > r.x && q.x < r.y && q.y > r.z && q.y < r.w) p = d * min(length(p), uHutSite.w - 0.25);
    }
  }
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
