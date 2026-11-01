// The terraces as built, painted: each paddy's floor (its water mirroring the
// sky and the walls above it, its crop over the water as tall as it has
// grown, or mud, or fallow grass), the risers' faces lit as the walls they
// are, the bunds' grassy tops and the ridges along the cuts catching the
// light, the skirts' earth; the haze of distance and the valley fog over it.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
uniform float uPixelAngle;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <meadow_wind>
#include <terraces_plots>
#include <terraces_paddy>
#include <terraces_ground>
#include <terraces_rice>
#include <terraces_fog>
#include <terraces_water>

uniform vec4 uRiceLook; // wind sheen, -, -, -
uniform vec4 uRiceNear; // the blades' focus (direction), their reach (m)

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vPart;
varying vec4 vPaddy;
varying vec4 vFloor;
varying float vHeight;

// How much of a paddy's floor its crop hides from this view: plants h meters tall, looked at with
// cosView between the view and straight down (more of the water between them shows from above).
float cropCover(float h, float cosView) {
  if (h <= 0.0) return 0.0;
  float c0 = clamp(0.12 + 1.15 * h, 0.0, 0.97);
  return 1.0 - pow(1.0 - c0, 1.0 / max(cosView, 0.18));
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  if (dot(n, v) < 0.0) n = -n;
  float pixelMeters = viewDist * uPixelAngle;
  int part = int(vPart + 0.5);
  vec3 P = dir * (uRadius + vHeight);
  vec3 nUp = warpNormal(P, dir);
  float bUp = toonLight(dot(nUp, uSunDir));
  float b = toonLight(dot(n, uSunDir));
  float tuft = gnoise(dir * uRadius * 3.1, uTerrainSeed + 933u);
  vec3 col;
  if (part == 0) {
    Crop c;
    c.variant = vPaddy.x;
    c.maturity = vPaddy.y;
    c.height = vPaddy.z;
    c.water = vPaddy.w;
    c.fallow = vFloor.y;
    c.rows = 0.0;
    vec2 waves = gustWaves(dir);
    float ripple = pixelMeters < 0.6 ? rippleAt(dir) : 0.5;
    float sheen = windSheen(waves, ripple) * uRiceLook.x;
    // the view from above the floor: more of the water between the plants shows looking down
    vec3 eye = unwarpPosition(cameraPosition) - P;
    float cosView = clamp(dot(normalize(eye), dir), 0.0, 1.0);
    // inside the blades' reach they stand there themselves (rice.ts), the paint keeping to what lies under them
    float near = chordAngle(dir, uRiceNear.xyz) * uRadius;
    float blades = uRiceNear.w > 0.5 ? mix(1.0, 0.24, smoothstep(0.45 * uRiceNear.w, uRiceNear.w, near)) * (1.0 - smoothstep(0.78 * uRiceNear.w, uRiceNear.w, near)) : 0.0;
    float cover = cropCover(c.height, cosView) * (1.0 - blades);
    vec3 rice = riceColour(c, bUp);
    vec3 sp = dir * uRadius;
    float mottle = 0.6 * gnoise(sp * 0.7, uTerrainSeed + 931u) + 0.4 * gnoise(sp * 2.3, uTerrainSeed + 932u) * (1.0 - smoothstep(0.08, 0.3, pixelMeters));
    rice *= 1.0 + 0.09 * mottle;
    float tall = smoothstep(0.25, 0.9, c.height);
    rice = mix(rice, pal(TR_RICE, 7) * uSunTint, max(sheen, 0.0) * (0.2 + 0.5 * tall));
    rice *= mix(vec3(1.0), vec3(0.62, 0.72, 0.64), max(-sheen, 0.0) * (0.25 + 0.6 * tall));
    vec3 mud = tone3(pal(TR_EARTH, 4), mix(pal(TR_EARTH, 4), pal(TR_EARTH, 5), 0.5), pal(TR_EARTH, 5), bUp);
    vec3 under = mud;
    if (c.water > 0.0) {
      vec3 vw = normalize(cameraPosition - vWarped);
      float tint = smoothstep(0.3, 0.9, fract(c.variant * 5.31));
      under = paddyWater(dir, vWarped, nUp, vw, bUp, waves.x, tint);
    }
    col = mix(under, rice, cover);
    if (c.fallow > 0.5) {
      vec3 fallow = tone3(mix(pal(TR_EARTH, 0), pal(TR_RICE, 10), 0.5), mix(pal(TR_EARTH, 0), pal(TR_EARTH, 4), 0.5), pal(TR_EARTH, 1), bUp);
      fallow *= 1.0 + 0.08 * mottle;
      col = c.water > 0.0 ? mix(under, fallow, 0.55) : fallow;
    }
  } else if (part == 1) {
    // a riser: grass and earth, lit as it stands, darker toward its foot
    float up = clamp((vHeight - vFloor.x + 1.0) / 1.4, 0.0, 1.0);
    col = tone3(pal(TR_EARTH, 2), mix(pal(TR_EARTH, 2), pal(TR_EARTH, 3), 0.5), pal(TR_EARTH, 3), b);
    col *= mix(0.78, 1.04, up) * (0.92 + 0.12 * tuft);
  } else if (part == 4) {
    // a skirt: earth where the terraced land ends
    col = tone3(pal(TR_EARTH, 3), mix(pal(TR_EARTH, 3), pal(TR_EARTH, 5), 0.5), pal(TR_EARTH, 5), b) * (0.92 + 0.1 * tuft);
  } else {
    // a bund's top and sides, a ridge along a cut: grass over earth, catching the light as pale lines
    col = tone3(pal(TR_EARTH, 7), mix(pal(TR_EARTH, 0), pal(TR_EARTH, 7), 0.4), pal(TR_EARTH, 1), b);
    col *= 0.94 + 0.08 * tuft;
  }
  col = applyAerial(col, viewDist, dir);
  col = applyValleyFog(col, P);
  gl_FragColor = vec4(col, 1.0);
}
