#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_clouds>
varying vec3 vPlanet;
varying vec3 vWorld;
varying vec3 vPlanetNormal;
varying vec3 vColour;
varying float vKind;
varying vec2 vUv;
varying vec3 vLocal;

float pencilLine(float x, float width, float footprint) {
  return 1.0 - smoothstep(width, width + footprint, abs(x));
}

void main() {
  // Derivatives are unconditional: frozen frames remain defined and deterministic.
  vec2 uvPixel = max(fwidth(vUv), vec2(0.0008));
  float coatCoord = vUv.y * 37.0 + vUv.x * 6.0;
  float coatPixel = max(fwidth(coatCoord), 0.001);
  float veinCoord = vUv.y * 8.0 - abs(vUv.x - 0.5) * 5.0;
  float veinPixel = max(fwidth(veinCoord), 0.001);
  float distanceToEye = distance(cameraPosition, vWorld);
  float presence = 1.0 - smoothstep(70.0, 100.0, distanceToEye);
  float door = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
  if (door > presence) discard;
  vec3 n = normalize(vPlanetNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 dir = normalize(vPlanet), lightDir = localSun(dir);
  float shade = cloudShadowAt(vPlanet, 0.0) * 0.3;
  float light = toonLight(dot(n, lightDir)) * (1.0 - shade);
  vec3 base = vColour;
  float marks = 0.0;
  float detail = 1.0 - smoothstep(7.0, 24.0, distanceToEye);
  if (vKind < 0.5) {
    float shortStroke = pencilLine(fract(coatCoord) - 0.5, 0.035, coatPixel);
    marks = shortStroke * (0.5 + 0.5 * sin(vUv.x * 129.0)) * 0.095 * detail;
  } else if (vKind < 1.5 || vKind > 3.5) {
    float midrib = pencilLine(vUv.x - 0.5, 0.012, uvPixel.x);
    float veins = pencilLine(fract(veinCoord) - 0.5, 0.025, veinPixel);
    marks = (midrib * 0.2 + veins * 0.075) * detail;
    light = max(light, 0.42 + max(dot(-n, lightDir), 0.0) * 0.16);
  }
  vec3 view = normalize(cameraPosition - vWorld);
  float contour = 1.0 - smoothstep(0.02, 0.14, abs(dot(warpNormal(vPlanet, n), view)));
  base *= 1.0 - marks - contour * 0.15;
  vec3 col = tone3(base * 1.04, base * 0.96, base * vec3(0.64, 0.65, 0.79), light);
  if (vKind > 1.5 && vKind < 2.5) col = base * (0.94 + 0.06 * light);
  gl_FragColor = vec4(applyAerial(col, distanceToEye, dir), 1.0);
}
