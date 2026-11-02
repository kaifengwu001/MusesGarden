// The terraces as built, painted as the paddy lab paints them (src/dev/
// paddyLab/): each part its own colour, measured from Kai's aerial, lit as
// the lab lights them (rice.glsl). Each paddy and each field on the flats one
// colour, its look by its stage; the dams and the ridges along the cuts
// cream, the risers olive; earth where the woods meet the farmed land and
// along the flats' bunds; the woods' own ground under the trees, rock where
// it is too steep for them; a track's packed earth; a village's ground, packed
// earth and grass in patches. The clouds' shadows passing over (the meadow's,
// life/clouds.glsl). Then the haze of distance.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <meadow_clouds>
#include <terraces_common>
#include <terraces_rice>

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
  if (part == 0) {
    // a paddy, or a field on the flats: its look now (vPaddy: its own variant, its place in the season)
    albedo = paddyLook(vPaddy.y, vPaddy.x);
  } else if (part == 1) {
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
  } else {
    // a dam's top and sides, a ridge along a cut
    albedo = pal(TR_EARTH, 0);
  }
  // (the shadow's edge roughened a little, brushed)
  float shade = cloudShadowAt(dir * (uRadius + vHeight), 0.6 * gnoise(dir * uRadius * 0.9, uTerrainSeed + 943u));
  vec3 col = labLight(albedo, n, up, shade);
  col = applyAerial(col, viewDist, dir);
  if (uDebug == 4) {
    // (dbg=land: each part flat: floors by their paddy, risers dark blue, dams yellow, earth brown, ridges white,
    // the woods green, tracks orange, villages lilac)
    vec3 parts[9] = vec3[9](vec3(0.3) + 0.6 * vec3(fract(vPaddy.x * 7.1), fract(vPaddy.x * 3.3), fract(vPaddy.x * 5.7)), vec3(0.1, 0.1, 0.5), vec3(0.9, 0.85, 0.1), vec3(0.8, 0.6, 0.1), vec3(0.45, 0.25, 0.1), vec3(1.0), vec3(0.1, 0.5, 0.1), vec3(1.0, 0.5, 0.0), vec3(0.7, 0.45, 0.85));
    col = parts[clamp(part, 0, 8)];
  }
  gl_FragColor = vec4(col, 1.0);
}
