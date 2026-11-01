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

// Periodic botanical strokes, with an explicit UV footprint. Derivatives
// are evaluated once in main, outside all per-material control flow.
float veinStroke(float phase, float width, float footprint) {
  float d = abs(fract(phase + 0.5) - 0.5);
  float aa = max(footprint, 0.001);
  float resolved = 1.0 - smoothstep(0.3, 0.7, footprint);
  return (1.0 - smoothstep(width, width + aa, d)) * resolved;
}

float singleStroke(float distanceToLine, float width, float footprint) {
  float aa = max(footprint, 0.001);
  return (1.0 - smoothstep(width, width + aa, abs(distanceToLine)))
       * (1.0 - smoothstep(0.35, 0.8, footprint));
}

void main() {
  float acrossPixel = max(fwidth(vPart.w), 0.0001);
  float alongPixel = max(fwidth(vLeaf.x), 0.0001);
  // Calyx w stores unwrapped angular turns as 2u-1. A leaf uses -1..1 across its blade.
  float calyxPixel = acrossPixel * 0.5;
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
  if (part > 2.5 && part < 3.5) ndl = 0.1 + 0.75 * max(ndl, -ndl * 0.55);
  else if (part > 1.5) ndl = 0.32 + 0.68 * abs(ndl);
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
    float across = clamp(vPart.w, -1.0, 1.0);
    float along = clamp(vLeaf.x, 0.0, 1.0);
    float distanceAcross = abs(across);
    float bladePx = vLeaf.y / max(pixelMeters, 0.00001);
    float show = smoothstep(14.0, 60.0, bladePx);
    // Broad folds remain readable when the small veins are below a pixel.
    float fold = smoothstep(0.06, 0.88, distanceAcross);
    float dryTip = smoothstep(0.76, 1.0, along) * (0.35 + 0.65 * fold);
    vec3 leafMid = mix(pal(ROW_LEAF, 0), pal(ROW_LEAF, 1), fold * 0.16);
    col = tone3(pal(ROW_LEAF, 2), leafMid, pal(ROW_LEAF, 1), gl_FrontFacing ? b : b * 0.87);
    col = mix(col, pal(ROW_LEAF, 3), dryTip * 0.12);

    float midrib = singleStroke(across, 0.013, acrossPixel);
    float sidePhase = along * 9.5 - distanceAcross * 2.65;
    float sideVeins = veinStroke(sidePhase, 0.025, alongPixel * 9.5 + acrossPixel * 2.65);
    sideVeins *= smoothstep(0.045, 0.18, distanceAcross) * (1.0 - smoothstep(0.82, 1.0, distanceAcross));
    float finePhase = along * 25.0 - distanceAcross * 6.5;
    float fineVeins = veinStroke(finePhase, 0.018, alongPixel * 25.0 + acrossPixel * 6.5);
    fineVeins *= smoothstep(0.2, 0.5, distanceAcross) * (1.0 - smoothstep(0.86, 1.0, along));
    float rim = singleStroke(1.0 - distanceAcross, 0.009, acrossPixel);
    vec3 veinColour = mix(pal(ROW_LEAF, 3), pal(ROW_LEAF, 1), 0.38);
    float marks = (midrib * 0.3 + sideVeins * 0.16 + fineVeins * 0.055 + rim * 0.1) * show;
    col = mix(col, veinColour, marks);

    float pigment = clamp(0.5 + 0.5 * gnoise(vec3(along * 17.0, across * 8.0, float(seed % 17u)), seed + 31u), 0.0, 1.0);
    float pigmentResolved = 1.0 - smoothstep(0.35, 0.8, alongPixel * 17.0 + acrossPixel * 8.0);
    col *= 1.0 - pigment * 0.045 * show * pigmentResolved;
    float through = pow(clamp(dot(-n, uSunDir), 0.0, 1.0), 2.0) * (1.0 - shadow);
    col = mix(col, pal(ROW_LEAF, 2), through * (0.13 + 0.1 * fold));
  } else if (part < 3.5) {
    // Five longitudinal ribs run from the neck to the tapered tip. Branches
    // grow from those ribs into the thin panels; no horizontal onion rings.
    float u = (vPart.w + 1.0) * 0.5;
    float along = clamp(vLeaf.x, 0.0, 1.0);
    float panelPhase = u * 5.0;
    float panelU = fract(panelPhase);
    float fromRib = min(panelU, 1.0 - panelU);
    float panelCentre = sin(panelU * MEADOW_PI);
    float fruitPx = vLeaf.y / max(pixelMeters, 0.00001);
    float show = smoothstep(12.0, 40.0, fruitPx);
    float near = smoothstep(35.0, 100.0, fruitPx);

    vec3 paperLit = mix(pal(ROW_CANVAS, 1), pal(ROW_LEAF, 2), 0.3);
    vec3 paperMid = mix(pal(ROW_CANVAS, 2), pal(ROW_LEAF, 0), 0.15);
    vec3 paperShade = mix(pal(ROW_CANVAS, 4), pal(ROW_LEAF, 3), 0.1);
    float neckAndTip = 1.0 - smoothstep(0.0, 0.18, along) + smoothstep(0.8, 1.0, along);
    col = tone3(paperLit, paperMid, paperShade, b);
    col = mix(col, paperMid, (1.0 - panelCentre) * 0.11 + neckAndTip * 0.055);

    float rib = veinStroke(panelPhase, 0.015, calyxPixel * 5.0);
    float branches = veinStroke(along * 11.0 - fromRib * 3.6, 0.022, alongPixel * 11.0 + calyxPixel * 18.0);
    branches *= smoothstep(0.025, 0.14, fromRib) * (1.0 - smoothstep(0.42, 0.5, fromRib));
    branches *= smoothstep(0.06, 0.2, along) * (1.0 - smoothstep(0.82, 0.99, along));
    float filaments = veinStroke(along * 27.0 - fromRib * 7.0, 0.014, alongPixel * 27.0 + calyxPixel * 35.0);
    filaments *= smoothstep(0.12, 0.35, fromRib);
    vec3 ribColour = mix(pal(ROW_CANVAS, 4), pal(ROW_LEAF, 3), 0.16);
    col = mix(col, ribColour, (rib * 0.34 + branches * 0.15 + filaments * 0.05 * near) * show);

    // Sparse long fibres and uneven pencil deposit follow the paper's
    // longitudinal growth. Their small value range keeps the husk thin.
    float fibre = clamp(0.5 + 0.5 * gnoise(vec3(u * 170.0, along * 6.0, float(seed % 13u)), seed + 43u), 0.0, 1.0);
    float deposit = clamp(0.5 + 0.5 * gnoise(vec3(u * 33.0, along * 18.0, float(seed % 19u)), seed + 47u), 0.0, 1.0);
    float fibreResolved = 1.0 - smoothstep(0.25, 0.65, calyxPixel * 170.0 + alongPixel * 6.0);
    float depositResolved = 1.0 - smoothstep(0.35, 0.8, calyxPixel * 33.0 + alongPixel * 18.0);
    col *= 1.0 - fibre * 0.035 * near * fibreResolved - deposit * 0.025 * show * depositResolved;
    float transmitted = pow(clamp(dot(-n, uSunDir), 0.0, 1.0), 2.0) * (1.0 - shadow);
    col = mix(col, paperLit, transmitted * (0.12 + 0.12 * panelCentre));
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
