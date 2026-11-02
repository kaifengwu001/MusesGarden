// The ground: painted sand under soft toon light, the shelter's shadow and
// cloud shadows sweeping over it, haze. A dry world: no water, shore or bank.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
uniform float uPixelAngle;
uniform vec2 uResolution;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_wind>
#include <meadow_warp>
#include <meadow_clouds>

uniform int uDebug;
// How much steeper than they are the sand's slopes are lit, and the light level sand takes (N·L).
const float SAND_RELIEF_LIGHT = 4.8;
const float SAND_LEVEL_LIGHT = 0.28;
uniform vec4 uNearField; // focus direction xyz, flower radius (m): where real starflowers take over

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying vec3 vGroundNormal;
varying float vClearing;
varying float vSlope;
varying float vBloom;
varying vec2 vGrid;
varying float vMorph;
varying float vFlowersBuilt;
flat varying vec2 vNodeInfo;

vec3 faceColour(float f) {
  if (f < 0.5) return vec3(0.95, 0.55, 0.45);
  if (f < 1.5) return vec3(0.55, 0.8, 0.45);
  if (f < 2.5) return vec3(0.45, 0.6, 0.95);
  if (f < 3.5) return vec3(0.95, 0.85, 0.4);
  if (f < 4.5) return vec3(0.75, 0.5, 0.9);
  return vec3(0.4, 0.85, 0.85);
}

struct SandSurface {
  vec3 normal;
  float light;
  float shadow;
  float grain;
};

vec2 rippleLine(vec2 phase, vec2 footprint, float offset, float width) {
  vec2 d = abs(fract(phase - offset + 0.5) - 0.5);
  return 1.0 - smoothstep(vec2(width), vec2(width) + footprint, d);
}

// Physical ripple spacing and granular pigment, evaluated only in this
// fragment stage. All derivatives run before any varying control flow.
SandSurface sandSurface(vec3 dir, vec3 n, float clearing, float habitat) {
  vec3 g = normalize(uDuneGrain.xyz);
  vec3 a = normalize(cross(g, abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(g, a);
  vec2 q = vec2(dot(dir, a), dot(dir, b));
  float ring = max(length(q) * uRadius, 0.1);
  float phi = atan(q.y + 1e-8, q.x + 1e-8);
  float level = log2(6.2831853 * ring / 0.42);
  float f0 = exp2(floor(level));
  float t = fract(level);
  vec3 ripplePoint = dir * (uRadius / 3.6);
  float bend = gnoise(ripplePoint, uTerrainSeed + 131u) * 0.85
             + gnoise(dir * (uRadius / 0.85), uTerrainSeed + 132u) * 0.16;
  vec2 phase = phi * vec2(f0, f0 * 2.0) / 6.2831853 + bend;
  // Differentiate the angular field analytically across its wrap seam and
  // keep octave switches out of the footprint (the two trains crossfade).
  vec2 qx = dFdx(q);
  vec2 qy = dFdy(q);
  float angleFootprint = (abs(q.x * qx.y - q.y * qx.x) + abs(q.x * qy.y - q.y * qy.x)) / max(dot(q, q), 1e-7);
  vec2 footprint = max(angleFootprint * vec2(f0, f0 * 2.0) / 6.2831853 + fwidth(bend), vec2(0.003));
  vec3 gp = dir * (uRadius / 0.026);
  vec3 grainFootprint = fwidth(gp);
  float fine = gnoise(gp, uTerrainSeed + 141u);
  float coarse = gnoise(dir * (uRadius / 0.11), uTerrainSeed + 142u);
  float grainSize = max(grainFootprint.x, max(grainFootprint.y, grainFootprint.z));
  float grainVisible = 1.0 - smoothstep(0.8, 3.5, grainSize);
  uint grainHash = meadowHash(ivec3(floor(gp)), uTerrainSeed + 143u);
  vec3 grainCentre = vec3(float(grainHash & 255u), float((grainHash >> 8u) & 255u), float((grainHash >> 16u) & 255u)) / 255.0;
  grainCentre = 0.34 + grainCentre * 0.32;
  float grainDot = 1.0 - smoothstep(0.1, 0.22 + grainSize * 0.18, length(fract(gp) - grainCentre));
  float facet = float((grainHash >> 24u) & 255u) / 255.0 - 0.4;
  float dotsVisible = 1.0 - smoothstep(0.55, 1.6, grainSize);
  vec2 visible = 1.0 - smoothstep(vec2(0.22), vec2(0.55), footprint);
  float patches = smoothstep(-0.3, 0.3, gnoise(dir * (uRadius / 3.0), uTerrainSeed + 133u));
  float broken = smoothstep(-0.4, 0.15, gnoise(dir * (uRadius / 0.5), uTerrainSeed + 135u));
  patches *= 0.45 + 0.55 * broken;
  float show = patches * (1.0 - 0.85 * clearing) * (1.0 - 0.25 * habitat);
  vec2 lit = rippleLine(phase, footprint, 0.27, 0.045) * visible;
  vec2 dark = rippleLine(phase, footprint, 0.43, 0.065) * visible;
  vec3 crossGrain = cross(g, dir);
  vec3 across = length(crossGrain) > 1e-5 ? normalize(crossGrain) : a;
  across = warpNormal(dir * uRadius, across);
  across = normalize(across - n * dot(n, across));
  vec2 slope = cos(phase * 6.2831853) * visible;
  SandSurface s;
  s.normal = normalize(n - across * mix(slope.x, slope.y, t) * show * 0.18);
  s.light = mix(lit.x, lit.y, t) * show;
  s.shadow = mix(dark.x, dark.y, t) * show;
  s.grain = fine * grainVisible * 0.075 + coarse * 0.04 + grainDot * facet * dotsVisible * 0.42;
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(n, v), 0.3);
  vec4 fields = textureLod(uTerrainBake, dir, 0.0);
  SandSurface micro = sandSurface(dir, n, clamp(vClearing, 0.0, 1.0), fields.b);

  // the ground here, per pixel from the bake (AWAY_FROM_HOME: a node the homestead shapes and
  // shades none of, surface.ts, drawn without its code)
  // The actual interpolated surface position already includes the authored
  // ridges. Shadow lookup needs that position, not a second per-pixel
  // evaluation of the displacement recipe.
  float h = length(unwarpPosition(vWarped)) - uRadius;

  // light: toon bands, the shelter's shadow, cloud shadows with brushed edges
  float stroke = strokeAt(dir, pixelMeters);
#ifdef AWAY_FROM_HOME
  float cloud = cloudShadowAt(dir * (uRadius + h), stroke * 2.2);
#else
  float cloud = max(cloudShadowAt(dir * (uRadius + h), stroke * 2.2), 0.85 * cottageShadow(dir));
#endif
  // the sand is lit as if its slopes were steeper than they are, and level sand sits just inside
  // the lit band whatever the sun's height: under a high sun the dunes would otherwise read as one
  // flat band; painted, their lit and shaded faces group into a few broad values
  vec3 up = warpNormal(dir * uRadius, dir);
  vec3 tilt = n - up * dot(n, up);
  float ndl = SAND_LEVEL_LIGHT + dot(normalize(up * dot(n, up) + tilt * SAND_RELIEF_LIGHT), uSunDir) - dot(up, uSunDir);
  vec3 grainCross = cross(uDuneGrain.xyz, dir);
  vec3 acrossGrain = length(grainCross) > 1e-5 ? normalize(grainCross) : normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  float lee = smoothstep(0.025, 0.22, dot(normalize(vGroundNormal), acrossGrain));
  float b = mix(toonLight(ndl), 0.04, lee * 0.9) * (1.0 - 0.9 * cloud);

  // the starflowers the paint draws give way to the flowers themselves in the near field, where those are big enough on screen
  // to carry it, and once they are built there
  float nearFade = uNearField.w > 0.01 ? (1.0 - smoothstep(uNearField.w * 0.55, uNearField.w, chordAngle(dir, uNearField.xyz) * uRadius)) * (1.0 - smoothstep(0.03, 0.07, pixelMeters)) * vFlowersBuilt : 0.0;
  Sand s;
  s.dir = dir;
  s.normal = n;
  s.tone = fields.g;
  s.habitat = fields.b;
  s.variant = fields.a;
  s.flora = textureLod(uFloraBake, dir, 0.0);
  s.bloom = vBloom;
  s.clearing = vClearing;
  s.light = b;
  s.ndl = ndl;
  s.sunlit = 1.0 - cloud;
  s.stroke = stroke;
  s.pixelMeters = pixelMeters;
  s.nearFade = nearFade;
  vec3 col = sandPaint(s) * cloudTint(cloud);
  // Each ripple has a light-catching shoulder and a narrow sheltered side;
  // these marks remain present on the large dune's shaded slip face.
  col = mix(col, pal(ROW_SAND, 7) * uSunTint, micro.light * 0.33 * (1.0 - cloud));
  col = mix(col, pal(ROW_SAND, 5) * uShadeTint, micro.shadow * 0.28);
  col *= 1.0 + micro.grain;
  col *= 1.0 + (dot(micro.normal, uSunDir) - dot(n, uSunDir)) * 0.4;
  col += pal(ROW_LIGHT, 3) * sunRim(n, v) * 0.1;
  col = applyAerial(col, viewDist, dir);

  if (uDebug == 1) {
    vec3 base = faceColour(vNodeInfo.x) * (0.72 + 0.28 * mod(vNodeInfo.y, 2.0));
    vec2 w = fwidth(vGrid) * 1.5;
    vec2 e2 = smoothstep(vec2(0.0), w, vGrid) * smoothstep(vec2(0.0), w, 1.0 - vGrid);
    col = base * (0.45 + 0.55 * toonLight(dot(n, uSunDir))) * mix(0.35, 1.0, min(e2.x, e2.y));
  } else if (uDebug == 2) {
    col = mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.45, 0.2), vMorph);
  } else if (uDebug == 3) {
    col = vec3(0.5) + 0.5 * n;
  }
  gl_FragColor = vec4(col, 1.0);
}
