// A butterfly's wing (butterfly.vert.glsl): a forewing and a hindwing cut
// out of the quad, painted by kind, a dark body along the hinge.
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>

varying vec2 vUv;
flat varying float vKind;
varying float vLight;
varying float vDist;
varying vec3 vDir;

vec2 turn(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float disc(vec2 p, vec2 c, float r) {
  return 1.0 - smoothstep(r * 0.75, r, length(p - c));
}

void main() {
  vec2 p = vUv;
  float fore = length(turn(p - vec2(0.48, 0.2), -0.5) / vec2(0.52, 0.31));
  float hind = length(turn(p - vec2(0.36, -0.2), 0.3) / vec2(0.38, 0.29));
  float d = min(fore, hind);
  bool body = p.x < 0.07 && p.y > -0.38 && p.y < 0.46;
  if (d > 1.0 && !body) discard;
  int kind = int(vKind + 0.5);
  float tip = disc(p, vec2(0.86, 0.4), 0.3) * step(fore, 1.0);
  float margin = smoothstep(0.78, 0.98, d);
  vec3 col;
  if (kind == 0) {
    col = mix(pal(ROW_WING, 0), pal(ROW_WING, 1), tip * 0.85);
    col = mix(col, pal(ROW_WING, 1), disc(p, vec2(0.55, 0.16), 0.07) * 0.8);
  } else if (kind == 1) {
    col = mix(pal(ROW_WING, 2), pal(ROW_WING, 3), disc(p, vec2(0.52, 0.18), 0.07) + disc(p, vec2(0.42, -0.2), 0.06));
  } else if (kind == 2) {
    vec2 q = p * 7.0;
    float spots = disc(fract(q + vec2(0.5 * floor(q.y), 0.0)), vec2(0.5), 0.28);
    col = mix(pal(ROW_WING, 4), pal(ROW_WING, 5), max(spots * 0.85, margin));
  } else if (kind == 3) {
    col = mix(pal(ROW_WING, 6), pal(ROW_WING, 7), margin);
    col = mix(col, pal(ROW_WING, 6) * 0.7, (1.0 - smoothstep(0.0, 0.35, p.x)) * 0.5);
  } else if (kind == 4) {
    float bar = 1.0 - smoothstep(0.05, 0.09, abs(dot(turn(p - vec2(0.62, 0.26), 0.0), normalize(vec2(0.75, -0.66)))));
    col = mix(pal(ROW_WING, 12) * 1.4, pal(ROW_WING, 8), step(fore, 1.0) * (1.0 - smoothstep(0.4, 0.7, fore)) + step(1.0, fore) * 0.3);
    col = mix(col, pal(ROW_WING, 9), bar * step(fore, 1.0));
    col = mix(col, pal(ROW_WING, 7), disc(p, vec2(0.86, 0.42), 0.06));
  } else {
    col = mix(pal(ROW_WING, 10), pal(ROW_WING, 11), tip);
  }
  col *= mix(1.0, 0.86, margin);
  if (body) col = pal(ROW_WING, 12);
  col *= vLight * uSunTint;
  gl_FragColor = vec4(applyAerial(col, vDist, vDir), 1.0);
}
