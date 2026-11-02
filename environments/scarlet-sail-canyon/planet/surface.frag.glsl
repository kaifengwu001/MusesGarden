// Dry chalk ground, ink-like fissures, mineral scree and soft painted light.
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
uniform vec4 uNearField; // focus direction xyz, blade radius (m): where real grass takes over

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
  // Ground from the bake at every pixel (AWAY_FROM_HOME:
  // a node the homestead shapes and shades none of, surface.ts, drawn without its code)
  vec4 fields = terrainFields(dir);
#ifdef AWAY_FROM_HOME
  float h = fields.r;
#else
  float h = homestead(dir, fields.r);
#endif

  // Cliff lighting must follow the continuous terrain, rather than interpolated
  // vertex normals: the latter stretch a narrow riser's normal across each
  // triangle and produce long comb-like teeth in the toon bands. A centered,
  // fixed physical footprint also avoids derivative noise from the height bake.
  const float normalMeters = 0.45;
  vec3 gradA, gradB;
  gradientFrame(dir, gradA, gradB);
  float normalAngle = normalMeters / uRadius;
  vec3 da = normalize(dir + gradA * normalAngle);
  vec3 db = normalize(dir + gradB * normalAngle);
  vec3 dc = normalize(dir - gradA * normalAngle);
  vec3 dd = normalize(dir - gradB * normalAngle);
  float ha = height0(da), hb = height0(db);
  float hc = height0(dc), hd = height0(dd);
  vec3 pp = dir * (uRadius + h + uBank.x);
  vec3 pa = da * (uRadius + ha + uBank.x);
  vec3 pb = db * (uRadius + hb + uBank.x);
  vec3 pc = dc * (uRadius + hc + uBank.x);
  vec3 pd = dd * (uRadius + hd + uBank.x);
  vec3 n = warpNormal(pp, normalize(cross(pa - pc, pb - pd)));
  float slope = length(vec2(ha - hc, hb - hd)) / (2.0 * normalMeters);

  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(n, v), 0.3);
  float shore = 1000.0;
  float wet = 0.0;

  // light: toon bands, the cottage's shadow, cloud shadows with brushed edges
  float stroke = strokeAt(dir, pixelMeters);
  // (the cottage's shadow is painted like a cloud's: deep and cool)
#ifdef AWAY_FROM_HOME
  float cloud = cloudShadowAt(dir * (uRadius + max(h, 0.0)), stroke * 2.2);
#else
  float cloud = max(cloudShadowAt(dir * (uRadius + max(h, 0.0)), stroke * 2.2), 0.85 * cottageShadow(dir));
#endif
  float b = toonLight(dot(n, uSunDir)) * (1.0 - 0.9 * cloud);

  float sheen = 0.0;

  // Matte chalk and scree share the existing paint input contract.
  vec3 land = vec3(0.0);
  if (wet < 1.0) {
    // the paint's flowers give way to the flowers themselves in the near field, where those are big enough on screen to carry
    // it, and once they are built there (through iteration 13 the paint gave way first: a bare patch until a tile was built)
    float nearFade = uNearField.w > 0.01 ? (1.0 - smoothstep(uNearField.w * 0.55, uNearField.w, chordAngle(dir, uNearField.xyz) * uRadius)) * (1.0 - smoothstep(0.03, 0.07, pixelMeters)) * vFlowersBuilt : 0.0;
    Meadow m;
    m.dir = dir;
    m.slope = slope;
    m.lush = fields.g;
    m.wet = fields.b;
    m.variant = fields.a;
    m.flora = textureLod(uFloraBake, dir, 0.0);
    m.bloom = vBloom;
    m.shore = shore;
    m.light = b;
    m.sunlit = 1.0 - cloud;
    m.sheen = sheen;
    m.stroke = stroke;
    m.pixelMeters = pixelMeters;
    m.nearFade = nearFade;
    land = meadowPaint(m);
    land *= cloudTint(cloud);
  }

  vec3 col = land;
  col += pal(ROW_LIGHT, 3) * sunRim(n, v) * 0.12 * (1.0 - wet);
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
