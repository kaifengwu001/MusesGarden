#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_sun>
#include <meadow_fog>
#include <meadow_snow>
uniform float uSnowAmount;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vVariation;
varying vec3 vPrint;
varying vec3 vRestNormal;

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

vec3 pinePrint(vec2 uv, float pixel, vec3 pigment) {
  // Offset, overlapping partial fans: unequal needles grow from a short twig.
  // These are small botanical strokes, never identical whole-canopy stars.
  vec3 drawn = pigment;
  for (int layer = 0; layer < 2; layer++) {
    vec2 q = uv / vec2(0.27, 0.25) + vec2(float(layer) * 0.47, float(layer) * 0.39);
    vec2 cell = floor(q);
    float seed = hash12(cell + vec2(31.7, 17.3 + float(layer) * 7.0));
    vec2 p = (fract(q) - 0.5) * vec2(0.27, 0.25);
    p -= vec2(seed - 0.5, hash12(cell.yx + 18.4) - 0.5) * 0.045;
    float radius = length(p);
    float angle = atan(p.y, p.x) - seed * 6.2831853;
    angle = atan(sin(angle), cos(angle));
    float index = floor(angle / 0.37 + 0.5);
    float lengthVariation = hash12(vec2(index + seed * 17.0, seed * 31.0));
    float needleLength = 0.055 + lengthVariation * 0.065;
    float curve = sin(radius * 17.0 + seed * 4.0) * radius * 1.1;
    float distanceToRay = abs(sin(angle - index * 0.37 + curve)) * radius;
    float ends = smoothstep(0.005, 0.017, radius) * (1.0 - smoothstep(needleLength - 0.012, needleLength, radius));
    ends *= (1.0 - smoothstep(3.8, 4.6, abs(index))) * smoothstep(0.08, 0.20, lengthVariation);
    float taper = 1.0 - smoothstep(0.02, needleLength, radius);
    float outline = botanicalStroke(distanceToRay, 0.004 * taper + 0.0015, pixel) * ends;
    float needle = botanicalStroke(distanceToRay, 0.0015 * taper + 0.0007, pixel) * ends;
    drawn = mix(drawn, hamletPigment(vec3(0.10, 0.20, 0.18)), outline * 0.75);
    drawn = mix(drawn, hamletPigment(mix(vec3(0.35, 0.40, 0.26), vec3(0.46, 0.48, 0.31), seed)), needle * 0.76);
  }
  return mix(pigment, drawn, 1.0 - smoothstep(0.014, 0.055, pixel));
}

vec3 cedarPrint(vec2 uv, float pixel, vec3 pigment) {
  // Paired rising leaflets on hanging twigs distinguish cedar from radial pine.
  float row = floor(uv.y / 0.62);
  vec2 p = (fract(vec2(uv.x + row * 0.19, uv.y) / vec2(0.39, 0.62)) - 0.5) * vec2(0.39, 0.62);
  float stem = botanicalSegment(p, vec2(-0.035, -0.27), vec2(0.025, 0.27));
  float leaves = 1.0;
  for (int i = 0; i < 4; i++) {
    float y = -0.23 + float(i) * 0.12;
    vec2 base = vec2(y * 0.11, y);
    leaves = min(leaves, botanicalSegment(p, base, base + vec2(-0.14, 0.12)));
    leaves = min(leaves, botanicalSegment(p, base + vec2(0.0, 0.035), base + vec2(0.14, 0.15)));
  }
  float distanceToSpray = min(leaves, stem);
  float outline = botanicalStroke(distanceToSpray, 0.015, pixel);
  float leaf = botanicalStroke(leaves, 0.006, pixel);
  float resolved = 1.0 - smoothstep(0.025, 0.080, pixel);
  vec3 drawn = mix(pigment, hamletPigment(vec3(0.09, 0.22, 0.24)), outline * 0.8);
  drawn = mix(drawn, hamletPigment(vec3(0.37, 0.46, 0.32)), leaf * 0.83);
  return mix(pigment, drawn, resolved);
}

void main() {
#ifndef HAMLET_SHADOW
  float pixelMeters = max(length(fwidth(vLocal)), 0.0001);
  vec2 chartPixel = max(fwidth(vPrint.xy), vec2(0.0001));
  float printPixel = max(chartPixel.x, chartPixel.y);
  vec3 restPixel = max(fwidth(vLocal), vec3(0.0001));
  // Smooth rest-space normals blend projections without polar singularities.
  // Evaluating UV derivatives in a chosen projection would be undefined where
  // a fragment quad crosses a material or projection boundary.
  vec3 printWeights = pow(abs(normalize(vRestNormal)), vec3(4.0));
  printWeights /= max(dot(printWeights, vec3(1.0)), 0.0001);
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
      base = mix(base, hamletPigment(vec3(0.20, 0.23, 0.22)), 0.63);
      vec2 p = (fract(vPrint.xy / vec2(0.14, 0.28)) - 0.5) * vec2(0.14, 0.28);
      float lenticel = botanicalSegment(p, vec2(-0.028, 0.0), vec2(0.028, 0.0));
      base = mix(base, hamletPigment(vec3(0.63, 0.47, 0.30)), botanicalStroke(lenticel, 0.004, printPixel) * resolved * 0.65);
    }
  } else if (vKind < 1.5) {
    base = mix(hamletPigment(vec3(0.18, 0.30, 0.25)), hamletPigment(vec3(0.25, 0.36, 0.28)), vVariation * 0.5);
    vec3 p = vLocal + vec3(vVariation * 0.63);
    if (vPrint.z < 0.5) {
      base = pinePrint(p.yz, max(restPixel.y, restPixel.z), base) * printWeights.x
        + pinePrint(p.xz, max(restPixel.x, restPixel.z), base) * printWeights.y
        + pinePrint(p.xy, max(restPixel.x, restPixel.y), base) * printWeights.z;
    } else if (vPrint.z < 1.5) {
      base = cedarPrint(p.yz * 1.25, max(restPixel.y, restPixel.z) * 1.25, base) * printWeights.x
        + cedarPrint(p.xz * 1.25, max(restPixel.x, restPixel.z) * 1.25, base) * printWeights.y
        + cedarPrint(p.xy * 1.25, max(restPixel.x, restPixel.y) * 1.25, base) * printWeights.z;
    }
    else {
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
    base = hamletPigment(vec3(0.73, 0.55, 0.28));
    float midrib = botanicalStroke(abs(vPrint.x), 0.12, chartPixel.x);
    base = mix(base, hamletPigment(vec3(0.94, 0.76, 0.42)), midrib * 0.65);
    mark = botanicalStroke(abs(abs(vPrint.x) - 0.65), 0.08, chartPixel.x) * 0.21;
  } else if (vKind < 4.5) {
    base = hamletPigment(vec3(0.73, 0.27, 0.18));
    base = mix(base, hamletPigment(vec3(0.27, 0.24, 0.17)), 1.0 - smoothstep(-0.65, -0.18, vPrint.y));
    base = mix(base, hamletPigment(vec3(0.93, 0.52, 0.31)), smoothstep(0.35, 0.9, vPrint.y) * 0.45);
  } else {
    vec3 color = snowPrint(vLocal, pixelMeters, light);
    gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
    return;
  }
  vec3 view = normalize(cameraPosition - vWorld);
  float silhouette = (1.0 - smoothstep(0.035, 0.16, abs(dot(warpNormal(vPlanet, normal), view)))) * 0.12;
  base *= 1.0 - mark - silhouette;
  vec3 color = tone3(base * 1.06, base * 0.95, base * vec3(0.65, 0.74, 0.82), light);
  gl_FragColor = vec4(applyAerial(color, distance(cameraPosition, vWorld), direction), 1.0);
#endif
#endif
}
