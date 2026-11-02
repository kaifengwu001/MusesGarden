// A layer of the terraces' mist (mist.vert.glsl), painted as the blue-green landscape paints its ribbons of cloud
// (Kai's references, clouds-*): its strokes (mist.glsl) flat cream bodies, greyer toward their edges and finely
// outlined, a little uneven as brushed; thinning where the ground comes up to the layer, so it lies round the hills, not
// through them. A thin layer: light from above or below, denser seen aslant, thinning round the camera. White where
// the sun reaches its top, a cool pale grey under it, the clouds' own colours; paling with distance a third as fast
// as the land, as the clouds do.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_sun>
#include <terraces_common>
#include <terraces_mist>

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
  float edge = mistEdge(MIST_BANDS, MIST_LAYER, dir);
  if (edge < -0.5) discard;
  vec3 p = dir * (uRadius + uMistLayer[MIST_LAYER].x);
  float fray = 0.3 * gnoise(p / 6.0, 0u);
  vec2 h = mistHeight(MIST_LAYER, dir);
  float clear = h.x - h.y;
  float body = mistBody(edge, fray) * smoothstep(0.0, 0.8, clear);
  if (body < 0.003) discard;
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec3 up = normalize(vUp);
  float even = 0.92 + 0.08 * gnoise(p / 14.0, 2u);
  float mu = abs(dot(v, up));
  float tau = uMistLayer[MIST_LAYER].w * body * even;
  // (no denser seen aslant where it meets a hillside: it thins away into it)
  float alpha = (1.0 - exp(-tau * mix(1.0, 1.0 / max(mu, 0.3), 0.6 * smoothstep(1.0, 6.0, clear)))) * smoothstep(2.0, 10.0, dist);
  if (alpha < 0.004) discard;
  // (as the painting's ribbons: a cream core, greyer toward its edge, a fine outline darker still; its underside
  // greyer, its top as lit as the sun reaches it)
  float above = smoothstep(-0.15, 0.15, dot(v, up));
  float sunUp = clamp(dot(up, uSunDir), 0.0, 1.0);
  vec3 col = mix(pal(TR_FOG, 4), pal(TR_FOG, 5), smoothstep(1.3, 0.35, edge));
  col = mix(col, pal(TR_FOG, 6), smoothstep(0.38, 0.06, edge + 0.2 * fray) * 0.8);
  col *= mix(0.86, 1.0, above) * mix(0.93, 1.03, sunUp);
  col = mix(col, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, dist - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * alpha, alpha);
}
