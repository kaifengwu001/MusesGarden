// A butterfly's wings: a rounded outline cut from each quad (uv: along the
// span from the body, and across from the leading edge) and the pattern of
// its kind, painted flat, with a darker rim. The body is dark.
//   0 white        cream white, dark grey tips and a spot
//   1 sulphur      lemon yellow with an orange dot
//   2 orange-tip   white with orange forewing tips
//   3 blue         sky blue, deeper by the body, a dark rim and a white fringe
//   4 tortoiseshell orange with dark bars and a row of blue spots
//   5 peacock      red-brown with an eye on each wing
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>

varying vec2 vUv;
varying float vPart;
flat varying float vKind;
varying float vLight;
varying float vDist;
varying vec3 vDir;

float spot(vec2 uv, vec2 at, float r) {
  return 1.0 - smoothstep(r * 0.75, r, length(uv - at));
}

vec3 wing(int kind, bool fore, vec2 uv, float inside) {
  vec3 col;
  float rim = 1.0 - smoothstep(0.04, 0.16, inside);
  if (kind == 0) {
    col = vec3(0.96, 0.95, 0.9);
    if (fore) col = mix(col, vec3(0.3, 0.3, 0.32), smoothstep(0.7, 0.86, uv.x) * (1.0 - 0.7 * uv.y) + spot(uv, vec2(0.58, 0.58), 0.08));
  } else if (kind == 1) {
    col = vec3(0.95, 0.88, 0.38);
    col = mix(col, vec3(0.93, 0.55, 0.2), spot(uv, fore ? vec2(0.55, 0.5) : vec2(0.5, 0.45), 0.06));
  } else if (kind == 2) {
    col = vec3(0.97, 0.96, 0.92);
    if (fore) col = mix(col, vec3(0.95, 0.52, 0.18), smoothstep(0.5, 0.6, uv.x) * (1.0 - smoothstep(0.86, 0.95, uv.x)));
    if (fore) col = mix(col, vec3(0.35, 0.35, 0.36), smoothstep(0.88, 0.97, uv.x) * 0.8);
  } else if (kind == 3) {
    col = mix(vec3(0.38, 0.5, 0.82), vec3(0.56, 0.72, 0.95), smoothstep(0.0, 0.6, uv.x));
    col = mix(col, vec3(0.2, 0.22, 0.3), rim);
    col = mix(col, vec3(0.97), 1.0 - smoothstep(0.0, 0.05, inside));
    return col;
  } else if (kind == 4) {
    col = vec3(0.91, 0.5, 0.2);
    if (fore) col = mix(col, vec3(0.16, 0.12, 0.1), spot(uv, vec2(0.4, 0.2), 0.12) + spot(uv, vec2(0.62, 0.18), 0.1) + smoothstep(0.82, 0.92, uv.x) * 0.9);
    else col = mix(col, vec3(0.16, 0.12, 0.1), smoothstep(0.42, 0.25, uv.x));
    col = mix(col, vec3(0.35, 0.5, 0.85), rim * step(0.5, fract(uv.x * 5.0 + uv.y * 2.0)) * 0.8);
  } else {
    col = vec3(0.62, 0.22, 0.18);
    vec2 eye = fore ? vec2(0.74, 0.3) : vec2(0.6, 0.58);
    col = mix(col, vec3(0.95, 0.82, 0.45), spot(uv, eye, 0.17));
    col = mix(col, vec3(0.3, 0.42, 0.75), spot(uv, eye, 0.11));
    col = mix(col, vec3(0.08), spot(uv, eye, 0.05));
  }
  return mix(col, col * 0.62, rim);
}

void main() {
  float part = abs(vPart);
  vec3 col;
  if (part < 0.5) {
    if (abs(vUv.x - 0.5) * (1.4 - abs(vUv.y - 0.5)) > 0.45) discard;
    col = vec3(0.13, 0.11, 0.1);
  } else {
    bool fore = part < 1.5;
    // forewing: long and swept, widest toward the tip; hindwing: rounder
    vec2 q = fore ? (vUv - vec2(0.5, 0.42)) / vec2(0.54, 0.5 + 0.12 * vUv.x) : (vUv - vec2(0.46, 0.48)) / vec2(0.5, 0.52);
    float inside = 1.0 - dot(q, q);
    if (inside < 0.0) discard;
    col = wing(int(vKind + 0.5), fore, vUv, inside);
  }
  col *= vLight;
  gl_FragColor = vec4(applyAerial(col, vDist, vDir), 1.0);
}
