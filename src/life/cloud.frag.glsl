// Cloud shading: the same soft toon bands as the ground, lit white on top,
// blue-grey underneath, a bright rim toward the sun, softened by the haze.
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>

varying vec3 vNormal;
varying vec3 vWorld;
varying float vBase;

void main() {
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWorld;
  vec3 v = normalize(toCam);
  float b = toonLight(dot(n, uSunDir) * 0.85 + 0.15) * mix(0.55, 1.0, vBase);
  vec3 col = tone3(pal(ROW_CLOUD, 0), pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 1), b);
  col = mix(col, pal(ROW_CLOUD, 4), (1.0 - vBase) * 0.25);
  col += pal(ROW_CLOUD, 3) * sunRim(n, v) * 0.35;
  gl_FragColor = vec4(applyAerial(col, length(toCam), normalize(vWorld)), 1.0);
}
