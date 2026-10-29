// Painted water: flat, a shallow → deep gradient, a pale shore band, faint
// sky reflection, wind-aligned light streaks, sparkle glints and click
// ripples. No refraction. Requires toon, meadow (windDir, strokes, dabs).

#define MAX_RIPPLES 6
uniform vec4 uWaterLook;             // shore band (m), depth tint, sparkle, time
uniform vec4 uRipples[MAX_RIPPLES];  // centre direction, start time (s); w < 0 = unused

float rippleAt(vec3 dir) {
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

vec3 waterColour(vec3 dir, float water, float b, vec3 n, vec3 viewDir, float pixelMeters) {
  float depth = clamp(-water / 2.4, 0.0, 1.0);
  vec3 shallow = pal(ROW_WATER, 0);
  vec3 deep = pal(ROW_WATER, 1);
  vec3 col = mix(shallow, deep, smoothstep(0.02, 1.0, depth) * (0.35 + 0.65 * uWaterLook.y));
  // wind-aligned light streaks: sky caught on gentle swell
  vec3 along = windDir(dir);
  float f0, f1;
  float t = patternOctaves(2.4, pixelMeters, 6.0, f0, f1);
  float s = mix(strokes(dir, f0, along, uTerrainSeed + 120u), strokes(dir, f1, along, uTerrainSeed + 121u), t);
  col = mix(col, pal(ROW_WATER, 4), smoothstep(0.25, 0.8, s) * 0.5);
  // faint sky reflection at grazing angles
  float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
  col = mix(col, mix(pal(ROW_SKY, 1), pal(ROW_SKY, 2), 0.5), fresnel * 0.55);
  // pale shore band just inside the edge
  float band = smoothstep(-uWaterLook.x, -uWaterLook.x * 0.25, water);
  col = mix(col, pal(ROW_WATER, 2), band * 0.85);
  // sparkle glints: short dashes, brightest toward the sun, flickering with the wind
  float sp;
  t = patternOctaves(0.35, pixelMeters, 2.5, f0, f1);
  float flick = floor(uWaterLook.w * 2.3);
  float glint = mix(dabs(dir + along * 0.0007 * sin(uWaterLook.w), f0, 0.12, uTerrainSeed + 130u + uint(flick), sp),
                    dabs(dir, f1, 0.12, uTerrainSeed + 131u + uint(flick), sp), t);
  vec3 h = normalize(uSunDir + viewDir);
  float toward = pow(clamp(dot(n, h), 0.0, 1.0), 24.0);
  col += pal(ROW_WATER, 3) * glint * (0.25 + 1.6 * toward) * uWaterLook.z * (1.0 - band);
  // ripples from clicks
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleAt(dir), 0.0, 1.0) * 0.55);
  return tone3(col, col * 0.96, col * 0.84, max(b, 0.55));
}
