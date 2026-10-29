// The ground: painted meadow, rock and snow, water, toon light and haze.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_water>
#include <meadow_clouds_shadow>

uniform float uSnow;
uniform float uPixelAngle;
uniform int uDebug;
uniform vec4 uNearField; // focus direction xyz, blade radius (m): where real grass takes over

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying vec3 vPlanetNormal;
varying float vMountain;
varying float vRock;
varying float vClearing;
varying vec2 vGrid;
varying float vMorph;
varying vec3 vFields;
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

  float shadow = cloudShadow(dir);
  float b = toonLight(dot(n, uSunDir)) * mix(1.0, 0.55, shadow);

  float water = waterDistance(dir, vMountain);
  float aa = max(fwidth(water), 0.015);
  float wet = smoothstep(aa, -aa, water);

  float nearFade = uNearField.w > 0.01 ? 1.0 - smoothstep(uNearField.w * 0.55, uNearField.w, chordAngle(dir, uNearField.xyz) * uRadius) : 0.0;
  vec3 land = meadowPaint(dir, vFields, b, water, pixelMeters, nearFade);
  // damp, darker grass right at the water's edge
  land = mix(land, tone3(pal(ROW_GRASS, 1), pal(ROW_GRASS, 2), pal(ROW_GRASS, 5), b), smoothstep(0.9, 0.0, water) * 0.35);

  // mountains: rock on steep or high ground, snow above the snowline
  if (vMountain > 0.0) {
    float slope = 1.0 - clamp(dot(normalize(vPlanetNormal), dir), 0.0, 1.0);
    float grain = gnoise(dir * 60.0, uTerrainSeed + 140u);
    float rocky = smoothstep(0.1, 0.34, vRock + slope * 1.1 + grain * 0.05) * smoothstep(0.02, 0.3, vMountain);
    vec3 rockCol = tone3(pal(ROW_ROCK, 2), pal(ROW_ROCK, 0), mix(pal(ROW_ROCK, 1), pal(ROW_ROCK, 3), 0.55), b);
    float snow = smoothstep(uSnow - 0.05, uSnow + 0.02, vRock + 0.07 * grain - slope * 0.45) * step(0.02, vMountain);
    vec3 snowCol = tone3(pal(ROW_SNOW, 0), pal(ROW_SNOW, 2), pal(ROW_SNOW, 1), b);
    land = mix(land, rockCol, rocky);
    land = mix(land, snowCol, snow);
  }

  vec3 col = land;
  if (wet > 0.0) col = mix(land, waterColour(dir, water, b, n, v, pixelMeters), wet);
  col += pal(ROW_LIGHT, 3) * sunRim(n, v) * 0.12 * (1.0 - wet);
  col = applyAerial(col, viewDist, dir);

  if (uDebug == 1) {
    vec3 base = faceColour(vNodeInfo.x) * (0.72 + 0.28 * mod(vNodeInfo.y, 2.0));
    vec2 w = fwidth(vGrid) * 1.5;
    vec2 edge = smoothstep(vec2(0.0), w, vGrid) * smoothstep(vec2(0.0), w, 1.0 - vGrid);
    col = base * (0.45 + 0.55 * toonLight(dot(n, uSunDir))) * mix(0.35, 1.0, min(edge.x, edge.y));
  } else if (uDebug == 2) {
    col = mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.45, 0.2), vMorph);
  } else if (uDebug == 3) {
    col = vec3(0.5) + 0.5 * n;
  }
  gl_FragColor = vec4(col, 1.0);
}
