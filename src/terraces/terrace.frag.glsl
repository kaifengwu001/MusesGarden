// The terraces as built, painted as the paddy lab paints them (src/dev/
// paddyLab/): each part its own colour, measured from Kai's aerial, lit as
// the lab lights them (rice.glsl). Each paddy and each field on the flats one
// colour, its look by its stage, and its water showing as much as its look
// says (Kai: white is full water, dark green dense grass): the sky mirrored
// in it and the mist over it (mist.glsl), a little rippled; the dams and the
// ridges along the cuts cream, the risers olive; earth where the woods meet
// the farmed land and along the flats' bunds; the woods' own ground under
// the trees, rock where it is too steep for them; a track's packed earth; a
// village's ground, packed earth and grass in patches. No shadows of the mist
// (Kai). Then the haze of distance, and the height fog.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <terraces_fog>
#include <terraces_mist>
#include <terraces_rice>
uniform float uTime;

uniform int uDebug;

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy;
varying vec4 vFloor;
varying float vHeight;

void main() {
  vec3 dir = normalize(vDir);
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  if (dot(n, toCam) < 0.0) n = -n;
  int part = int(vPart + 0.5);
  vec3 up = warpNormal(dir * (uRadius + vHeight), dir);
  vec3 albedo;
  float water = 0.0;
  if (part == 0) {
    // a paddy, or a field on the flats: its look now (vPaddy: its own variant, its place in the season), and its water
    albedo = paddyLook(vPaddy.y, vPaddy.x);
    water = paddyWater(vPaddy.y);
  } else if (part == 1 || part == 3) {
    // a dam's sides: the riser down to the paddy below, and its slope in to its own paddy's water (Kai: the sides of
    // the dams a darker green, their tops the cream)
    albedo = pal(TR_EARTH, 1);
  } else if (part == 4) {
    albedo = pal(TR_EARTH, 2);
  } else if (part == 6) {
    // the woods' own ground (the hills' height itself, its normal from their gradient: the build worked both out),
    // two greens mixed by a noise a few meters across; the rock where it is too steep for trees (vFloor.y: its slope)
    vec3 ground = mix(pal(TR_FOREST, 9), pal(TR_FOREST, 10), 0.5 + 0.5 * gnoise(dir * uRadius / 3.0, uTerrainSeed + 931u));
    albedo = mix(ground, mix(pal(TR_PEAK, 0), pal(TR_PEAK, 3), 0.4), smoothstep(1.3, 2.4, vFloor.y));
  } else if (part == 7) {
    albedo = pal(TR_EARTH, 3) * (0.94 + 0.08 * gnoise(dir * uRadius * 2.3, uTerrainSeed + 936u));
  } else if (part == 8) {
    // a village's ground: packed earth worn pale round its houses, grass in patches a few meters across
    float grass = smoothstep(-0.25, 0.35, gnoise(dir * uRadius / 4.0, uTerrainSeed + 941u) + 0.4 * gnoise(dir * uRadius / 1.3, uTerrainSeed + 942u));
    albedo = mix(pal(TR_EARTH, 3), mix(pal(TR_RICE, 2), pal(TR_RICE, 3), 0.35), grass) * (0.95 + 0.07 * gnoise(dir * uRadius * 2.3, uTerrainSeed + 936u));
  } else if (part == 9) {
    // Muse's hut's knoll (hut.ts): grass, two greens mixed by a noise a couple of meters across
    albedo = mix(pal(TR_RICE, 3), pal(TR_FOREST, 9), 0.5 + 0.5 * gnoise(dir * uRadius / 2.5, uTerrainSeed + 961u));
  } else if (part == 5) {
    // a ridge along a cut: its top the dams' cream, its sides their green
    albedo = mix(pal(TR_EARTH, 1), pal(TR_EARTH, 0), smoothstep(0.84, 0.94, dot(n, up)));
  } else {
    // a dam's top
    albedo = pal(TR_EARTH, 0);
  }
  vec3 col = labLight(albedo, n, up);
  if (water > 0.0) {
    // (its water: the sky mirrored in it, the mist over it mirrored too, a little rippled by the wind; over its own
    // shallow grey as much as the angle lets the mirror through, as painted water always mirrors a good deal)
    vec3 v = toCam / viewDist;
    vec3 t1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(up, t1);
    vec3 q = dir * uRadius;
    float slow = uTime * 0.35;
    vec2 ripple = 0.018 * vec2(gnoise(q / 1.6 + vec3(0.0, 0.0, slow), uTerrainSeed + 951u), gnoise(q / 1.6 + vec3(7.1, 0.0, slow), uTerrainSeed + 952u));
    vec3 wn = normalize(up + ripple.x * t1 + ripple.y * t2);
    vec3 r = reflect(-v, wn);
    // (the sky it mirrors half its own silver grey, as the planet painting's flooded paddies are, the mist mirrored in
    // it still showing white, as flooded terraces mirror their clouds)
    vec3 sky = mix(mix(pal(ROW_SKY, 1), pal(ROW_SKY, 0), pow(clamp(dot(r, up), 0.0, 1.0), 0.62)), pal(TR_RICE, 0), 0.5) * uShadeTint;
    vec4 mist = mistReflected(dir * (uRadius + vHeight), r);
    vec3 mirror = sky * (1.0 - mist.a) * 1.08 + mist.rgb * 1.18;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(v, wn), 0.0), 5.0);
    vec3 shallow = labLight(pal(TR_RICE, 1), up, up);
    col = mix(col, mix(shallow, mirror, mix(0.7, 1.0, fres)), water);
  }
  col = applyAerial(col, viewDist, dir);
  col = applyHeightFog(col, viewDist, vHeight, dir);
  if (uDebug == 4) {
    // (dbg=land: each part flat: floors by their paddy, risers dark blue, dams yellow, earth brown, ridges white,
    // the woods green, tracks orange, villages lilac)
    vec3 parts[9] = vec3[9](vec3(0.3) + 0.6 * vec3(fract(vPaddy.x * 7.1), fract(vPaddy.x * 3.3), fract(vPaddy.x * 5.7)), vec3(0.1, 0.1, 0.5), vec3(0.9, 0.85, 0.1), vec3(0.8, 0.6, 0.1), vec3(0.45, 0.25, 0.1), vec3(1.0), vec3(0.1, 0.5, 0.1), vec3(1.0, 0.5, 0.0), vec3(0.7, 0.45, 0.85));
    col = parts[clamp(part, 0, 8)];
  }
  gl_FragColor = vec4(col, 1.0);
}
