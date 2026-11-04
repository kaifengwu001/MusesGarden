#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_sun>
#include <meadow_fog>
#include <meadow_snow>
uniform float uRadius;
#include <meadow_cloud_cover>
uniform float uSnowAmount;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vVariation;
varying vec3 vPrint;
varying vec3 vRestNormal;
varying vec2 vFan;

vec3 hamletPigment(vec3 rgb) { return pow(rgb, vec3(2.2)); }

// All stroke helpers are derivative-free. The caller supplies a footprint
// evaluated before the material branches (and before the seasonal discard).
float botanicalStroke(float distanceToStroke, float width, float pixel) {
  return 1.0 - smoothstep(max(0.0, width - pixel), width + pixel, distanceToStroke);
}
float botanicalSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

// A single, coherent fan belongs to each rounded lobe. There is no tiled
// needle pattern: rays rise from its lower twig attachment to the cloud edge.
float pineRays(vec2 p, float pixel, float seed) {
  vec2 fromTwig = p + vec2(0.0, 0.88);
  float radius = length(fromTwig);
  float angle = atan(fromTwig.x, fromTwig.y);
  float count = 29.0 + floor(seed * 5.0);
  float phase = angle * count + 0.12 * sin(radius * 6.0 + seed * 9.0);
  float ray = abs(sin(phase)) * radius / count;
  float ends = smoothstep(0.13, 0.30, radius);
  return botanicalStroke(ray, 0.0032, pixel) * ends * (1.0 - smoothstep(0.018, 0.060, pixel));
}

vec3 pineCloud(vec2 q, vec2 pixel, float variant) {
  float seed = fract(vPrint.z);
  vec3 green = hamletPigment(mix(vec3(0.29, 0.42, 0.35), vec3(0.36, 0.46, 0.37), seed * 0.55 + variant * 0.2));
  if (vPrint.z >= 21.0) green *= vec3(0.81, 0.91, 0.95);
  float rays = pineRays(q, max(pixel.x, pixel.y), seed);
  float topFade = 1.0 - smoothstep(0.88, 1.0, length(q));
  vec3 ink = hamletPigment(vec3(0.12, 0.23, 0.21));
  return mix(green, ink, rays * topFade * 0.84);
}

void main() {
#ifndef HAMLET_SHADOW
  float pixelMeters = max(length(fwidth(vLocal)), 0.0001);
  vec2 chartPixel = max(fwidth(vPrint.xy), vec2(0.0001));
  float printPixel = max(chartPixel.x, chartPixel.y);
  vec2 fanPixel = max(fwidth(vFan), vec2(0.0001));
#endif
  // Every snow blanket is independent geometry; rain reveals the complete
  // underlying needles, branches and slate.
  if (vKind > 4.5 && uSnowAmount < 0.5) discard;
#ifdef HAMLET_SHADOW
  gl_FragColor = vec4(1.6, 0.0, 0.0, 1.0);
  return;
#else
  vec3 direction = normalize(vPlanet);
#ifdef HAMLET_INK
  vec3 ink = hamletPigment(vec3(0.12, 0.19, 0.22));
  gl_FragColor = vec4(applyAerial(ink, distance(cameraPosition, vWorld), direction), 0.72);
#else
  vec3 normal = normalize(vPlanetNormal);
  if (!gl_FrontFacing) normal = -normal;
  float light = toonLight(dot(normal, localSun(direction)));
  vec3 base;
  float mark = 0.0;
  float resolved = 1.0 - smoothstep(0.05, 0.17, pixelMeters);
  if (vKind < 0.5) {
    base = mix(hamletPigment(vec3(0.38, 0.31, 0.23)), hamletPigment(vec3(0.52, 0.40, 0.26)), vVariation * 0.6);
    // Grain bends, branches, and breaks into bark plates rather than varnished
    // parallel timber stripes. Coordinates follow each branch's arc length.
    float u = vPrint.x, v = vPrint.y;
    float grainPosition = u + 0.034 * sin(v * 2.3 + sin(u * 13.0) * 1.2) + 0.018 * sin(v * 6.1 + u * 5.0);
    float wave = grainPosition * 35.0 + 0.35 * sin(v * 10.0 + u * 9.0);
    float furrow = abs(sin(wave)) / 35.0;
    float broken = smoothstep(-0.65, 0.05, sin(v * 4.3 + floor(u / 0.17) * 2.4));
    float width = 0.005 + 0.003 * (0.5 + 0.5 * sin(v * 7.4 + u * 15.0));
    mark = botanicalStroke(furrow, width, printPixel) * broken * 0.60 * resolved;
    vec2 cell = floor(vPrint.xy / vec2(0.24, 0.60));
    float checkSeed = hash12(cell + 47.2);
    vec2 p = (fract(vPrint.xy / vec2(0.24, 0.60)) - 0.5) * vec2(0.24, 0.60);
    float check = abs(p.y + (checkSeed - 0.5) * 0.30 + 0.045 * sin(p.x * 18.0 + checkSeed * 5.0));
    float checkEnds = 1.0 - smoothstep(0.05, 0.105, abs(p.x));
    mark = max(mark, botanicalStroke(check, 0.007, printPixel) * checkEnds * resolved * 0.55);
    float paleEdge = abs(sin(wave + 0.8)) / 35.0;
    base = mix(base, hamletPigment(vec3(0.63, 0.47, 0.29)), botanicalStroke(paleEdge, 0.003, printPixel) * broken * resolved * 0.25);
    if (vPrint.z > 1.5 && vPrint.z < 2.5) {
      // Plum bark is quiet charcoal brown, with a few long bending fissures.
      // No repeated horizontal lenticels or gold rings across branch joints.
      base = hamletPigment(vec3(0.32, 0.30, 0.26));
      float plumFurrow = abs(sin(u * 14.0 + 0.32 * sin(v * 1.3 + u * 4.0))) / 14.0;
      mark = botanicalStroke(plumFurrow, 0.0025, printPixel) * resolved * 0.32;
    }
  } else if (vKind < 1.5) {
    base = mix(hamletPigment(vec3(0.18, 0.30, 0.25)), hamletPigment(vec3(0.25, 0.36, 0.28)), vVariation * 0.5);
    vec3 p = vLocal + vec3(vVariation * 0.63);
    if (vPrint.z > 19.5) {
      base = pineCloud(vFan, fanPixel, vVariation);
    }     else {
      // A real folded needle has one pale midrib; its narrow dark sides supply
      // silhouette detail without transparent cards or an extra line pass.
      float midrib = botanicalStroke(abs(vPrint.x), 0.11, chartPixel.x);
      base = mix(base, hamletPigment(vec3(0.44, 0.48, 0.30)), midrib * 0.62);
    }
  } else if (vKind < 2.5) {
    base = mix(hamletPigment(vec3(0.22, 0.31, 0.38)), hamletPigment(vec3(0.32, 0.39, 0.43)), vVariation * 0.55);
    float fleck = hash13(floor(vLocal * 13.0));
    base = mix(base, hamletPigment(vec3(0.62, 0.48, 0.30)), step(0.975, fleck) * resolved * 0.42);
  } else if (vKind < 3.5) {
    bool grass = vPrint.z >= 15.0 || (vVariation < -0.5 && vVariation > -1.5);
    bool crop = vVariation < -1.5;
    base = hamletPigment(grass ? vec3(0.38, 0.49, 0.30) : crop ? vec3(0.62, 0.58, 0.32) : vec3(0.68, 0.55, 0.32));
    float midrib = botanicalStroke(abs(vPrint.x), 0.12, chartPixel.x);
    base = mix(base, hamletPigment(grass ? vec3(0.58, 0.63, 0.39) : vec3(0.83, 0.73, 0.46)), midrib * 0.40);
    mark = botanicalStroke(abs(abs(vPrint.x) - 0.65), 0.08, chartPixel.x) * 0.21;
  } else if (vKind < 4.5) {
    base = hamletPigment(vec3(0.73, 0.27, 0.18));
    base = mix(base, hamletPigment(vec3(0.27, 0.24, 0.17)), 1.0 - smoothstep(-0.65, -0.18, vPrint.y));
    base = mix(base, hamletPigment(vec3(0.93, 0.52, 0.31)), smoothstep(0.35, 0.9, vPrint.y) * 0.45);
  } else {
    vec3 color = snowInCloud(snowBoundary(light, normalize(vRestNormal).y), cloudCoverAt(vPlanet, 0.0));
    gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
    return;
  }
  vec3 view = normalize(cameraPosition - vWorld);
  float outlineWidth = vKind > 0.5 && vKind < 1.5 && vPrint.z > 19.5 ? 0.10 : 0.035;
  float silhouette = (1.0 - smoothstep(outlineWidth, outlineWidth + 0.09, abs(dot(warpNormal(vPlanet, normal), view))))
    * (vKind > 0.5 && vKind < 1.5 && vPrint.z > 19.5 ? 0.34 : 0.12);
  base *= 1.0 - mark - silhouette;
  bool cloudPine = vKind > 0.5 && vKind < 1.5 && vPrint.z > 19.5;
  vec3 shade = cloudPine ? vec3(0.80, 0.85, 0.88) : vec3(0.65, 0.74, 0.82);
  vec3 color = tone3(base * 1.06, base * 0.95, base * shade, light);
  gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
#endif
#endif
}
