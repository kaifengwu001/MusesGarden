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
const float SAND_RELIEF_LIGHT = 3.2;
const float SAND_LEVEL_LIGHT = 0.28;
uniform vec4 uNearField; // focus direction xyz, flower radius (m): where real starflowers take over

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
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

void main() {
  vec3 dir = normalize(vDir);
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(n, v), 0.3);

  // the ground here, per pixel from the bake (AWAY_FROM_HOME: a node the homestead shapes and
  // shades none of, surface.ts, drawn without its code)
  vec4 fields = textureLod(uTerrainBake, dir, 0.0);
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
  float b = toonLight(ndl) * (1.0 - 0.9 * cloud);

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
  // Fine sand is grouped by the dune's lee aspect, as a drawn landscape
  // groups the sheltered slip faces even under broad diffuse daylight.
  vec3 grainCross = cross(uDuneGrain.xyz, dir);
  vec3 acrossGrain = length(grainCross) > 1e-5 ? normalize(grainCross) : normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 leeAxis = warpNormal(dir * uRadius, acrossGrain);
  float lee = smoothstep(0.04, 0.34, dot(n, leeAxis));
  col = mix(col, pal(ROW_SAND, 5) * uShadeTint, lee * 0.72);
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
