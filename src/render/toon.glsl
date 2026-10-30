// Soft toon lighting and the palette. Every colour comes from uPalette
// (16×16, sRGB; texelFetch returns linear). Rows match ROW in palette.ts.
#define ROW_GRASS 0
#define ROW_BRUSH 1
#define ROW_WATER 2
#define ROW_PINK 3
#define ROW_STAR 4
#define ROW_SCATTER 5
#define ROW_SKY 6
#define ROW_CLOUD 7
#define ROW_ROCK 8
#define ROW_SNOW 9
#define ROW_STONE 10
#define ROW_ROOF 11
#define ROW_LIGHT 12
#define ROW_BUD 13

uniform sampler2D uPalette;
uniform vec3 uSunDir;    // toward the sun, planet space
uniform vec3 uSunTint;   // sun colour relative to noon (1 at noon)
uniform vec3 uShadeTint; // sky-light colour relative to noon
uniform vec4 uToon;      // bands, band softness, rim strength, -

vec3 pal(int row, int col) {
  return texelFetch(uPalette, ivec2(col, row), 0).rgb;
}

// N·L → light amount in [0,1], quantised into soft bands.
float toonLight(float ndl) {
  float n = max(uToon.x, 2.0);
  float w = max(uToon.y, 1e-3);
  float acc = 0.0;
  for (int k = 1; k < 5; k++) {
    if (float(k) > n - 1.0) break;
    float t = mix(-0.04, 0.4, (float(k) - 1.0) / max(n - 2.0, 1.0));
    acc += smoothstep(t - 0.5 * w, t + 0.5 * w, ndl);
  }
  return acc / (n - 1.0);
}

// Painted three-tone material: shade → mid → lit, tinted by sun and sky light.
vec3 tone3(vec3 lit, vec3 mid, vec3 shade, float b) {
  vec3 c = b < 0.5 ? mix(shade * uShadeTint, mid * mix(uShadeTint, uSunTint, 0.5), b * 2.0)
                   : mix(mid * mix(uShadeTint, uSunTint, 0.5), lit * uSunTint, b * 2.0 - 1.0);
  return c;
}

// Colour of the light itself: warm where the sun falls, a deep cool green
// under a passing cloud (cloud 0..1, its shadow strength applied): the reds
// go first, the greens and blues hold, as in the painted meadows.
vec3 cloudTint(float cloud) {
  return mix(vec3(1.03, 1.015, 0.95), vec3(0.62, 0.84, 1.02), clamp(cloud, 0.0, 1.0));
}

// A subtle sun-side rim on silhouettes (grass, flower heads, clouds).
float sunRim(vec3 n, vec3 viewDir) {
  float edge = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
  float back = clamp(dot(-viewDir, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  return edge * back * uToon.z;
}
