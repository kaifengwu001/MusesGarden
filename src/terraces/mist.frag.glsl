// A band of mist (mist.vert.glsl), painted as the paintings paint theirs (Kai's references, clouds-*): a flat white
// body, dense down its middle and feathered toward its edges, the edges frayed a little along it, brushed with faint
// streaks the way it runs. A thin layer: light from above or below, as dense as its breadth seen edge-on. White
// where the sun reaches its top, a cool pale grey under it, the clouds' own colours; paling with distance a third as
// fast as the land, as the clouds do.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>

varying vec3 vWarped;
varying vec3 vUp;
varying vec4 vBand;

void main() {
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec3 up = normalize(vUp);
  float x = vBand.x;
  float s = vBand.y;
  float seed = vBand.z * 97.0;
  // (its edge, frayed: by a slow noise along it and a quicker one, more toward its edges)
  float fray = 0.65 * gnoise(vec3(s / 11.0, x * 1.2, seed), 0u) + 0.35 * gnoise(vec3(s / 5.0, x * 2.0, seed + 13.0), 1u);
  float body = smoothstep(1.0, 0.62, abs(x) + 0.2 * fray * smoothstep(0.4, 0.9, abs(x)));
  // (brushed streaks along it)
  float streak = 0.5 + 0.5 * gnoise(vec3(s / 16.0, x * 5.0, seed + 29.0), 2u);
  // (denser seen aslant, as a thin layer is, but never a wall; thinning away round the camera, as the clouds do)
  float mu = abs(dot(v, up));
  float tau = 3.2 * body * mix(0.75, 1.0, streak);
  float alpha = (1.0 - exp(-tau * mix(1.0, 1.0 / max(mu, 0.3), 0.6))) * smoothstep(4.0, 26.0, dist);
  if (alpha < 0.004) discard;
  float above = smoothstep(-0.15, 0.15, dot(v, up));
  float sunUp = clamp(dot(up, uSunDir), 0.0, 1.0);
  vec3 lit = mix(pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 0), 0.5 + 0.5 * sunUp);
  vec3 under = mix(pal(ROW_CLOUD, 1), pal(ROW_CLOUD, 2), 0.45);
  vec3 col = mix(under, lit, above);
  col = mix(col, pal(ROW_CLOUD, 3), 0.18 * streak * above);
  col = mix(col, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, dist - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * alpha, alpha);
}
