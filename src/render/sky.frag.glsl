// Painted sky: deep clear blue overhead, paling to a soft haze at the horizon.
// Two framings, blended by uDome: the backdrop behind the whole planet
// (Overview) and the dome around a viewer standing in the meadow (Wander),
// where the high cloud deck drifts over (the clouds whose shadows cross the
// meadow and whose shapes the lakes mirror).
#include <meadow_noise>
uniform float uRadius;
uniform uint uTerrainSeed;
uniform vec4 uWindVec;
#include <meadow_clouds_shadow>
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunGlow;
uniform vec3 uSkyUp;
uniform vec3 uSun;
uniform float uDome;

varying vec3 vRay;
varying vec2 vScreen;

// h: 0 at the horizon → 1 at the zenith.
vec3 skyGradient(float h) {
  return mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.62));
}

void main() {
  vec3 dir = normalize(vRay);
  // Backdrop: the frame itself is the sky; a pale band settles at the bottom.
  float y = vScreen.y * 0.5 + 0.5;
  vec3 backdrop = skyGradient(smoothstep(0.06, 1.04, y));
  backdrop = mix(backdrop, uHaze, smoothstep(0.34, 0.0, y) * 0.6);

  // Dome: elevation of the view ray above the local horizon.
  float e = dot(dir, uSkyUp);
  vec3 dome = mix(skyGradient(e * 1.35), uHaze, smoothstep(0.08, -0.1, e));

  // the deck, seen from the meadow: bright rims, greyer middles, lost in the haze low down
  if (uDome > 0.01 && e > -0.05) {
    float c = deckSeen(cameraPosition, dir);
    vec3 cloud = mix(uCloudLit, mix(uCloudLit, uCloudShade, 0.55), smoothstep(0.35, 1.0, c));
    dome = mix(dome, cloud, c * smoothstep(-0.02, 0.25, e) * 0.94);
  }

  vec3 col = mix(backdrop, dome, uDome);
  float s = max(dot(dir, uSun), 0.0);
  col += uSunGlow * (pow(s, 6.0) * 0.16 + pow(s, 48.0) * 0.3) * mix(0.5, 1.0, uDome);
  col = mix(col, uSunGlow * 1.5, smoothstep(0.99955, 0.9998, s) * uDome);
  gl_FragColor = vec4(col, 1.0);
}
