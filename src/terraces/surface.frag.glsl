// The terraces' ground: paddy floors (flooded and mirroring the sky and the
// hills; seedlings in rows; growing; ripening), the bunds along their edges
// and across them, the risers between the levels, the forest floor and the
// peaks' rock, under soft toon light, the valley fog drifting over it all.
// Every line (a riser, a bund) is filtered over the pixel's footprint, so
// the terraces stay crisp up close and settle into their average colour far
// off instead of shimmering.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
uniform float uPixelAngle;
uniform vec2 uResolution;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <meadow_wind>
#include <terraces_ground>
#include <terraces_paddy>
#include <terraces_village>
#include <terraces_fog>
#include <terraces_water>

uniform int uDebug;
uniform vec4 uRiceLook; // wind sheen, -, -, -

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying vec2 vGrid;
varying float vMorph;
flat varying vec2 vNodeInfo;

const float CROSS_BUND = 0.14; // half width of a cross-bund (m)
const float ROW_M = 0.3;      // the rows' spacing (m)
const float COURTYARD = 2.4;  // a house's courtyard reaches this far round it (m)

// ∫₀ˣ of the indicator of [a, b], repeating every 1.
float periodicCdf(float x, float a, float b) {
  float k = floor(x);
  return k * (b - a) + clamp(x - k - a, 0.0, b - a);
}

// The share of a box w wide (band units) about f that falls in [a, b] of every band.
float bandCover(float f, float a, float b, float w) {
  w = max(w, 1e-4);
  return (periodicCdf(f + 0.5 * w, a, b) - periodicCdf(f - 0.5 * w, a, b)) / w;
}

vec3 faceColour(float f) {
  if (f < 0.5) return vec3(0.95, 0.55, 0.45);
  if (f < 1.5) return vec3(0.55, 0.8, 0.45);
  if (f < 2.5) return vec3(0.45, 0.6, 0.95);
  if (f < 3.5) return vec3(0.95, 0.85, 0.4);
  if (f < 4.5) return vec3(0.75, 0.5, 0.9);
  return vec3(0.4, 0.85, 0.85);
}

// The crop as paint, by how far through the season it is: seedlings a pale
// yellow-green, then fresh, then deep green, heading out yellow-green at the
// tips; each paddy a little its own (jade or yellow, lighter or darker).
vec3 cropColour(float m, float variant, float b) {
  vec3 young = pal(TR_RICE, 0);
  vec3 fresh = pal(TR_RICE, 1);
  vec3 deep = pal(TR_RICE, 2);
  vec3 lit = mix(young, fresh, smoothstep(0.15, 0.5, m));
  lit = mix(lit, deep, smoothstep(0.5, 0.85, m));
  lit = mix(lit, pal(TR_RICE, 3), smoothstep(0.86, 1.0, m) * smoothstep(0.35, 0.9, variant) * 0.75);
  // a few paddies already turning gold
  lit = mix(lit, pal(TR_RICE, 4), smoothstep(0.92, 1.0, m) * smoothstep(0.84, 0.97, variant));
  // jade or yellow, lighter or darker, paddy by paddy
  float v2 = fract(variant * 7.13);
  lit = mix(lit, pal(TR_RICE, 9), 0.22 * smoothstep(0.55, 0.95, v2) * smoothstep(0.3, 0.8, m));
  lit = mix(lit, pal(TR_RICE, 5), 0.18 * smoothstep(0.45, 0.05, v2));
  lit *= 0.9 + 0.2 * fract(variant * 3.71);
  vec3 shade = mix(pal(TR_RICE, 6), lit * 0.45, 0.35);
  return tone3(lit, mix(lit, shade, 0.4), shade, b);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 nMesh = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(nMesh, v), 0.25);

  Terrace t = terraceAt(dir);

  // the ground's tangent frame and the hills' downhill way, from the
  // screen-space change of their (smooth) height
  vec3 a1;
  vec3 a2;
  gradientFrame(dir, a1, a2);
  vec3 px = dFdx(dir) * uRadius;
  vec3 py = dFdy(dir) * uRadius;
  mat2 J = mat2(dot(px, a1), dot(py, a1), dot(px, a2), dot(py, a2));
  vec2 g = abs(determinant(J)) > 1e-12 ? inverse(J) * vec2(dFdx(t.natural), dFdy(t.natural)) : vec2(0.0);
  vec3 downhill = length(g) > 1e-6 ? -normalize(a1 * g.x + a2 * g.y) : a1;

  // light on a floor, a bund and a riser (steep, facing downhill)
  vec3 P = dir * (uRadius + t.height);
  vec3 nUp = warpNormal(P, dir);
  vec3 nRiser = warpNormal(P, normalize(dir * 0.3 + downhill * 0.95));
  float bUp = toonLight(dot(nUp, uSunDir));
  float bRiser = toonLight(dot(nRiser, uSunDir));
  float bMesh = toonLight(dot(nMesh, uSunDir));

  // the pixel's footprint across the bands, and where it falls in them
  float w = length(vec2(dFdx(t.x), dFdy(t.x))) * 1.15;
  float covRiser = bandCover(t.f, 1.0 - t.wr * 0.8, 1.0, w);
  float covBund = bandCover(t.f, 0.0, t.wb * 0.85, w);
  float covFloor = max(1.0 - covRiser - covBund, 0.0);

  // wind on the crop and the water
  vec2 waves = gustWaves(dir);
  float ripple = pixelMeters < 0.6 ? rippleAt(dir) : 0.5;
  float sheen = windSheen(waves, ripple) * uRiceLook.x;

  vec3 col;
  float wild = t.wild;
  vec3 tame = vec3(0.0);
  if (wild < 0.999) {
    Paddy pd = paddyAt(dir, t.level);
    float m = pd.fallow > 0.5 ? 0.0 : pd.maturity;
    // cross-bunds: the cuts across the band and the cells' edges, a little lower than the outer bunds
    float covCross = (1.0 - smoothstep(CROSS_BUND - 0.5 * pixelMeters, CROSS_BUND + 0.5 * pixelMeters, pd.wall)) * covFloor;
    covFloor -= covCross;

    // the floor: water showing between the rows until the crop closes over it. On a terrace the
    // rows run along it (level lines of the hills, spaced by the slope at the paddy's middle); on a
    // flat valley floor, straight across the paddy, each its own way
    float slopeC = textureLod(uTerraceBake, pd.centre, 0.0).g;
    float rowsAcross;
    if (slopeC > 0.07) {
      rowsAcross = t.x * uTerrace.x / (slopeC * ROW_M);
    } else {
      vec3 c1;
      vec3 c2;
      gradientFrame(pd.centre, c1, c2);
      float th = pd.rows * MEADOW_PI;
      rowsAcross = dot(dir - pd.centre, c1 * cos(th) + c2 * sin(th)) * uRadius / ROW_M;
    }
    float rowW = length(vec2(dFdx(rowsAcross), dFdy(rowsAcross)));
    float crop = smoothstep(0.02, 0.62, m);
    float rowsSeen = 1.0 - smoothstep(0.35, 0.8, rowW);
    float stripe = bandCover(fract(rowsAcross), 0.0, mix(0.18, 0.95, crop), rowW);
    float cover = mix(mix(0.12, 1.0, crop) * step(0.01, m), stripe * step(0.01, m), rowsSeen);
    cover = clamp(cover + smoothstep(0.7, 0.9, m), 0.0, 1.0);
    vec3 cropCol = cropColour(m, pd.variant, bUp);
    // the wind runs over the crop as a swell: pale crests, dark troughs, the taller the more
    float tall = smoothstep(0.3, 1.0, m);
    cropCol = mix(cropCol, pal(TR_RICE, 7) * uSunTint, max(sheen, 0.0) * (0.25 + 0.5 * tall));
    cropCol *= mix(vec3(1.0), vec3(0.62, 0.72, 0.64), max(-sheen, 0.0) * (0.3 + 0.6 * tall));

    vec3 floorCol = cropCol;
    if (pd.fallow > 0.5) {
      // fallow this season: bare, damp earth with a little grass coming
      floorCol = tone3(mix(pal(TR_EARTH, 4), pal(TR_EARTH, 0), 0.35), pal(TR_EARTH, 4), pal(TR_EARTH, 5), bUp);
      cover = 1.0;
    }
    if (cover < 0.999) {
      // the water plane of this paddy, in view space
      float waterH = t.floorH + uTerraceMesh.z;
      vec3 wp = warpPosition(dir * (uRadius + waterH));
      vec3 vw = normalize(cameraPosition - wp);
      float tint = smoothstep(0.3, 0.9, fract(pd.variant * 5.31));
      vec3 water = paddyWater(dir, wp, nUp, vw, bUp, waves.x, tint);
      floorCol = mix(water, cropCol, cover);
    }
    vec3 bundCol = tone3(pal(TR_EARTH, 0), mix(pal(TR_EARTH, 0), pal(TR_EARTH, 1), 0.5), pal(TR_EARTH, 1), bUp);
    // bunds round flooded paddies read pale, as in the ink paintings; among the crop, a darker green
    bundCol = mix(bundCol, tone3(pal(TR_EARTH, 7), pal(TR_EARTH, 0), pal(TR_EARTH, 1), bUp), (1.0 - crop) * 0.6);
    vec3 riserCol = tone3(pal(TR_EARTH, 2), mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), 0.5), pal(TR_EARTH, 3), bRiser);
    // round a village's houses the floor is courtyard: packed earth and stone flags, the house's shadow under it
    float house = houseDistance(dir);
    if (house < COURTYARD + pixelMeters) {
      vec3 yard = tone3(pal(TR_EARTH, 6), mix(pal(TR_EARTH, 6), pal(TR_EARTH, 4), 0.45), pal(TR_EARTH, 5), bUp);
      yard *= 0.94 + 0.08 * hash12(floor(dir.xy * uRadius * 1.6 + dir.z * 37.0));
      yard = mix(yard * 0.55, yard, smoothstep(-0.2, 0.9, house));
      float inYard = 1.0 - smoothstep(COURTYARD - 0.5 * pixelMeters, COURTYARD + 0.5 * pixelMeters, house);
      floorCol = mix(floorCol, yard, inYard);
      covFloor += covCross * inYard;
      covCross *= 1.0 - inYard;
    }
    // (the cross-bunds lower and quieter than the bunds along the terraces)
    tame = floorCol * covFloor + bundCol * covBund + mix(floorCol, bundCol, 0.6) * covCross + riserCol * covRiser;
  }
  if (wild > 0.001) {
    // the forest floor under the trees, and the peaks' rock where it is too steep for them
    float rock = smoothstep(1.15, 1.9, t.slope);
    vec3 floorForest = tone3(pal(TR_FOREST, 1), pal(TR_FOREST, 6), pal(TR_FOREST, 3), bMesh);
    vec3 cliff = tone3(pal(TR_PEAK, 2), pal(TR_PEAK, 0), pal(TR_PEAK, 3), bMesh);
    // brushed down the slope, the ink's strokes
    vec3 sp = dir * (uRadius / 2.5);
    sp -= downhill * dot(sp, downhill) * 0.75;
    cliff *= 0.9 + 0.2 * gnoise(sp, uTerrainSeed + 901u);
    tame = mix(tame, mix(floorForest, cliff, rock), wild);
  }
  col = tame;
  col += pal(ROW_LIGHT, 3) * sunRim(nMesh, v) * 0.08;

  // the haze of distance, then the valley fog
  col = applyAerial(col, viewDist, dir);
  col = applyValleyFog(col, P);

  if (uDebug == 4) {
    // the land use and each paddy's infill, flat (dbg=land): forest, rock, the walls, the infill by stage
    vec3 lc;
    float shade = 0.72 + 0.28 * bMesh;
    if (wild > 0.5) {
      lc = t.slope > 1.15 ? vec3(0.45, 0.5, 0.62) : vec3(0.12, 0.38, 0.2);
    } else {
      Paddy pd = paddyAt(dir, t.level);
      float m = pd.maturity;
      lc = m <= 0.0 ? vec3(0.25, 0.55, 0.95) : m < 0.35 ? vec3(0.55, 0.85, 0.9) : m < 0.7 ? vec3(0.35, 0.75, 0.3) : m < 0.92 ? vec3(0.75, 0.85, 0.3) : vec3(0.92, 0.75, 0.25);
      lc = mix(lc, lc * (0.8 + 0.4 * pd.variant), 0.6);
      if (pd.fallow > 0.5) lc = vec3(0.55, 0.4, 0.28);
      float cross = 1.0 - smoothstep(CROSS_BUND - 0.5 * pixelMeters, CROSS_BUND + 0.5 * pixelMeters, pd.wall);
      lc = mix(lc, vec3(0.85, 0.15, 0.1), cross * (1.0 - covRiser));
      lc = mix(lc, vec3(0.08), covBund);
      lc = mix(lc, vec3(0.35), covRiser);
      float house = houseDistance(dir);
      if (house < COURTYARD) lc = house < 0.0 ? vec3(0.9, 0.1, 0.5) : vec3(0.98, 0.6, 0.2);
    }
    col = lc * shade;
  } else if (uDebug == 1) {
    vec3 base = faceColour(vNodeInfo.x) * (0.72 + 0.28 * mod(vNodeInfo.y, 2.0));
    vec2 gw = fwidth(vGrid) * 1.5;
    vec2 e2 = smoothstep(vec2(0.0), gw, vGrid) * smoothstep(vec2(0.0), gw, 1.0 - vGrid);
    col = base * (0.45 + 0.55 * bMesh) * mix(0.35, 1.0, min(e2.x, e2.y));
  } else if (uDebug == 2) {
    col = mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.45, 0.2), vMorph);
  } else if (uDebug == 3) {
    col = vec3(0.5) + 0.5 * nMesh;
  }
  gl_FragColor = vec4(col, 1.0);
}
