#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_sun>
#include <meadow_fog>
uniform float uSnowAmount;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vVariation;

vec3 hamletPigment(vec3 rgb) { return pow(rgb, vec3(2.2)); }

void main() {
  // Every snow blanket is independent geometry; the rain season reveals
  // the complete underlying needles, branches and slate.
  if (vKind > 4.5 && uSnowAmount < 0.5) discard;
#ifdef HAMLET_SHADOW
  gl_FragColor = vec4(1.6, 0.0, 0.0, 1.0);
  return;
#endif
  vec3 direction = normalize(vPlanet);
#ifdef HAMLET_INK
  vec3 ink = hamletPigment(vec3(0.12, 0.19, 0.22));
  if (vKind < 0.5) ink = hamletPigment(vec3(0.20, 0.17, 0.13));
  gl_FragColor = vec4(applyAerial(ink, distance(cameraPosition, vWorld), direction), 0.72);
#else
  vec3 normal = normalize(vPlanetNormal);
  if (!gl_FrontFacing) normal = -normal;
  float light = toonLight(dot(normal, localSun(direction)));
  vec3 base;
  float mark = 0.0;
  // Evaluate derivatives before material branches so frozen frames stay
  // deterministic even when an edge spans fragments of different materials.
  float grain = sin(vLocal.y * 1.5 + vLocal.x * 15.0 + vLocal.z * 11.0);
  float grainWidth = max(fwidth(grain), 0.02);
  float resolved = 1.0 - smoothstep(0.05, 0.17, length(fwidth(vLocal)));
  if (vKind < 0.5) {
    base = mix(hamletPigment(vec3(0.48, 0.35, 0.22)), hamletPigment(vec3(0.60, 0.44, 0.27)), vVariation * 0.45);
    mark = (1.0 - smoothstep(0.03, 0.03 + grainWidth, abs(grain))) * 0.11;
  } else if (vKind < 1.5) {
    base = mix(hamletPigment(vec3(0.17, 0.31, 0.29)), hamletPigment(vec3(0.25, 0.38, 0.32)), vVariation * 0.5);
  } else if (vKind < 2.5) {
    base = mix(hamletPigment(vec3(0.22, 0.31, 0.38)), hamletPigment(vec3(0.32, 0.39, 0.43)), vVariation * 0.55);
    // Small mineral inclusions occur on stone alone. No all-material noise film.
    float fleck = hash13(floor(vLocal * 13.0));
    base = mix(base, hamletPigment(vec3(0.62, 0.48, 0.30)), step(0.975, fleck) * resolved * 0.42);
  } else if (vKind < 3.5) {
    base = hamletPigment(vec3(0.73, 0.55, 0.28));
  } else if (vKind < 4.5) {
    base = hamletPigment(vec3(0.69, 0.26, 0.19));
  } else {
    // Warm paper-white light, a restrained indigo shadow; never glossy snow.
    base = hamletPigment(vec3(0.97, 0.94, 0.85));
    vec3 color = tone3(base, base * vec3(0.96, 0.98, 1.0), hamletPigment(vec3(0.63, 0.72, 0.77)), light);
    gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
    return;
  }
  vec3 view = normalize(cameraPosition - vWorld);
  float silhouette = (1.0 - smoothstep(0.035, 0.16, abs(dot(warpNormal(vPlanet, normal), view)))) * 0.12;
  base *= 1.0 - mark - silhouette;
  vec3 color = tone3(base * 1.06, base * 0.95, base * vec3(0.65, 0.74, 0.82), light);
  gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
#endif
}
