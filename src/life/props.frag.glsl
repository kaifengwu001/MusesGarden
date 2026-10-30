// The homestead, painted (props.ts): walls limewashed a warm butter cream,
// laid on in short strokes and mottled, stained where rain runs down from
// the eaves and damp rises from the ground, cool in the eaves' shadow, the
// stones under the wash only hinted near the corners and openings; a crooked
// roof of tiles in courses, each course lit at its foot and dark under the
// next, mossy, with ridge and hip tiles; a warm plank door with iron straps,
// small-paned windows that mirror the meadow; a plastered landing with a
// brick arch at the waterline. Soft painted light: warm where the sun falls,
// cool lavender in the shade, and the clouds' shadows pass over it as over
// the meadow. No outlines.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform int uKind; // 0 wall, 1 roof, 2 wood, 3 iron, 4 glass, 5 landing, 6 window frames

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;

const float WALL_TOP = 2.1;
// the landing's arch (props.ts LANDING): centre x, springing y, half width, rise; its face z
const vec4 ARCH = vec4(-0.98, -0.45, 0.45, 0.28);
const float LANDING_FRONT = 5.3;

// Brushwork: tone laid on in strokes (p in meters, dir the strokes' run,
// size their width): noise stretched along them, half stepped into a few
// tones like dabs of paint. In [-1, 1].
float strokes(vec2 p, vec2 dir, float size, uint seed) {
  vec2 q = vec2(dot(p, dir) / (size * 3.5), dot(p, vec2(-dir.y, dir.x)) / size);
  float n = (0.7 * gnoise(vec3(q, 0.0), seed) + 0.3 * gnoise(vec3(q * 2.3, 1.7), seed + 1u)) * 1.9;
  return clamp(mix(n, floor(n * 2.5 + 0.5) / 2.5, 0.55), -1.0, 1.0);
}

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

// Soft painted light: warm in the sun, cool lavender in the shade. shadow:
// the clouds' and the eaves' (0..1).
vec3 painted(vec3 base, vec3 n, float ao, float shadow) {
  float b = smoothstep(-0.28, 0.72, dot(n, uSunDir)) * (1.0 - 0.85 * shadow);
  vec3 shade = base * vec3(0.74, 0.75, 0.87) * uShadeTint;
  vec3 lit = base * vec3(1.04, 1.0, 0.92) * uSunTint;
  return mix(shade, lit, b) * ao;
}

// Plaster as the walls and the landing wear it: warm cream in strokes,
// mottled ochre and grey, damp rising green-grey from the foot (height: m
// above the ground or the water).
vec3 plaster(vec2 p, float height, vec2 dir, uint seed) {
  float s1 = strokes(p, dir, 0.13, seed);
  float s2 = strokes(p, dir * mat2(0.95, 0.31, -0.31, 0.95), 0.05, seed + 4u);
  vec3 wash = mix(pal(ROW_STONE, 1), pal(ROW_STONE, 0), clamp(0.5 + 0.45 * s1 + 0.25 * s2, 0.0, 1.0));
  float m = gnoise(vec3(p * 0.8, 3.0), seed + 8u);
  float m2 = gnoise(vec3(p * 1.9, 5.0), seed + 9u);
  wash = mix(wash, pal(ROW_STONE, 7), smoothstep(0.05, 0.45, m + 0.2 * s2) * 0.6);
  wash = mix(wash, pal(ROW_STONE, 13), smoothstep(0.15, 0.55, m2 + 0.2 * s1) * 0.35);
  wash = mix(wash, pal(ROW_STONE, 10), smoothstep(-0.1, -0.45, m + 0.15 * s1) * 0.5);
  float damp = 1.0 - smoothstep(0.05, 0.85, height + 0.25 * s1 + 0.15 * m);
  return mix(wash, pal(ROW_STONE, 6), damp * 0.7);
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
    vec3 base = plaster(uv, height, vec2(0.15, 0.99), 950u);
    // rain: streaks running down from under the eaves
    float streak = strokes(uv, vec2(0.0, 1.0), 0.045, 956u);
    base = mix(base, pal(ROW_STONE, 10), smoothstep(0.25, 0.75, streak) * smoothstep(1.1, 0.0, WALL_TOP - height) * 0.4);
    // the stones under the wash, hinted near the corners and openings only,
    // and a darker ochre stroke down each corner, as the painters edge them
    float m = gnoise(vec3(uv * 1.3, 6.0), 959u);
    float near = (1.0 - smoothstep(0.06, 0.34, vPaint.x + 0.1 * m)) * vPaint.w;
    vec2 st = courses(uv, 0.24, 0.5, vPaint.y);
    base = mix(base, mix(pal(ROW_STONE, 9), pal(ROW_STONE, 3), st.y), near * 0.45);
    base = mix(base, pal(ROW_STONE, 5), st.x * near * 0.35);
    float edgeStroke = (1.0 - smoothstep(0.0, 0.07 + 0.03 * streak, vPaint.y)) * vPaint.w;
    base = mix(base, pal(ROW_STONE, 4), edgeStroke * 0.5);
    // the eaves' shadow: a band under the roof, its lower edge brushed
    float eave = smoothstep(WALL_TOP - 0.62 + 0.06 * streak, WALL_TOP - 0.46, height) * step(height, WALL_TOP + 0.4);
    float ao = mix(0.86, 1.0, smoothstep(0.0, 0.7, height));
    col = painted(base, n, ao, max(cloud, eave));
    col = mix(col, col * vec3(0.8, 0.81, 0.97), eave * 0.75);
  } else if (uKind == 1) {
    float m1 = gnoise(vec3(uv * 0.7, 3.3), 971u);
    if (vPaint.y < 2.0) {
      // ridge and hip tiles: short rounded caps, end to end, mossy
      float c = uv.x / 0.26;
      float joint = 1.0 - smoothstep(0.0, 0.1 + fwidth(c), min(fract(c), 1.0 - fract(c)));
      float tint = hash12(vec2(floor(c), 7.0));
      vec3 cap = mix(pal(ROW_ROOF, 9), pal(ROW_ROOF, 8), 0.3 + 0.55 * uv.y + 0.15 * tint);
      cap = mix(cap, mix(pal(ROW_ROOF, 6), pal(ROW_ROOF, 10), uv.y), smoothstep(0.0, 0.6, m1 + 0.3 * tint) * 0.45);
      col = painted(cap * (1.0 - 0.45 * joint), n, 1.0, cloud);
    } else if (vPaint.y < 6.0) {
      // the eaves' edge: the courses' ends, dark between the tiles
      float c = uv.x / 0.26;
      float gap = 1.0 - smoothstep(0.0, 0.12 + fwidth(c), min(fract(c), 1.0 - fract(c)));
      vec3 ends = mix(pal(ROW_ROOF, 5), pal(ROW_ROOF, 8), 0.3 + 0.4 * hash12(vec2(floor(c), 3.0)));
      col = painted(mix(ends, pal(ROW_ROOF, 1), smoothstep(0.03, 0.0, uv.y) * 0.6) * (1.0 - 0.5 * gap), n, 1.0, cloud);
    } else {
      // tiles in courses up the slope, each lit at its foot and dark under the next
      float rowf = uv.y / 0.24 + 0.12 * gnoise(vec3(uv.x * 0.8, 0.0, 9.0), 970u);
      float row = floor(rowf);
      float fr = fract(rowf);
      float w = 0.26 * (0.9 + 0.2 * hash12(vec2(row, 1.3)));
      float cx = uv.x / w + 0.5 * mod(row, 2.0) + 0.15 * hash12(vec2(row, 2.7));
      float fc = fract(cx);
      float tint = hash12(vec2(row, floor(cx)));
      float aa = fwidth(rowf) + 1e-4;
      float under = smoothstep(0.62, 0.98, fr);
      float lip = 1.0 - smoothstep(0.0, 0.14 + aa, fr);
      float gap = 1.0 - smoothstep(0.0, 0.06 + fwidth(cx), min(fc, 1.0 - fc));
      vec3 tile = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 5), smoothstep(0.1, 0.9, tint));
      tile = mix(tile, pal(ROW_ROOF, 1), smoothstep(0.8, 1.0, hash12(vec2(row, floor(cx) + 31.0))) * 0.6);
      // moss in patches, thickest low on the roof, brightest on the tiles' lit feet
      float dab = strokes(uv, vec2(1.0, 0.0), 0.05, 974u);
      float m2 = gnoise(vec3(uv * 2.1, 8.1), 975u);
      float moss = smoothstep(-0.18, 0.32, 0.8 * m1 + 0.4 * m2 + 0.25 * dab + 0.25 * (1.0 - smoothstep(0.0, 1.6, vPaint.x)) - 0.2 * tint);
      vec3 mossCol = mix(pal(ROW_ROOF, 7), pal(ROW_ROOF, 6), smoothstep(-0.5, 0.5, dab));
      mossCol = mix(mossCol, pal(ROW_ROOF, 10), smoothstep(0.2, 0.8, dab) * (1.0 - fr) * 0.85);
      vec3 base = mix(tile, mossCol, moss * 0.85);
      base = mix(base, pal(ROW_ROOF, 8), lip * 0.5 * (1.0 - under) * (1.0 - moss * 0.6));
      base *= 1.0 - 0.5 * under;
      base = mix(base, pal(ROW_ROOF, 11), gap * 0.6 * (1.0 - lip));
      col = painted(base, n, 1.0, cloud);
    }
  } else if (uKind == 2) {
    // planks: warm, weathered, darker toward the top and at the seams
    float plank = floor(uv.x / 0.13 + 0.5);
    float seam = smoothstep(0.0, 0.06 + fwidth(uv.x / 0.13), abs(fract(uv.x / 0.13 + 0.5) - 0.5) * 2.0);
    float t = hash12(vec2(plank, 1.3));
    float grain = strokes(uv + vec2(t * 3.0, 0.0), vec2(0.0, 1.0), 0.02, 980u);
    vec3 base = mix(pal(ROW_ROOF, 3), pal(ROW_ROOF, 2), clamp(0.62 + 0.2 * t + 0.25 * grain, 0.0, 1.0));
    base *= mix(1.0, 0.8, smoothstep(1.1, 1.85, height));
    col = painted(base * mix(0.7, 1.0, seam), n, 1.0, cloud);
  } else if (uKind == 3) {
    col = painted(pal(ROW_ROOF, 4) * 1.3, n, 1.0, cloud);
  } else if (uKind == 4) {
    // glass: the meadow and the sky in it, darker where the frame shades it
    vec3 r = reflect(-v, n);
    float rise = dot(r, normalize(vPlanet));
    float s = strokes(vLocal.xy + vLocal.zz, vec2(0.0, 1.0), 0.03, 982u);
    vec3 meadow = mix(pal(ROW_ROOF, 14), pal(ROW_ROOF, 13), smoothstep(-0.2, 0.8, s) * 0.5);
    vec3 glassCol = mix(meadow, pal(ROW_ROOF, 13), smoothstep(-0.25, 0.2, rise + 0.15 * s));
    col = glassCol * mix(0.78, 1.0, smoothstep(-0.6, 0.4, dot(n, uSunDir))) * (1.0 - 0.3 * cloud);
  } else if (uKind == 6) {
    // window frames and glazing bars: painted wood, grey-brown
    float s = strokes(uv, vec2(1.0, 0.0), 0.02, 984u);
    col = painted(pal(ROW_ROOF, 12) * (0.92 + 0.12 * s), n, 1.0, cloud);
  } else {
    // the landing: plaster over stone, blocks only faint, an arch of brick at the waterline
    bool top = vLocalNormal.y > 0.7;
    vec2 p = top ? vLocal.xz : uv;
    vec3 base = plaster(p, vLocal.y + 0.75, top ? vec2(1.0, 0.0) : vec2(0.15, 0.99), 957u);
    if (top) base = mix(base, pal(ROW_STONE, 8), 0.65);
    else base = mix(base, pal(ROW_STONE, 8), 0.25);
    vec2 st = top ? courses(p, 0.7, 0.85, 9.0) : courses(p, 0.3, 0.6, 9.0);
    base = mix(base, pal(ROW_STONE, 5), st.x * (top ? 0.1 : 0.12));
    base = mix(base, mix(pal(ROW_STONE, 3), base, 0.5), st.y * 0.15);
    if (!top && vLocalNormal.z > 0.7 && abs(vLocal.z - LANDING_FRONT) < 0.05) {
      vec2 q = (vLocal.xy - ARCH.xy) / ARCH.zw;
      float r = length(vec2(q.x, max(q.y, 0.0)));
      bool open = abs(q.x) < 1.0 && (q.y < 0.0 || r < 1.0);
      float ring = (1.0 - step(1.38, r)) * step(1.0, r) * step(-0.05, q.y);
      if (open) {
        base = mix(vec3(0.05, 0.085, 0.09), vec3(0.12, 0.2, 0.21), smoothstep(-0.75, -0.55, vLocal.y));
      } else if (ring > 0.0) {
        float a = atan(q.y, q.x) / 3.14159 * 9.0;
        float fa = fract(a);
        float joint = 1.0 - smoothstep(0.0, 0.09 + fwidth(a), min(fa, 1.0 - fa));
        joint = max(joint, 1.0 - smoothstep(0.0, 0.05 + fwidth(r), min(r - 1.0, 1.38 - r)));
        vec3 brick = mix(pal(ROW_STONE, 12), pal(ROW_STONE, 11), 0.4 + 0.6 * hash12(vec2(floor(a), 4.0)));
        base = mix(brick, pal(ROW_STONE, 5), joint * 0.7);
      }
    }
    col = painted(base, n, 1.0, cloud);
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), normalize(vPlanet)), 1.0);
}
