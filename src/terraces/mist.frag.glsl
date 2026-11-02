// A layer of the terraces' mist (mist.vert.glsl), painted as the paintings paint theirs (Kai's references,
// clouds-*): its bands (mist.glsl) flat white bodies, dense down their middles and feathered toward their frayed
// edges, a little uneven as brushed; thinning where the ground comes up to the layer, so it lies round the hills, not
// through them. A thin layer: light from above or below, denser seen aslant, thinning round the camera. White where
// the sun reaches its top, a cool pale grey under it, the clouds' own colours; paling with distance a third as fast
// as the land, as the clouds do.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_sun>
#include <terraces_mist>
uniform float uShell;

#if MIST_LAYER == 0
#define MIST_BANDS uMistBands0
#elif MIST_LAYER == 1
#define MIST_BANDS uMistBands1
#else
#define MIST_BANDS uMistBands2
#endif

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vUp;

void main() {
  vec3 dir = normalize(vDir);
  vec2 band = mistBand(MIST_BANDS, MIST_LAYER, dir);
  if (band.x > 1.3) discard;
  vec3 p = dir * uShell;
  float fray = 0.65 * gnoise(p / 9.0, 0u) + 0.35 * gnoise(p / 3.5, 1u);
  float clear = uShell - uRadius - mistGround(dir);
  float body = mistBody(band, fray) * smoothstep(0.0, 3.0, clear);
  if (body < 0.003) discard;
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec3 up = normalize(vUp);
  float even = 0.8 + 0.2 * gnoise(p / 14.0, 2u);
  float mu = abs(dot(v, up));
  float tau = uMistLayer[MIST_LAYER].w * body * even;
  // (no denser seen aslant where it meets a hillside: it thins away into it)
  float alpha = (1.0 - exp(-tau * mix(1.0, 1.0 / max(mu, 0.3), 0.6 * smoothstep(1.0, 6.0, clear)))) * smoothstep(4.0, 26.0, dist);
  if (alpha < 0.004) discard;
  float above = smoothstep(-0.15, 0.15, dot(v, up));
  float sunUp = clamp(dot(up, uSunDir), 0.0, 1.0);
  vec3 lit = mix(pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 0), 0.5 + 0.5 * sunUp);
  vec3 under = mix(pal(ROW_CLOUD, 1), pal(ROW_CLOUD, 2), 0.45);
  vec3 col = mix(under, lit, above);
  col = mix(col, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, dist - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * alpha, alpha);
}
