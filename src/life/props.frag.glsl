// The homestead, painted (props.ts): warm-white limewashed walls whose stones
// show only where the wash has worn (quoins at the corners, jambs, the
// plinth, a few flaked patches), damp at the foot and ivy up one corner; a
// crooked roof of mossy slates; weathered planks, a little iron, dark glass;
// a stone landing with flagstones and a low arch at the waterline. Soft
// painted light: warm where the sun falls, cool lavender in the shade, and
// the clouds' shadows pass over it as over the meadow. No outlines.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform int uKind; // 0 wall, 1 roof, 2 wood, 3 iron, 4 glass, 5 landing

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;

const float WALL_TOP = 2.3;
// the landing's arch (props.ts LANDING): centre x, springing y, half width, rise; its face z
const vec4 ARCH = vec4(-0.98, -0.45, 0.45, 0.28);
const float LANDING_FRONT = 5.3;

// Irregular courses of stones (p: meters along and up). Near a corner the
// first block of each course is a quoin, long and short by turns. Returns
// a mortar-joint mask (1 on a joint) and a random per stone.
vec2 courses(vec2 p, float course, float len, float corner) {
  float y = p.y / course + 0.16 * gnoise(vec3(p.x * 0.9, 0.0, 7.0), 960u);
  float row = floor(y);
  float fy = fract(y);
  float h = hash12(vec2(row, 3.1));
  float quoin = mod(row, 2.0) < 1.0 ? 0.6 : 0.34;
  float dx;
  float id;
  if (corner < quoin) {
    dx = quoin - corner;
    id = hash12(vec2(row, 91.0)) * 0.5;
  } else {
    float l = len * (0.75 + 0.5 * h);
    float x = p.x / l + h * 5.3;
    float fx = fract(x);
    dx = min(fx, 1.0 - fx) * l;
    id = hash12(vec2(row, floor(x) + 17.0));
  }
  float dy = min(fy, 1.0 - fy) * course;
  float d = min(dx, dy) + 0.005 * gnoise(vec3(p * 9.0, 4.0), 961u);
  float w = fwidth(d) + 1e-4;
  return vec2(1.0 - smoothstep(0.007, 0.018 + w, d), id);
}

// Soft painted light: warm in the sun, cool lavender in the shade.
vec3 painted(vec3 base, vec3 n, float ao, float cloud) {
  float b = smoothstep(-0.28, 0.72, dot(n, uSunDir)) * (1.0 - 0.85 * cloud);
  vec3 shade = base * vec3(0.76, 0.76, 0.87) * uShadeTint;
  vec3 lit = base * vec3(1.03, 1.0, 0.93) * uSunTint;
  return mix(shade, lit, b) * ao;
}

// Ivy leaves: a dab per cell, three greens, dark between.
vec3 ivyLeaves(vec2 p, out float cover) {
  vec2 q = p / 0.085;
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = hash12(cell + 5.3);
  vec2 jitter = vec2(hash12(cell + 1.7), hash12(cell + 8.1)) - 0.5;
  float d = length((f - jitter * 0.4) * vec2(1.0, 1.25));
  cover = smoothstep(0.42, 0.3, d);
  vec3 leaf = h < 0.33 ? pal(ROW_ROOF, 10) : h < 0.7 ? pal(ROW_ROOF, 9) : mix(pal(ROW_ROOF, 9), pal(ROW_ROOF, 11), 0.5);
  return mix(pal(ROW_ROOF, 11), leaf, cover);
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  vec3 v = normalize(toCam);
  float cloud = cloudShadowAt(vPlanet, 0.0);
  vec2 uv = vUv;
  float height = vPaint.z;
  vec3 col;
  if (uKind == 0) {
    // limewash over stone: the stones show where the wash has worn
    float n1 = gnoise(vec3(uv * 1.7, 0.3), 950u);
    float n2 = gnoise(vec3(uv * 0.9, 1.7), 951u);
    float n3 = gnoise(vec3(uv * 4.0, 2.9), 952u);
    float worn = 1.0 - smoothstep(0.05, 0.32, vPaint.x + 0.16 * n1 + 0.06 * n3);
    worn = max(worn, smoothstep(0.38, 0.55, n2) * 0.8);
    vec2 st = courses(uv, 0.25, 0.48, vPaint.y);
    vec3 wash = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 0), smoothstep(-0.45, 0.4, n1 + 0.3 * n3));
    wash = mix(wash, pal(ROW_STONE, 7), smoothstep(0.32, 0.7, n2) * 0.25);
    // the stones under the wash are only a little darker and warmer than it
    vec3 stone = mix(wash, mix(vPaint.y < 0.6 ? pal(ROW_STONE, 9) : pal(ROW_STONE, 3), pal(ROW_STONE, 4), st.y * 0.55), 0.7) * (0.95 + 0.08 * n3);
    vec3 base = mix(wash, stone, worn);
    base = mix(base, pal(ROW_STONE, 5), st.x * mix(0.03, 0.55, worn));
    // damp rising at the foot, and the eaves' shadow along the top
    base = mix(base, pal(ROW_STONE, 6), (1.0 - smoothstep(0.02, 0.55, height + 0.14 * n1)) * 0.5);
    float eave = smoothstep(WALL_TOP - 0.45, WALL_TOP - 0.05, height) * step(height, WALL_TOP + 0.1);
    // ivy climbing from its corner, thinning as it goes
    float grow = vPaint.w * 1.25 - max(height, 0.0) * 0.26 + 0.3 * gnoise(vec3(uv * 1.9, 6.1), 953u) + 0.16 * gnoise(vec3(uv * 6.5, 3.7), 955u);
    float ivy = smoothstep(0.4, 0.47, grow);
    float leaves = 0.0;
    vec3 ivyCol = ivyLeaves(uv, leaves);
    base = mix(base, ivyCol, ivy);
    float ao = mix(0.84, 1.0, smoothstep(0.0, 0.8, height)) * (1.0 - 0.28 * eave);
    col = painted(base, n, ao, cloud);
  } else if (uKind == 1) {
    // slates in wandering courses, mossy
    float rowf = uv.y / 0.2 + 0.22 * gnoise(vec3(uv.x * 0.7, 0.0, 9.0), 970u);
    float row = floor(rowf);
    float fr = fract(rowf);
    float w = 0.3 * (0.85 + 0.3 * hash12(vec2(row, 1.3)));
    float cx = uv.x / w + hash12(vec2(row, 2.7)) * 4.0;
    float fc = fract(cx);
    float tint = hash12(vec2(row, floor(cx)));
    vec3 slate = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 5), tint) * (0.92 + 0.12 * gnoise(vec3(uv * 3.0, 1.0), 974u));
    float aa = fwidth(rowf) + 1e-4;
    float lip = smoothstep(0.8 - aa, 1.0, fr);
    float gap = 1.0 - smoothstep(0.0, 0.05 + fwidth(cx), min(fc, 1.0 - fc));
    slate *= 1.0 - 0.32 * lip - 0.22 * gap * (1.0 - lip);
    float m1 = gnoise(vec3(uv * 0.85, 3.3), 971u);
    float m2 = gnoise(vec3(uv * 2.6, 5.1), 972u);
    float moss = smoothstep(-0.1, 0.5, 0.7 * m1 + 0.3 * m2 + 0.2 * (1.0 - smoothstep(0.0, 0.7, vPaint.x)) + 0.08);
    vec3 mossCol = mix(pal(ROW_ROOF, 7), pal(ROW_ROOF, 6), smoothstep(-0.4, 0.6, m2 + 0.3 * m1));
    // moss lies over the slates: their courses still show through it
    vec3 base = mix(slate, mossCol * (1.0 - 0.22 * lip - 0.1 * gap), moss * 0.78);
    base = mix(base, pal(ROW_ROOF, 8), smoothstep(0.5, 0.72, gnoise(vec3(uv * 7.0, 8.8), 973u)) * 0.35 * (1.0 - moss));
    col = painted(base, n, 1.0, cloud);
  } else if (uKind == 2) {
    // weathered planks
    float plank = floor(uv.x / 0.12 + 0.5);
    float seam = smoothstep(0.0, 0.06 + fwidth(uv.x / 0.12), abs(fract(uv.x / 0.12 + 0.5) - 0.5) * 2.0);
    float t = hash12(vec2(plank, 1.3));
    float grain = gnoise(vec3(uv.x * 30.0, uv.y * 3.0, t * 9.0), 980u);
    vec3 base = mix(pal(ROW_ROOF, 2), mix(pal(ROW_ROOF, 2), pal(ROW_ROOF, 8), 0.3), t * 0.6) * (0.9 + 0.1 * grain);
    col = painted(base * mix(0.72, 1.0, seam), n, 1.0, cloud);
  } else if (uKind == 3) {
    col = painted(pal(ROW_ROOF, 4) * 1.4, n, 1.0, cloud);
  } else if (uKind == 4) {
    // glass: dark, with the sky in it
    float glint = pow(clamp(dot(reflect(-v, n), uSunDir), 0.0, 1.0), 12.0);
    col = mix(vec3(0.06, 0.08, 0.1), pal(ROW_SKY, 1) * 0.65, 0.3 + 0.45 * glint + 0.2 * clamp(dot(n, normalize(vPlanet)), 0.0, 1.0));
  } else {
    // the landing: stone all over, flagstones on top, an arch at the waterline
    bool top = vLocalNormal.y > 0.7;
    vec2 p = top ? vLocal.xz : uv;
    vec2 st = top ? courses(p, 0.7, 0.85, 9.0) : courses(p, 0.27, 0.55, 9.0);
    float n3 = gnoise(vec3(p * 3.0, 2.2), 954u);
    vec3 stone = mix(top ? pal(ROW_STONE, 8) : pal(ROW_STONE, 3), pal(ROW_STONE, 4), st.y * 0.6) * (0.93 + 0.1 * n3);
    vec3 base = mix(stone, pal(ROW_STONE, 5), st.x * 0.7);
    base = mix(base, pal(ROW_STONE, 6), (1.0 - smoothstep(-0.7, -0.3, vLocal.y + 0.1 * n3)) * 0.55);
    if (!top && vLocalNormal.z > 0.7 && abs(vLocal.z - LANDING_FRONT) < 0.05) {
      vec2 q = (vLocal.xy - ARCH.xy) / ARCH.zw;
      float r = length(vec2(q.x, max(q.y, 0.0) * 1.0));
      bool open = abs(q.x) < 1.0 && (q.y < 0.0 || r < 1.0);
      float ring = (1.0 - step(1.36, r)) * step(1.0, r) * step(-0.05, q.y);
      if (open) {
        base = mix(vec3(0.05, 0.085, 0.09), vec3(0.12, 0.2, 0.21), smoothstep(-0.75, -0.55, vLocal.y));
      } else if (ring > 0.0) {
        float a = atan(q.y, q.x) / 3.14159 * 7.0;
        float fa = fract(a);
        float joint = 1.0 - smoothstep(0.0, 0.08 + fwidth(a), min(fa, 1.0 - fa));
        joint = max(joint, 1.0 - smoothstep(0.0, 0.05 + fwidth(r), min(r - 1.0, 1.36 - r)));
        base = mix(pal(ROW_STONE, 3) * (0.9 + 0.15 * hash12(vec2(floor(a), 4.0))), pal(ROW_STONE, 5), joint * 0.7);
      }
    }
    col = painted(base, n, 1.0, cloud);
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), normalize(vPlanet)), 1.0);
}
