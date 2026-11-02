// Painted sky: deep clear blue overhead, paling to a soft haze at the horizon.
// Two framings, blended by uDome: the backdrop behind the whole planet
// (Overview) and the dome around a viewer standing in the meadow (Wander).
// The clouds are their own billboards (clouds.ts), drawn over it.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunGlow;
uniform vec3 uSkyUp;
uniform vec3 uSun;
uniform float uDome;
uniform float uSnowAmount;

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
  // Bokashi pigment reaches a visible blue above the low snowy horizon.
  vec3 dome = mix(skyGradient(e * 3.4 + 0.12), uHaze, smoothstep(0.025, -0.12, e));

  vec3 col = mix(backdrop, dome, uDome);
  col = mix(col * vec3(0.80,0.89,0.98) + vec3(0.035), col, uSnowAmount);
  // A quiet pigment gradient rather than a photometric sun disc.
  gl_FragColor = vec4(col, 1.0);
}
