// Painted water as a mirror (天光云影共徘徊). Along the view ray mirrored off
// the surface, three things can show, nearest first:
//   the banks   the meadow's edge and the ground behind it, marched over the
//               terrain (with its bank lip and its grass). This is the dark
//               navy band under every shore: as tall as the bank and the
//               meadow behind it, so it widens and narrows along the shore
//   the cottage its terrace, pier, walls, roof and chimney as plain solids
//               (homeSegment), painted in a few broad strokes (homeColour);
//               stepped along the same ray as the banks (homeAlong after
//               bankAlong), so whichever is nearer shows
//   the clouds  the same puffs the sky shows, drawn from the mirrored camera
//               (cloudsInMirror, clouds.glsl); from orbit, the cloud cover
//               seen from below (cloudsFromOrbit)
//   the sky     painted as the deep cobalt of the lakes, paler toward the horizon
// Looking down into the water you see more of its navy body, looking across
// it more of the mirror. Gusts ruffle the mirror into streaks; a few glints
// swell and fade (never pop); clicks ripple. No refraction.
// Requires: toon, meadow (windDir, patternOctaves), terrain (height0, uBank,
// uCottage), warp (unwarpPosition), clouds (cloudsInMirror, localSun), uResolution.

#define MAX_RIPPLES 6
uniform vec4 uWaterLook;             // -, depth tint, glints, time (s)
uniform vec4 uWaterSky;              // reflection strength, lily pads, grass height in the mirror (m), highest meadow (m)
uniform vec4 uRipples[MAX_RIPPLES];  // centre direction, start time (s); w < 0 = unused

float rippleRing(vec3 dir) {
  float acc = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = uRipples[i];
    if (r.w < 0.0) continue;
    float age = uWaterLook.w - r.w;
    if (age < 0.0 || age > 4.0) continue;
    float d = chordAngle(dir, r.xyz) * uRadius;
    float ring = d - age * 1.6;
    float wave = exp(-ring * ring / 0.02) + 0.6 * exp(-(ring + 0.5) * (ring + 0.5) / 0.02);
    acc += wave * (1.0 - age / 4.0) * smoothstep(0.0, 0.3, age);
  }
  return acc;
}

vec3 waterColour(vec3 dir, vec3 wp, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec3 col = mix(pal(ROW_WATER, 0), pal(ROW_WATER, 1), facing * 0.65);
  col = mix(col, pal(ROW_WATER, 4), (1.0 - facing) * 0.22);
  vec2 c = cottageLocal(dir);
  float row = floor(c.y * 4.0);
  float phase = sin(row * 37.17) * 6.0;
  float cell = fract(c.x * 1.75 + phase);
  float line = abs(fract(c.y * 4.0 + sin(c.x * 0.7 + uWaterLook.w * 0.18) * 0.07) - 0.5);
  float broken = smoothstep(0.12, 0.25, cell) * (1.0 - smoothstep(0.60, 0.78, cell));
  float mark = (1.0 - smoothstep(0.025, 0.09, line)) * broken * smoothstep(0.5, 0.04, pixelMeters);
  col = mix(col, pal(ROW_WATER, 9), mark * 0.43);
  col = mix(col, pal(ROW_WATER, 8), smoothstep(-1.3, -0.05, shore) * 0.5);
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.55);
  return col * (1.0 - cloud * 0.08);
}
