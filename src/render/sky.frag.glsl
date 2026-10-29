// Painted sky: deep clear blue overhead, paling to a soft haze at the horizon.
// Two framings, blended by uDome: the backdrop behind the whole planet
// (Overview) and the dome around a viewer standing in the meadow (Wander).
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSkyUp;
uniform float uDome;

varying vec3 vRay;
varying vec2 vScreen;

// h: 0 at the horizon → 1 at the zenith.
vec3 skyGradient(float h) {
  return mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.62));
}

void main() {
  // Backdrop: the frame itself is the sky; a pale band settles at the bottom.
  float y = vScreen.y * 0.5 + 0.5;
  vec3 backdrop = skyGradient(smoothstep(0.06, 1.04, y));
  backdrop = mix(backdrop, uHaze, smoothstep(0.34, 0.0, y) * 0.6);

  // Dome: elevation of the view ray above the local horizon.
  float e = dot(normalize(vRay), uSkyUp);
  vec3 dome = mix(skyGradient(e * 1.35), uHaze, smoothstep(0.08, -0.1, e));

  gl_FragColor = vec4(mix(backdrop, dome, uDome), 1.0);
}
