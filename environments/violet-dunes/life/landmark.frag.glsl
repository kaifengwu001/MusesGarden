// Material-specific pencil marks, anchored to the actual local geometry.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
uniform float uPixelAngle;
uniform vec2 uResolution;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform vec4 uKit;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWarped;
varying vec3 vLocal;
centroid varying vec4 vPart;
centroid varying vec2 vLeaf;
varying float vSeed;

float pencil(vec3 p, vec3 across, float spacing, float footprint, uint seed) {
  float show = 1.0 - smoothstep(spacing * 0.7, spacing * 1.8, footprint);
  float phase = dot(p, across) / spacing + 0.24 * gnoise(p * 7.0, seed);
  float width = min(0.35, max(0.025, footprint / spacing));
  float line = 1.0 - smoothstep(0.04 + width, 0.12 + width, abs(fract(phase) - 0.5));
  float broken = smoothstep(-0.3, 0.35, gnoise(p * vec3(1.3, 9.0, 2.0), seed + 1u));
  return line * broken * show;
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 view = toCam / max(viewDist, 1e-5);
  vec3 dir = normalize(vPlanet);
  float pixelMeters = viewDist * uPixelAngle;
  float shadow = max(cloudShadowAt(vPlanet, 0.0), 0.85 * cottageShadow(dir));
  float ndl = dot(n, uSunDir);
  float part = vPart.x;
  if (part > 1.5) ndl = 0.32 + 0.68 * abs(ndl);
  float b = toonLight(ndl) * (1.0 - 0.78 * shadow);
  vec3 col;
  uint seed = 401u + uint(vSeed * 97.0);

  if (part < 0.5) {
    float face = vPart.w;
    vec3 lit = mix(pal(ROW_ROCK, 2), pal(ROW_ROCK, 4), smoothstep(0.78, 1.0, face) * 0.32);
    vec3 mid = mix(pal(ROW_ROCK, 0), pal(ROW_ROCK, 3), 0.28 + face * 0.15);
    col = tone3(lit, mid, pal(ROW_ROCK, 1), b);
    float hatch = pencil(vLocal, normalize(vec3(0.15, 1.0, 0.25)), 0.045, pixelMeters, seed);
    col = mix(col, pal(ROW_ROCK, 5), hatch * (0.1 + 0.17 * (1.0 - b)));
    float bed = gnoise(vLocal * vec3(1.4, 6.0, 1.4), seed + 8u);
    float fissure = 1.0 - smoothstep(0.0, max(0.014, pixelMeters * 0.12), abs(bed));
    float sparse = smoothstep(0.15, 0.4, gnoise(vLocal * 2.0, seed + 9u));
    col = mix(col, pal(ROW_ROCK, 5) * 0.85, fissure * sparse * 0.38 * (1.0 - smoothstep(0.04, 0.1, pixelMeters)));
    col *= mix(0.85, 1.0, smoothstep(-0.02, 0.1 * uKit.w, vLocal.y));
  } else if (part < 1.5) {
    col = tone3(pal(ROW_LEAF, 4) * 1.12, pal(ROW_LEAF, 4), pal(ROW_LEAF, 5), b);
    float grain = pencil(vLocal, normalize(vec3(1.0, 0.06, 0.25)), 0.021, pixelMeters, seed);
    col *= 1.0 - grain * 0.16;
  } else if (part < 2.5) {
    float across = vPart.w;
    float along = vLeaf.x;
    col = tone3(pal(ROW_LEAF, 2), pal(ROW_LEAF, 0), pal(ROW_LEAF, 1), gl_FrontFacing ? b : b * 0.85);
    float through = pow(clamp(dot(-view, uSunDir), 0.0, 1.0), 2.0) * (1.0 - shadow);
    col = mix(col, pal(ROW_LEAF, 2), through * 0.24);
    float show = smoothstep(10.0, 45.0, vLeaf.y / max(pixelMeters, 1e-5));
    float aa = min(0.15, pixelMeters / max(vLeaf.y * 0.25, 0.02));
    float midrib = 1.0 - smoothstep(0.015, 0.04 + aa, abs(across));
    float side = fract(along * 8.0 - abs(across) * 2.0);
    float vein = 1.0 - smoothstep(0.02, 0.055 + aa, min(side, 1.0 - side));
    float rim = smoothstep(0.88 - aa, 0.99, abs(across));
    col = mix(col, pal(ROW_LEAF, 3), (midrib * 0.4 + vein * 0.14 + rim * 0.22) * show);
    col *= 1.0 - pencil(vLocal, normalize(vec3(0.7, 0.3, 0.2)), 0.035, pixelMeters, seed) * 0.075;
  } else if (part < 3.5) {
    // Rounded Physalis calyx: dry papery panels and botanical ribs.
    float rib = pow(0.5 + 0.5 * cos(vPart.w * 15.707963), 7.0);
    col = tone3(pal(ROW_CANVAS, 3), pal(ROW_CANVAS, 0), pal(ROW_CANVAS, 1), b);
    col = mix(col, pal(ROW_TIMBER, 2), rib * 0.17);
    float vein = pencil(vLocal, normalize(vec3(0.55, 0.8, 0.2)), 0.022, pixelMeters, seed);
    col = mix(col, pal(ROW_CANVAS, 4), vein * 0.16);
  } else if (part < 4.5) {
    col = tone3(pal(ROW_LEAF, 2), pal(ROW_LEAF, 0), pal(ROW_LEAF, 3), b);
  } else if (part < 5.5) {
    col = tone3(pal(ROW_STAR, 0), pal(ROW_STAR, 4), pal(ROW_STAR, 1), b);
    col = mix(col, pal(ROW_CANVAS, 4), smoothstep(0.88, 1.0, abs(vPart.w)) * 0.12);
  } else {
    col = tone3(pal(ROW_ROCK, 2) * 1.26, pal(ROW_ROCK, 3), pal(ROW_ROCK, 5), b);
    // A blade's central highlight has compact support across [-1, 1].
    // Outside that support it is zero, never a negative odd-power mix weight.
    float centre = max(0.0, 1.0 - abs(vPart.w));
    col = mix(col, pal(ROW_STAR, 5), pow(centre, 5.0) * 0.16);
  }
  col = applyAerial(col, viewDist, dir);
  gl_FragColor = vec4(col, 1.0);
}
