// The terraces' ground: each plot's floor (its water mirroring the sky and
// the walls above it, its crop over the water as tall as it has grown, or
// mud, or fallow grass), the bunds along and across it, the risers' faces
// between the levels lit as the walls they are and casting their shadows on
// the floor below, the forest floor and the peaks' rock, under soft toon
// light, the valley fog drifting over it all. Every wall and bund is
// filtered over the pixel's footprint, so the terraces stay crisp up close
// and settle into their average colour far off instead of shimmering.
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
#include <terraces_plots>
#include <terraces_paddy>
#include <terraces_village>
#include <terraces_ground>
#include <terraces_rice>
#include <terraces_fog>
#include <terraces_water>

uniform int uDebug;
uniform vec4 uRiceLook; // wind sheen, -, -, -
uniform vec4 uRiceNear; // the blades' focus (direction), their reach (m): inside it they draw the crop, the paint the floor under it

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying vec2 vGrid;
varying float vMorph;
varying float vHeight;
flat varying vec2 vNodeInfo;

const float COURTYARD = 1.0; // a house's courtyard reaches this far round its share of the model's footprint (m)

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

void main() {
  vec3 dir = normalize(vDir);
  vec3 nMesh = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(nMesh, v), 0.25);

  // where the terraces are built (objects.ts) the ground under them is only seen at the land's edge: earth.
  // Where it lies sunk all the way, out of sight under the floors, its plot is read only as far as its band
  // (the paint's cuts and plots are for the land beyond them; not returned early: the derivatives below read
  // the neighbouring pixels' values)
  bool built = uObjects.w > 0.0 && chordAngle(dir, uObjects.xyz) * uRadius < uObjects.w && houseDistance(dir) > COURTYARD;
  bool sunk = uDebug == 0 && objectsSink(dir, textureLod(uTerraceBake, dir, 0.0)) >= OBJECTS_SINK - 1e-3;
  Plot p = plotAtFor(dir, sunk);
  Crop c = cropOf(p);
  float ground = plotGround(p);
  float water = plotWater(p, c);
  float wild = smoothstep(0.35, 0.65, p.wild);

  // the ground's tangent frame and the hills' downhill way, from the screen-space change of their
  // (smooth) height
  vec3 a1;
  vec3 a2;
  gradientFrame(dir, a1, a2);
  vec3 px = dFdx(dir) * uRadius;
  vec3 py = dFdy(dir) * uRadius;
  mat2 J = mat2(dot(px, a1), dot(py, a1), dot(px, a2), dot(py, a2));
  vec2 g = abs(determinant(J)) > 1e-12 ? inverse(J) * vec2(dFdx(p.natural), dFdy(p.natural)) : vec2(0.0);
  vec3 downhill = length(g) > 1e-6 ? -normalize(a1 * g.x + a2 * g.y) : a1;

  // light: a floor, a riser's face (leaning back uphill as steep as it is), the hills' own
  vec3 P = dir * (uRadius + max(ground, water));
  float top = p.above + uTerraceWall.z;
  float riserW = riserWidth(p.floorH, top);
  vec3 nUp = warpNormal(P, dir);
  vec3 nRiser = warpNormal(P, normalize(dir * riserW + downhill * (top - p.floorH)));
  float bUp = toonLight(dot(nUp, uSunDir));
  float bRiser = toonLight(dot(nRiser, uSunDir));
  float bMesh = toonLight(dot(nMesh, uSunDir));

  // the shadows the walls cast on the floor below them, and the bunds on their own paddy's floor (the sun
  // fixed to the planet: its height over the floor here and its way along the slope)
  float sunUp = max(dot(uSunDir, dir), 0.05);
  float sunUphill = dot(uSunDir, -downhill);
  float shadow = 0.0;
  if (p.kind == PLOT_TERRACE) {
    float reach = sunUphill > 0.0 ? (top - p.floorH) * sunUphill / sunUp : 0.0;
    shadow = 1.0 - smoothstep(reach - 0.5 * pixelMeters - 0.02, reach + 0.5 * pixelMeters + 0.02, p.dIn);
    float bundReach = sunUphill < 0.0 ? uTerraceWall.z * -sunUphill / sunUp : 0.0;
    shadow = max(shadow, 1.0 - smoothstep(bundReach + uTerraceWall.y - 0.5 * pixelMeters, bundReach + uTerraceWall.y + 0.5 * pixelMeters, p.dOut));
  }

  // the pixel's footprint across its band, and where it falls in it: the riser at its inner edge, the
  // bund at its outer; the bunds across. Near the camera the mesh draws the walls itself: its steep faces
  // are walls (lit as they stand), the rest floor and bund; farther, where it eases to the hills' own
  // shape, the paint draws them, filtered over the pixel
  vec3 nGeom = normalize(cross(dFdx(vWarped), dFdy(vWarped)));
  nGeom *= sign(dot(nGeom, v));
  float steep = 1.0 - smoothstep(0.5, 0.75, dot(nGeom, nUp));
  float resolved = 1.0 - meshEase(meshSpacing(distance(cameraPosition, dir * uRadius)), p);
  float covRiser = 0.0;
  float covBund = 0.0;
  if (p.kind == PLOT_TERRACE) {
    float w = length(vec2(dFdx(p.u), dFdy(p.u))) * 1.15 / max(p.hi - p.lo, 1e-3);
    covRiser = mix(bandCover(p.fl, 1.0 - riserW / p.band, 1.0, w), steep, resolved);
    covBund = bandCover(p.fl, 0.0, uTerraceWall.y / p.band, w) * (1.0 - covRiser);
  }
  float half_ = 0.5 * uTerraceWall.y;
  float covCross = (1.0 - smoothstep(half_ - 0.5 * pixelMeters, half_ + 0.5 * pixelMeters, p.dCross)) * max(1.0 - covRiser - covBund, 0.0);
  float covFloor = max(1.0 - covRiser - covBund - covCross, 0.0);

  // wind on the crop and the water
  vec2 waves = gustWaves(dir);
  float ripple = pixelMeters < 0.6 ? rippleAt(dir) : 0.5;
  float sheen = windSheen(waves, ripple) * uRiceLook.x;

  vec3 col = vec3(0.0);
  vec3 tame = vec3(0.0);
  if (built && wild < 0.999) {
    tame = tone3(pal(TR_EARTH, 2), mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), 0.5), pal(TR_EARTH, 3), bMesh);
  } else if (wild < 0.999) {
    float lightFloor = bUp * (1.0 - 0.55 * shadow);
    // the view from above the floor: more of the water between the plants shows looking down
    vec3 eye = unwarpPosition(cameraPosition) - P;
    float cosView = clamp(dot(normalize(eye), dir), 0.0, 1.0);
    // the crop: as painted far off; inside the blades' reach they stand there themselves (rice.ts), the
    // paint keeping to what lies under them
    // (the blades' share of the crop: as rice.vert.glsl thins them, Rice.keep in rice.ts)
    float near = chordAngle(dir, uRiceNear.xyz) * uRadius;
    float blades = uRiceNear.w > 0.5 ? mix(1.0, 0.24, smoothstep(0.45 * uRiceNear.w, uRiceNear.w, near)) * (1.0 - smoothstep(0.78 * uRiceNear.w, uRiceNear.w, near)) : 0.0;
    float cover = cropCover(c.height, cosView) * (1.0 - blades);
    vec3 rice = riceColour(c, lightFloor);
    // the canopy's grain: a mottle of denser and thinner patches, finer up close
    vec3 sp = dir * uRadius;
    float mottle = 0.6 * gnoise(sp * 0.7, uTerrainSeed + 931u) + 0.4 * gnoise(sp * 2.3, uTerrainSeed + 932u) * (1.0 - smoothstep(0.08, 0.3, pixelMeters));
    rice *= 1.0 + 0.09 * mottle;
    // the wind runs over the crop as a swell: pale crests, dark troughs, the taller the more
    float tall = smoothstep(0.25, 0.9, c.height);
    rice = mix(rice, pal(TR_RICE, 7) * uSunTint, max(sheen, 0.0) * (0.2 + 0.5 * tall));
    rice *= mix(vec3(1.0), vec3(0.62, 0.72, 0.64), max(-sheen, 0.0) * (0.25 + 0.6 * tall));

    // under the crop: the water (its own level, mirroring the sky and the walls above it), or the mud
    vec3 under;
    float depth = water - ground;
    vec3 mud = tone3(pal(TR_EARTH, 4), mix(pal(TR_EARTH, 4), pal(TR_EARTH, 5), 0.5), pal(TR_EARTH, 5), lightFloor);
    if (c.water > 0.0) {
      vec3 wp = warpPosition(dir * (uRadius + water));
      vec3 vw = normalize(cameraPosition - wp);
      float tint = smoothstep(0.3, 0.9, fract(c.variant * 5.31));
      under = paddyWater(dir, wp, nUp, vw, mix(bUp, lightFloor, 0.5), waves.x, tint);
      // at its edges, a few centimeters deep over the bund's foot: the mud shows through
      under = mix(mud, under, smoothstep(0.0, 0.03, depth));
    } else {
      under = mud;
    }
    vec3 floorCol = mix(under, rice, cover);
    if (c.fallow > 0.5) {
      // fallow this season: grass coming up through the damp earth, a pale sage, a puddle here and there
      vec3 fallow = tone3(mix(pal(TR_EARTH, 0), pal(TR_RICE, 10), 0.5), mix(pal(TR_EARTH, 0), pal(TR_EARTH, 4), 0.5), pal(TR_EARTH, 1), lightFloor);
      fallow *= 1.0 + 0.08 * mottle;
      floorCol = c.water > 0.0 ? mix(under, fallow, 0.55) : fallow;
    }

    // the bunds: grass over earth, their tops catching the light as pale lines; the risers' faces: grass and
    // earth, lit as the walls they are, darker toward their foot
    vec3 bundCol = tone3(pal(TR_EARTH, 7), mix(pal(TR_EARTH, 0), pal(TR_EARTH, 7), 0.4), pal(TR_EARTH, 1), bUp * (1.0 - 0.3 * shadow));
    float tuft = gnoise(dir * uRadius * vec3(3.1), uTerrainSeed + 933u);
    bundCol *= 0.94 + 0.08 * tuft;
    // (lit by the mesh's own face where it draws the wall, else as the paint's riser leans)
    float bFace = mix(bRiser, toonLight(dot(nGeom, uSunDir)), resolved * steep);
    float upFace = clamp((vHeight - p.floorH) / max(top - p.floorH, 0.05), 0.0, 1.0);
    vec3 riserCol = tone3(pal(TR_EARTH, 2), mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), 0.5), pal(TR_EARTH, 3), bFace);
    riserCol *= mix(0.8, 1.05, upFace) * (0.92 + 0.12 * tuft);
    // a bund with water lapping at its foot: the pixel's own point under the water is water
    if (p.kind == PLOT_TERRACE && depth > 0.003 && pixelMeters < 0.15) bundCol = floorCol;

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
    tame = floorCol * covFloor + bundCol * (covBund + covCross) + riserCol * covRiser;
  }
  // the river (the bake's flat past 1: 1 the top of its bank … 2 its middle): its water mirroring the sky
  // and its banks, silver with the banks' darks along its edges; a bank of grass down to it from the fields
  float river = clamp(p.flatness - 1.0, 0.0, 1.0);
  if (river > 0.0) {
    vec3 wp = warpPosition(dir * (uRadius + vHeight));
    vec3 rw = paddyWater(dir, wp, nUp, normalize(cameraPosition - wp), bUp, waves.x, 0.25);
    // (deeper than a paddy's: bluer and darker, the paintings' river against their silver fields)
    rw = mix(rw, pal(TR_WATER, 2), 0.32);
    vec3 bank = tone3(pal(TR_EARTH, 2), mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), 0.5), pal(TR_EARTH, 3), bMesh);
    bank *= 0.92 + 0.12 * gnoise(dir * uRadius * 1.7, uTerrainSeed + 935u);
    float wet = smoothstep(0.72 - 0.02, 0.72 + 0.02, river);
    tame = mix(tame, mix(bank, rw, wet), smoothstep(0.42, 0.5, river));
    wild *= 1.0 - smoothstep(0.3, 0.5, river);
  }
  if (wild > 0.001) {
    // the forest floor under the trees, and the peaks' rock where it is too steep for them: the ink's
    // deep teal, as the painting lays its peaks (reference/terraces/colour-blue.png)
    float rock = smoothstep(1.3, 2.4, p.slope);
    vec3 floorForest = tone3(pal(TR_FOREST, 1), pal(TR_FOREST, 6), pal(TR_FOREST, 3), bMesh);
    vec3 cliff = tone3(pal(TR_PEAK, 0), mix(pal(TR_PEAK, 0), pal(TR_PEAK, 3), 0.5), pal(TR_PEAK, 3), bMesh);
    // brushed down the slope, the ink's strokes: long, in two sizes, the rock paler toward its top
    vec3 sp = dir * (uRadius / 2.0);
    sp -= downhill * dot(sp, downhill) * 0.82;
    float ink = 0.65 * gnoise(sp, uTerrainSeed + 901u) + 0.35 * gnoise(sp * 3.1, uTerrainSeed + 902u);
    cliff = mix(cliff, pal(TR_PEAK, 3) * 0.8, smoothstep(0.05, 0.45, ink) * 0.55);
    cliff = mix(cliff, pal(TR_PEAK, 2), smoothstep(-0.1, -0.45, ink) * 0.35);
    cliff = mix(cliff, mix(cliff, pal(TR_PEAK, 1), 0.45), smoothstep(10.0, 45.0, p.natural));
    tame = mix(tame, mix(floorForest, cliff, rock), wild);
  }
  col = tame;
  col += pal(ROW_LIGHT, 3) * sunRim(nMesh, v) * 0.08;

  // the haze of distance, then the valley fog
  col = applyAerial(col, viewDist, dir);
  col = applyValleyFog(col, P);

  if (uDebug == 4) {
    // the land use and every plot, flat (dbg=land): forest, rock; each plot its own colour by its stage
    // (flooded blue, seedlings pale, growing green, grown yellow-green, ripe gold, fallow brown, the flats
    // a little paler); the walls dark, the bunds across red, the courtyards pink
    vec3 lc;
    float shade = 0.72 + 0.28 * bMesh;
    if (p.wild > 0.5) {
      lc = p.slope > 1.15 ? vec3(0.45, 0.5, 0.62) : vec3(0.12, 0.38, 0.2);
    } else {
      float m = c.maturity;
      lc = m <= 0.0 ? vec3(0.25, 0.55, 0.95) : m < 0.35 ? vec3(0.55, 0.85, 0.9) : m < 0.7 ? vec3(0.35, 0.75, 0.3) : m < 0.92 ? vec3(0.75, 0.85, 0.3) : vec3(0.92, 0.75, 0.25);
      lc *= 0.7 + 0.6 * c.variant;
      if (c.fallow > 0.5) lc = vec3(0.55, 0.4, 0.28);
      if (p.kind == PLOT_FLAT) lc = mix(lc, vec3(1.0), 0.25);
      lc = mix(lc, vec3(0.85, 0.15, 0.1), covCross);
      lc = mix(lc, vec3(0.08), covBund);
      lc = mix(lc, vec3(0.3), covRiser);
      float house = houseDistance(dir);
      if (house < COURTYARD) lc = house < 0.0 ? vec3(0.9, 0.1, 0.5) : vec3(0.98, 0.6, 0.2);
    }
    col = lc * shade;
  } else if (uDebug == 5) {
    // the cells (dbg=cells): each its own colour, the flats striped, the walls dark, the bunds across red
    uint h = plotHash(p.cell, 0, 0, 0, 99u);
    vec3 lc = 0.35 + 0.6 * vec3(unitHash(h), unitHash(nextHash(h)), unitHash(nextHash(nextHash(h))));
    if (p.kind == PLOT_FLAT) lc *= 0.75 + 0.25 * step(0.5, fract(p.level * 0.5));
    if (p.wild > 0.5) lc = vec3(0.1, 0.3, 0.15);
    lc = mix(lc, vec3(0.85, 0.15, 0.1), covCross);
    lc = mix(lc, vec3(0.08), covBund + covRiser);
    col = lc * (0.72 + 0.28 * bMesh);
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
