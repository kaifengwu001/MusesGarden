// Rose daylight with high, feathered cirrus. These distant ice-cloud washes
// belong to the sky dome; optional low clouds retain their own geometry.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunGlow;
uniform vec3 uSkyUp;
uniform vec3 uSun;
uniform vec3 uSkyGrain;
uniform vec3 uCloudTint;
uniform float uDome;
varying vec3 vRay;
varying vec2 vScreen;

#include <meadow_noise>

vec3 skyGradient(float h) {
  return mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.62));
}

void main() {
  vec3 dir = normalize(vRay);
  float y = vScreen.y * 0.5 + 0.5;
  vec3 backdrop = skyGradient(smoothstep(0.06, 1.04, y));
  backdrop = mix(backdrop, uHaze, smoothstep(0.34, 0.0, y) * 0.6);
  float e = dot(dir, uSkyUp);
  vec3 dome = mix(skyGradient(e * 1.35), uHaze, smoothstep(0.08, -0.1, e));
  vec3 col = mix(backdrop, dome, uDome);

  // Stretch the field with the same grain axis as the world's wind-worked
  // dunes. Two frequencies leave torn edges and fine dry-pencil filaments.
  vec3 p = dir * 2.3 + uSkyUp * e * 78.0;
  p += uSkyGrain * dot(dir, uSkyGrain) * 0.65;
  float coarse = gnoise(p, 817u);
  float fibre = gnoise(p * 3.7, 829u);
  float cirrus = smoothstep(0.12, 0.36, coarse + fibre * 0.12);
  float visible = smoothstep(-0.025, 0.08, e) * (1.0 - smoothstep(0.65, 0.95, e));
  // From orbit the high clouds are a quiet atmospheric backdrop, leaving
  // the complete little planet readable against the rose paper.
  float coverage = cirrus * visible * mix(0.11, 0.5, uDome);
  col = mix(col, uCloudTint, coverage);
  col = mix(col, uHaze, smoothstep(0.24, 0.44, coarse + fibre * 0.07) * visible * mix(0.06, 0.24, uDome));

  float s = max(dot(dir, uSun), 0.0);
  col += uSunGlow * (pow(s, 6.0) * 0.10 + pow(s, 48.0) * 0.18) * mix(0.5, 1.0, uDome);
  col = mix(col, uSunGlow * 1.5, smoothstep(0.99955, 0.9998, s) * uDome);
  gl_FragColor = vec4(col, 1.0);
}
