// The terraces' clouds (mist.ts): each stroke a ribbon (mistRibbons.ts) at its cloud's height over the layer's
// sphere, carried round with the wind, warped as everything on the planet is; painted by mist.frag.glsl.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_toon>
#include <terraces_common>
#include <terraces_mist>

attribute vec3 aRibbon; // how far inside its stroke's edge (m), its stroke's half-breadth there (m), its cloud's offset from the layer's sphere (m)
attribute vec2 aOwner;  // its chunk, its height's key

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vUp;
varying float vHeight;
varying vec2 vRibbon;
varying vec2 vOwner;

void main() {
  // (from the strokes' space to the planet's: the drift's turn)
  vec3 d = normalize(position * uMistDrift);
  float h = uMistLayer.x + aRibbon.z;
  vec3 p = d * (uRadius + h);
  vec3 w = warpPosition(p);
  vDir = d;
  vWarped = w;
  vUp = warpNormal(p, d);
  vHeight = h;
  vRibbon = aRibbon.xy;
  vOwner = aOwner;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
