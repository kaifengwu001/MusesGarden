// Cottage materials: hand-built stone, slate shingles, planks, iron, glass.
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
uniform int uKind; // 0 stone, 1 roof, 2 wood, 3 iron, 4 glass, 5 mortar

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying float vTint;

void main() {
#ifdef OUTLINE
  gl_FragColor = vec4(pal(ROW_ROOF, 4), 1.0);
  return;
#endif
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  vec3 v = normalize(toCam);
  float b = toonLight(dot(n, uSunDir));
  vec3 col;
  if (uKind == 0) {
    // stone: per-stone tint between the stone colours, a little lighter on top
    vec3 lit = mix(pal(ROW_STONE, 0), pal(ROW_STONE, 3), smoothstep(0.6, 1.0, vTint));
    vec3 mid = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 0), vTint);
    vec3 shade = mix(pal(ROW_STONE, 2), pal(ROW_ROCK, 3), 0.25);
    col = tone3(lit, mid, shade, b) * (0.9 + 0.2 * vTint);
  } else if (uKind == 1) {
    // slate shingles: staggered rows with per-shingle tint and a dark course line
    vec2 uv = vUv / vec2(0.36, 0.27);
    float row = floor(uv.y);
    float offset = mod(row, 2.0) * 0.5;
    float colIdx = floor(uv.x + offset);
    float tintS = hash12(vec2(row, colIdx) + 3.7);
    vec2 aa = max(fwidth(uv), vec2(1e-4)) * 1.2;
    float course = smoothstep(0.0, 0.1 + aa.y, fract(uv.y));
    float joint = smoothstep(0.0, 0.05 + aa.x, fract(uv.x + offset)) * smoothstep(0.0, 0.05 + aa.x, 1.0 - fract(uv.x + offset));
    vec3 lit = mix(pal(ROW_ROOF, 5), pal(ROW_ROOF, 0), tintS);
    col = tone3(lit, pal(ROW_ROOF, 0), pal(ROW_ROOF, 1), b) * (0.84 + 0.28 * tintS);
    col *= mix(0.62, 1.0, course) * mix(0.8, 1.0, joint);
  } else if (uKind == 2) {
    // wood: vertical planks with seams
    float plank = floor(vLocal.x / 0.13 + 0.5);
    float seam = smoothstep(0.0, 0.05, abs(fract(vLocal.x / 0.13 + 0.5) - 0.5) * 2.0);
    float t = hash12(vec2(plank, 1.3));
    col = tone3(pal(ROW_ROOF, 2) * (0.92 + 0.16 * t), pal(ROW_ROOF, 2), pal(ROW_ROOF, 3), b) * mix(0.8, 1.0, seam);
  } else if (uKind == 3) {
    col = tone3(pal(ROW_ROOF, 4) * 1.6, pal(ROW_ROOF, 4) * 1.2, pal(ROW_ROOF, 4), b);
  } else if (uKind == 4) {
    // glass: dark, with a sky glint
    float glint = pow(clamp(dot(reflect(-v, n), uSunDir), 0.0, 1.0), 12.0);
    col = mix(vec3(0.05, 0.07, 0.09), pal(ROW_SKY, 1) * 0.6, 0.35 + 0.4 * glint);
  } else {
    col = tone3(pal(ROW_STONE, 4), pal(ROW_STONE, 4) * 0.9, pal(ROW_STONE, 4) * 0.7, b);
  }
  col += pal(ROW_LIGHT, 3) * sunRim(n, v) * 0.1;
  gl_FragColor = vec4(applyAerial(col, length(toCam), normalize(vWorld)), 1.0);
}
