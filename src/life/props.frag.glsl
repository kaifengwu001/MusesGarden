// The homestead, painted (props.ts) the way the meadow paintings paint their
// cottages, with the brush rather than with detail:
//   walls    plastered and washed a butter cream, laid on in horizontal
//            strokes, mottled warm (ochre, a little pink) and cool (grey);
//            the stones only hinted: faint courses, and a few blocks
//            outlined at the corners, round the openings and along the foot,
//            where the plaster thins; a darker stroke down each corner,
//            damp and a little green at the foot
//   roof     dark brown-grey tiles in strong courses, each lit along its
//            lower lip and dark where the next course overlaps it; moss in
//            yellow-green drifts, heavier low down and streaking down the
//            slope; paler capping tiles on the hips and the ridge; the
//            tiles' rounded ends along the eaves
//   wood     a warm plank door with iron straps, dark window frames, a bench
//   glass    small panes full of the meadow's light: green below, sky above
//   landing  pale stone with faint joints, damp at the waterline, a brick arch
// The shadows are painted too: a cool band under the eaves, walls turned
// from the sun a duller and darker cream (never blue), and the clouds'
// shadows passing over. The ground's shadow is in terrain.glsl. No outlines.
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

const float WALL_TOP = 2.1;
// the landing's arch (props.ts LANDING): centre x, springing y, half width, rise; its face z
const vec4 ARCH = vec4(-1.4, -0.45, 0.45, 0.28);
const float LANDING_FRONT = 5.3;

// Irregular courses of stones (p: meters along and up). Near a corner the
// first block of each course is long and short by turns. Returns a joint
// mask (1 on a joint) and a random per stone.
vec2 courses(vec2 p, float course, float len, float corner) {
  float y = p.y / course + 0.18 * gnoise(vec3(p.x * 0.9, 0.0, 7.0), 960u);
  float row = floor(y);
  float fy = fract(y);
  float h = hash12(vec2(row, 3.1));
  float quoin = mod(row, 2.0) < 1.0 ? 0.55 : 0.32;
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
  float d = min(dx, dy) + 0.006 * gnoise(vec3(p * 9.0, 4.0), 961u);
  float w = fwidth(d) + 1e-4;
  return vec2(1.0 - smoothstep(0.006, 0.02 + w, d), id);
}

// Painted light: warm where the sun falls; turned away, the same colour
// duller and darker, with a little of the meadow's green bounced up into it.
vec3 painted(vec3 base, vec3 n, float cloud) {
  float b = smoothstep(-0.3, 0.6, dot(n, uSunDir)) * (1.0 - 0.85 * cloud);
  vec3 shade = base * vec3(0.84, 0.83, 0.79) * mix(vec3(1.0), uShadeTint, 0.5) + pal(ROW_LIGHT, 2) * 0.035 * clamp(0.6 - n.y, 0.0, 1.0);
  vec3 lit = base * vec3(1.04, 1.01, 0.94) * uSunTint;
  return mix(shade, lit, b);
}

// A brush stroke field: long along x, narrow, a little wavy; in [-1, 1].
float strokes(vec2 p, float along, float across, uint seed) {
  return gnoise(vec3(p.x * along, p.y * across + 0.6 * sin(p.x * 1.3), 0.37), seed);
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
    bool plain = vPaint.w > 0.5;
    // the wash: horizontal strokes over broad warm and cool patches
    float s1 = strokes(uv, 1.3, 7.0, 950u);
    float s2 = strokes(uv, 3.1, 15.0, 951u);
    float blot = gnoise(vec3(uv * 0.75, 2.9), 952u);
    vec3 base = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 0), smoothstep(-0.45, 0.45, 0.75 * s1 + 0.55 * blot));
    base = mix(base, pal(ROW_STONE, 7), smoothstep(0.12, 0.55, blot) * 0.28);
    base = mix(base, pal(ROW_STONE, 3), smoothstep(0.15, 0.55, -blot) * 0.22);
    base *= 0.97 + 0.06 * s2;
    if (!plain) {
      // the stones, only hinted: the faintest courses over the wall, a few
      // blocks outlined near the corners, the openings and the foot
      vec2 st = courses(uv, 0.24, 0.5, vPaint.y);
      float near = 1.0 - smoothstep(0.05, 0.36, vPaint.x + 0.12 * blot);
      base = mix(base, pal(ROW_STONE, 5), st.x * (0.035 + 0.24 * near) * smoothstep(-0.6, 0.2, s1));
      base = mix(base, mix(pal(ROW_STONE, 3), pal(ROW_STONE, 9), st.y), near * 0.18);
      // a darker stroke down each corner, damp and a little green at the foot
      base *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.2, vPaint.y + 0.04 * s1));
      base = mix(base, pal(ROW_STONE, 6), (1.0 - smoothstep(0.0, 0.42, height + 0.1 * s1)) * 0.55);
    }
    col = painted(base, n, cloud);
    // the eaves' shadow, painted on all round (the sun is high): a cool band under the roof
    float eave = plain ? 0.0 : smoothstep(WALL_TOP - 0.55 + 0.05 * s1, WALL_TOP - 0.25, height) * step(height, WALL_TOP + 0.3);
    col = mix(col, col * pal(ROW_STONE, 10) / pal(ROW_STONE, 1), eave);
  } else if (uKind == 1) {
    if (vPaint.w > 0.5) {
      // the eave's edge: the tiles' rounded ends, dark underneath
      float k = fract(uv.x / 0.23 + 0.5 * hash12(vec2(floor(uv.x / 0.23), 5.0)));
      float lip = smoothstep(0.0, 0.3, min(k, 1.0 - k)) * smoothstep(0.0, 0.07, uv.y);
      col = painted(mix(pal(ROW_ROOF, 1) * 0.8, pal(ROW_ROOF, 5), lip), n, cloud);
    } else {
      // courses wandering a little; each tile's lower lip lit, the top of the course under the next one's shadow
      float rowf = uv.y / 0.21 + 0.25 * gnoise(vec3(uv.x * 0.6, 0.0, 9.0), 970u);
      float row = floor(rowf);
      float fr = fract(rowf);
      float w = 0.27 * (0.85 + 0.3 * hash12(vec2(row, 1.3)));
      float cx = uv.x / w + hash12(vec2(row, 2.7)) * 4.0;
      float fc = fract(cx);
      float tint = hash12(vec2(row, floor(cx)));
      float aa = fwidth(rowf) + 1e-4;
      float lip = smoothstep(0.0, 0.1 + aa, fr) * (1.0 - smoothstep(0.12, 0.55, fr));
      float under = smoothstep(0.74 - aa, 1.0, fr);
      float joint = 1.0 - smoothstep(0.0, 0.05 + fwidth(cx), min(fc, 1.0 - fc));
      vec3 tile = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 5), tint * 0.55) * (0.94 + 0.1 * gnoise(vec3(uv * 2.5, 1.0), 974u));
      tile = mix(tile, pal(ROW_ROOF, 5) * 1.22, lip * 0.9);
      tile *= 1.0 - 0.55 * under - 0.25 * joint * (1.0 - under);
      // moss: small yellow-green drifts on the tiles' lips, heavier low down
      float up = vPaint.z;
      float m1 = gnoise(vec3(uv.x * 1.15, uv.y * 0.85, 3.3), 971u);
      float m2 = gnoise(vec3(uv.x * 2.7, uv.y * 2.1, 5.1), 972u);
      float m3 = gnoise(vec3(uv.x * 6.5, uv.y * 4.8, 6.7), 975u);
      float moss = smoothstep(0.02, 0.38, 0.55 * m1 + 0.35 * m2 + 0.18 * m3 + 0.4 * (1.0 - smoothstep(0.05, 0.65, up)) - 0.02);
      moss *= 0.5 + 0.5 * smoothstep(0.0, 0.6, lip + 0.35 * (1.0 - under));
      vec3 mossCol = mix(pal(ROW_ROOF, 7), pal(ROW_ROOF, 6), smoothstep(-0.2, 0.6, m3 + 0.7 * lip));
      vec3 base = mix(tile, mossCol * (1.0 - 0.4 * under), moss * 0.8);
      // paler capping tiles along the hips and the ridge
      float cap = max(1.0 - smoothstep(0.08, 0.16, vPaint.y), smoothstep(0.965, 0.99, up));
      float capCourse = fract(vPaint.x / 0.3);
      vec3 capCol = mix(pal(ROW_ROOF, 8), pal(ROW_ROOF, 0), smoothstep(0.75, 1.0, capCourse) * 0.6);
      base = mix(base, mix(capCol, mossCol, moss * 0.4), cap * 0.85);
      col = painted(base, n, cloud);
    }
  } else if (uKind == 2) {
    if (vPaint.w > 0.5 && vPaint.w < 1.5) {
      // the door: warm planks with dark seams, two iron straps
      float plank = floor(uv.x / 0.14 + 0.5);
      float seam = smoothstep(0.0, 0.06 + fwidth(uv.x / 0.14), abs(fract(uv.x / 0.14 + 0.5) - 0.5) * 2.0);
      float t = hash12(vec2(plank, 1.3));
      float grain = gnoise(vec3(uv.x * 26.0, uv.y * 2.2, t * 9.0), 980u);
      vec3 base = mix(pal(ROW_ROOF, 2), pal(ROW_ROOF, 3), 0.25 + 0.3 * t + 0.15 * grain) * mix(0.68, 1.0, seam);
      float strap = max(1.0 - smoothstep(0.03, 0.045, abs(height - 0.32)), 1.0 - smoothstep(0.03, 0.045, abs(height - 1.38)));
      strap *= smoothstep(0.0, 0.05, uv.x) * (1.0 - smoothstep(0.55, 0.62, uv.x));
      base = mix(base, pal(ROW_ROOF, 4), strap);
      col = painted(base, n, cloud);
    } else if (vPaint.w > 1.5) {
      // the bench: weathered, warm
      float grain = gnoise(vec3(uv.x * 20.0, uv.y * 3.0, 4.4), 981u);
      col = painted(mix(pal(ROW_ROOF, 2), pal(ROW_ROOF, 8), 0.35) * (0.92 + 0.08 * grain), n, cloud);
    } else {
      col = painted(pal(ROW_ROOF, 9), n, cloud);
    }
  } else if (uKind == 3) {
    col = painted(pal(ROW_ROOF, 4) * 1.4, n, cloud);
  } else if (uKind == 4) {
    // glass: the meadow's light below, the sky above, each small pane a little different, a glint
    float up = clamp((vLocal.y - 0.85) / 0.75, 0.0, 1.0);
    vec3 refl = mix(pal(ROW_ROOF, 10), pal(ROW_ROOF, 11), smoothstep(0.3, 0.85, up + 0.15 * gnoise(vec3(uv * 4.0, 2.0), 982u)));
    refl *= 0.86 + 0.18 * hash12(floor(uv / vec2(0.29, 0.22)) + 2.0);
    float glint = pow(clamp(dot(reflect(-v, n), uSunDir), 0.0, 1.0), 10.0);
    col = mix(refl * mix(vec3(1.0), uShadeTint, 0.3), pal(ROW_LIGHT, 3), glint * 0.4) * (1.0 - 0.3 * cloud);
  } else {
    // the landing: pale stone, faint joints, damp at the waterline, a brick arch
    bool top = vLocalNormal.y > 0.7;
    vec2 p = top ? vLocal.xz : uv;
    float s1 = strokes(p, 1.1, 5.0, 953u);
    vec2 st = top ? courses(p, 0.85, 1.0, 9.0) : courses(p, 0.27, 0.6, 9.0);
    vec3 base = mix(top ? pal(ROW_STONE, 8) : pal(ROW_STONE, 9), pal(ROW_STONE, 3), st.y * 0.22 + 0.1 * s1);
    base = mix(base, pal(ROW_STONE, 5), st.x * (top ? 0.12 : 0.2));
    base = mix(base, pal(ROW_STONE, 6) * 0.82, (1.0 - smoothstep(-0.72, -0.4, vLocal.y + 0.08 * s1)) * 0.6);
    if (!top && vLocalNormal.z > 0.7 && abs(vLocal.z - LANDING_FRONT) < 0.05) {
      vec2 q = (vLocal.xy - ARCH.xy) / ARCH.zw;
      float r = length(vec2(q.x, max(q.y, 0.0)));
      bool open = abs(q.x) < 1.0 && (q.y < 0.0 || r < 1.0);
      float ring = (1.0 - step(1.38, r)) * step(1.0, r) * step(-0.05, q.y);
      if (open) {
        base = mix(vec3(0.06, 0.09, 0.09), vec3(0.13, 0.2, 0.2), smoothstep(-0.75, -0.55, vLocal.y));
      } else if (ring > 0.0) {
        float a = atan(q.y, q.x) / 3.14159 * 9.0;
        float fa = fract(a);
        float joint = 1.0 - smoothstep(0.0, 0.1 + fwidth(a), min(fa, 1.0 - fa));
        joint = max(joint, 1.0 - smoothstep(0.0, 0.05 + fwidth(r), min(r - 1.0, 1.38 - r)));
        base = mix(mix(pal(ROW_STONE, 12), pal(ROW_STONE, 13), hash12(vec2(floor(a), 4.0)) * 0.6), pal(ROW_STONE, 5), joint * 0.6);
      }
    }
    col = painted(base, n, cloud);
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), normalize(vPlanet)), 1.0);
}
