// The homestead, painted (props.ts) the way the meadow paintings paint their
// cottages, with the brush rather than with detail:
//   walls    a pale butter-cream plaster with broad soft ochre blooms (a
//            darker rim where each bloom dried), pink-lavender patches,
//            horizontal streaks and a few dabs; stones only where the
//            plaster has fallen away, near the corners and along the foot;
//            green-grey damp at the foot, a darker stroke down each corner
//   roof     each course of tiles grey-brown, a few warm or blue; its foot a
//            pale lip catching the light with a line of shadow under the
//            next course above it; moss gathering yellow-green in the lower
//            courses and in patches higher up; pale beaded capping tiles on
//            the hips and the ridge; the tiles' ends along the eaves
//   wood     a warm plank door with iron straps, dark frames, a tan bench
//            and chair
//   glass    small panes: the meadow's yellow-green below, the sky above
//   landing  the terrace, pier and steps plastered like the walls, their
//            tops pale; damp at the waterline, a stone arch in the pier
// The shadows are painted too, each from the sun the cottage sees: the
// eaves' shadow down the top of each wall (as deep as the sun is steep on
// that wall, an olive grey), walls turned from the sun an olive grey with
// the meadow's green bounced into them, the shaded
// slopes of the roof a blue-grey, the bench's shadow on the wall, the
// house's on its terrace, and the clouds' passing over. No outlines.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
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
varying vec3 vPlanetNormal;
varying vec3 vUp;

// props.ts: tile courses a slope; the eaves' edge (its foot's height over the clearing, how far it reaches out from the wall, m)
const float COURSES = 14.0;
const vec2 EAVE = vec2(3.05, 0.45);
// the bench (centre x, half length, seat height, m), the pier's arch (centre x, springing y, half width, rise) and the pier's face (z)
const vec3 BENCH = vec3(-0.86, 0.76, 1.17);
const vec4 ARCH = vec4(-7.2, -0.78, 0.55, 0.5);
const float PIER_FRONT = 5.63;

// Lit and shaded tones of a colour: warm where the sun falls; turned away,
// the colour times `shade` (each material's own), the sky's tint in it.
vec3 painted(vec3 base, float light, vec3 shade) {
  vec3 lit = base * vec3(1.04, 1.0, 0.92) * uSunTint;
  vec3 dark = base * shade * mix(vec3(1.0), uShadeTint, 0.5);
  return mix(dark, lit, light);
}

// How much sun a face gets (0..1): turned toward it, softly, less any shadow.
float sunlight(vec3 n, vec3 sun, float shadow) {
  return smoothstep(-0.3, 0.6, dot(n, sun)) * (1.0 - shadow);
}

// The same for a slope of the roof: the painting darkens every slope turned
// from the sun, even under a high sun that still grazes it.
float slopeLight(vec3 n, vec3 sun, float shadow) {
  return smoothstep(0.05, 0.8, dot(n, sun)) * (1.0 - shadow);
}

// The eaves' shadow on a wall at a height (m), facing n: the overhang's
// edge hides the sun from the top of the wall, down from the edge by how
// steeply the sun falls on the wall (drawn a little shallower than the
// geometry would, as the painters do), never less than a narrow band of
// the eaves' own shade. brush: noise in [-1, 1] for a brushed edge.
float eaveShadow(float height, vec3 n, vec3 sun, float brush) {
  float s = dot(sun, n);
  float drop = s > 0.03 ? clamp(0.3 * EAVE.y * dot(sun, vUp) / s, 0.26, 1.2) : 0.3;
  float line = EAVE.x - drop + 0.05 * brush;
  return smoothstep(line - 0.05, line + 0.05, height);
}

// Irregular courses of stones (p: meters along and up): a joint mask (1 on a
// joint) and a random per stone.
vec2 courses(vec2 p, float course, float len) {
  float y = p.y / course + 0.2 * gnoise(vec3(p.x * 0.9, 0.0, 7.0), 960u);
  float row = floor(y);
  float h = hash12(vec2(row, 3.1));
  float x = p.x / (len * (0.75 + 0.5 * h)) + h * 5.3;
  float dx = min(fract(x), 1.0 - fract(x)) * len;
  float dy = min(fract(y), 1.0 - fract(y)) * course;
  float d = min(dx, dy) + 0.006 * gnoise(vec3(p * 9.0, 4.0), 961u);
  return vec2(1.0 - smoothstep(0.006, 0.02 + fwidth(d), d), hash12(vec2(row, floor(x) + 17.0)));
}

// The plaster: pale cream, broad ochre blooms with a darker dried rim,
// pink-lavender patches, horizontal streaks, light and dark dabs.
vec3 plaster(vec2 p, out float bloom) {
  float big = gnoise(vec3(p * 0.55, 1.3), 950u) + 0.5 * gnoise(vec3(p * 1.3, 2.1), 951u);
  float mid = gnoise(vec3(p.x * 1.6, p.y * 2.2, 3.7), 952u);
  float fine = gnoise(vec3(p.x * 6.0, p.y * 8.0, 4.9), 953u);
  float streak = gnoise(vec3(p.x * 0.9, p.y * 8.5, 5.3), 954u);
  bloom = smoothstep(0.06, 0.2, big);
  vec3 c = mix(pal(ROW_STONE, 0), pal(ROW_STONE, 7), bloom * 0.75);
  c *= 1.0 - 0.09 * smoothstep(0.02, 0.08, big) * (1.0 - smoothstep(0.08, 0.2, big));
  c = mix(c, pal(ROW_STONE, 2), smoothstep(0.1, 0.3, mid) * (1.0 - 0.6 * bloom) * 0.7);
  c *= 0.97 + 0.05 * streak;
  c *= 1.0 + 0.05 * smoothstep(0.38, 0.52, fine) - 0.08 * smoothstep(-0.38, -0.55, fine);
  return c;
}

void main() {
  vec3 n = normalize(vPlanetNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  vec3 v = normalize(toCam);
  vec3 dir = normalize(vPlanet);
  vec3 sun = localSun(dir);
  float cloud = 0.85 * cloudShadowAt(vPlanet, 0.0);
  vec2 uv = vUv;
  float height = vPaint.z;
  bool upright = abs(dot(n, vUp)) < 0.5;
  vec3 col;
  if (uKind == 0) {
    bool plain = vPaint.w > 0.5;
    bool reveal = vPaint.x < 0.001 && vPaint.y > 0.99;
    float bloom;
    vec3 base = plaster(uv, bloom);
    float brush = gnoise(vec3(uv * vec2(2.4, 1.2), 8.1), 955u);
    if (!plain && !reveal) {
      // stones where the plaster has fallen away, near the corners and along the foot
      float near = 1.0 - smoothstep(0.1, 0.55, min(vPaint.y, height + 0.1) + 0.2 * brush);
      float fallen = smoothstep(0.18, 0.3, gnoise(vec3(uv * 1.7, 9.3), 956u) + 0.35 * near - 0.15) * near;
      vec2 st = courses(uv, 0.22, 0.42);
      vec3 stone = mix(pal(ROW_STONE, 14), pal(ROW_STONE, 3), st.y);
      stone = mix(stone, pal(ROW_STONE, 5), st.x * 0.8);
      base = mix(base, stone, fallen * 0.85);
      // and faintly everywhere, the stones' shapes showing through the thin plaster
      base *= 1.0 - 0.045 * st.x * smoothstep(-0.2, 0.4, brush + 0.2) - 0.035 * (st.y - 0.5);
      // damp at the foot, a darker stroke down each corner
      base = mix(base, pal(ROW_STONE, 15), (1.0 - smoothstep(0.05, 0.42, height + 0.12 * brush)) * 0.6);
      base *= 1.0 - 0.09 * (1.0 - smoothstep(0.0, 0.16, vPaint.y + 0.03 * brush));
    }
    // the shadows: the eaves', the bench's (on the front), the reveals' own
    float eave = plain ? 0.0 : eaveShadow(height, n, sun, brush);
    float bench = vLocalNormal.z > 0.7 ? (1.0 - smoothstep(-0.02, 0.06, abs(vLocal.x - BENCH.x) - BENCH.y)) * (1.0 - smoothstep(BENCH.z - 0.04, BENCH.z + 0.02, vLocal.y)) * 0.7 : 0.0;
    float shadow = max(max(cloud, eave), bench);
    if (reveal) shadow = max(shadow, 0.6);
    // in shade the plaster goes an olive grey, the meadow's green bounced into it (as the painting's shaded end)
    vec3 shade = vec3(0.62, 0.68, 0.54) + pal(ROW_LIGHT, 2) * 0.08 * clamp(0.6 - dot(n, vUp), 0.0, 1.0);
    col = painted(base, sunlight(n, sun, shadow), shade);
    // the eaves' band an olive grey, deepest right under the roof, brushed along its lower edge
    float band = eave * (0.62 + 0.25 * smoothstep(EAVE.x - 0.35, EAVE.x + 0.1, height)) * (0.9 + 0.1 * gnoise(vec3(uv.x * 3.0, uv.y * 9.0, 2.2), 958u));
    col = mix(col, pal(ROW_STONE, 10) * (0.86 + 0.22 * luma(base)), band);
  } else if (uKind == 1) {
    float flag = vPaint.w;
    float k = floor(vPaint.z);
    float f = clamp(vPaint.x * COURSES - k, 0.0, 1.0);
    // tiles along the course, each course shifted
    float tx = uv.x / 0.34 + hash12(vec2(k, 2.7)) * 3.0;
    float tile = floor(tx);
    float tint = hash12(vec2(k, tile));
    vec3 c = mix(pal(ROW_ROOF, 0), pal(ROW_ROOF, 5), tint * 0.5);
    c = mix(c, pal(ROW_ROOF, 15), smoothstep(0.55, 0.85, hash12(vec2(tile, k + 7.0))) * 0.6);
    c = mix(c, pal(ROW_ROOF, 2) * 0.8, step(0.95, hash12(vec2(tile + 3.0, k))) * 0.35);
    // moss: heavy in the lowest courses, in patches higher up, settling along each course
    float mn = gnoise(vec3(uv.x * 0.9, k * 0.55 + f * 0.25, 3.3), 971u);
    float mf = gnoise(vec3(uv.x * 3.1, (k + f) * 1.9, 5.1), 972u);
    float mx = gnoise(vec3(uv.x * 7.0, (k + f) * 4.5, 6.4), 973u);
    float moss = smoothstep(0.3, 0.62, (1.0 - smoothstep(0.8, 7.0, k)) * 0.45 + 0.42 * mn + 0.2 * mf + 0.12 * mx - 0.12);
    // moss: olive, flecked yellow where it catches the light
    vec3 mossCol = mix(pal(ROW_ROOF, 7), pal(ROW_ROOF, 6), smoothstep(-0.2, 0.6, mf + 0.4 * (1.0 - f)) * 0.75);
    mossCol = mix(mossCol, pal(ROW_ROOF, 6) * 1.12, smoothstep(0.35, 0.55, mx) * 0.5);
    mossCol = mix(mossCol, pal(ROW_ROOF, 7) * 0.8, smoothstep(-0.35, -0.55, mx) * 0.5);
    vec3 base;
    vec3 nl = n;
    if (!gl_FrontFacing) {
      // under the eaves: dark boards in their own shade
      base = pal(ROW_ROOF, 13) * (0.9 + 0.1 * gnoise(vec3(uv * 3.0, 1.0), 976u));
      col = painted(base, 0.0, vec3(0.75, 0.75, 0.8));
    } else if (flag < 0.5) {
      // a course: lighter at its foot, the line of shadow under the next course's foot at its top
      c *= mix(1.05, 0.88, f);
      float joint = 1.0 - smoothstep(0.0, 0.04 + fwidth(tx), min(fract(tx), 1.0 - fract(tx)));
      c *= 1.0 - 0.18 * joint * (1.0 - moss * 0.7);
      base = mix(c, mossCol, moss * (0.55 + 0.2 * smoothstep(-0.2, 0.4, mx)));
      float under = smoothstep(0.6, 0.88, f);
      base *= 1.0 - 0.62 * under;
      // small pale dabs along the course's foot
      float dab = step(0.8, hash12(vec2(floor(uv.x / 0.07), k + 0.5))) * (1.0 - smoothstep(0.0, 0.14, f));
      base = mix(base, pal(ROW_ROOF, 14), dab * 0.6);
      col = painted(base, slopeLight(nl, sun, cloud), vec3(0.66, 0.7, 0.8));
    } else if (flag < 1.5) {
      // the eave's edge: the lowest tiles' ends, rounded, dark between and under
      float te = fract(tx);
      float end = smoothstep(0.0, 0.1, min(te, 1.0 - te)) * smoothstep(0.0, 0.04, uv.y);
      base = mix(pal(ROW_ROOF, 1) * 0.8, mix(pal(ROW_ROOF, 14), mossCol, moss * 0.45) * mix(0.85, 1.0, uv.y / 0.11), end);
      nl = normalize(n + vUp * 0.8);
      col = painted(base, sunlight(nl, sun, cloud), vec3(0.62, 0.66, 0.78));
    } else if (flag < 2.5) {
      // a course's foot: the tiles' pale ends catching the light (lit from the front and above), dark between
      float joint = 1.0 - smoothstep(0.0, 0.05 + fwidth(tx), min(fract(tx), 1.0 - fract(tx)));
      base = mix(pal(ROW_ROOF, 14), mix(pal(ROW_ROOF, 6), pal(ROW_ROOF, 14), 0.4), moss * 0.7);
      base *= (0.8 + 0.28 * hash12(vec2(tile, k + 3.0))) * (1.0 - 0.6 * joint);
      nl = normalize(n + vUp * 1.2);
      col = painted(base, sunlight(nl, sun, cloud), vec3(0.7, 0.72, 0.8));
    } else {
      // a capping tile: pale and rounded, dark where the next tile's foot laps over its head
      float around = uv.y;
      float lapped = smoothstep(0.7, 1.0, uv.x) * step(-0.5, vPaint.x);
      float side = 1.0 - smoothstep(0.0, 0.3, min(around, 1.0 - around));
      base = mix(pal(ROW_ROOF, 8), pal(ROW_ROOF, 14), smoothstep(0.3, 0.6, 1.0 - abs(around - 0.5) * 2.0) * 0.6);
      base = mix(base, mossCol, smoothstep(0.35, 0.6, mn + 0.3 * (1.0 - smoothstep(0.0, 6.0, k))) * 0.55);
      base *= (1.0 - 0.45 * lapped) * (1.0 - 0.25 * side);
      if (vPaint.x < -0.5) base = pal(ROW_ROOF, 14) * 0.95;
      col = painted(base, sunlight(n, sun, cloud), vec3(0.66, 0.7, 0.8));
    }
  } else if (uKind == 2) {
    float brush = gnoise(vec3(uv * vec2(2.4, 1.2), 8.1), 955u);
    float eave = upright ? eaveShadow(vLocal.y, n, sun, brush) : 0.0;
    if (vPaint.w > 0.5 && vPaint.w < 1.5) {
      // the door: warm planks with lighter streaks and dark seams, two iron straps; its top in the eaves' shade
      float px = uv.x / 0.13 + 0.5;
      float plank = floor(px);
      float seam = smoothstep(0.0, 0.08 + fwidth(px), abs(fract(px) - 0.5) * 2.0);
      float t = hash12(vec2(plank, 1.3));
      float grain = gnoise(vec3(uv.x * 30.0, uv.y * 1.6, t * 9.0), 980u);
      vec3 base = mix(pal(ROW_ROOF, 2), pal(ROW_ROOF, 3), 0.2 + 0.35 * t + 0.25 * grain);
      base = mix(base, pal(ROW_ROOF, 12), smoothstep(0.35, 0.7, grain) * 0.35) * mix(0.62, 1.0, seam);
      float strap = max(1.0 - smoothstep(0.035, 0.05, abs(height - 0.3)), 1.0 - smoothstep(0.035, 0.05, abs(height - 1.5)));
      strap *= smoothstep(0.02, 0.06, uv.x) * (1.0 - smoothstep(0.62, 0.68, uv.x));
      float rivet = strap * step(0.6, fract(uv.x / 0.09));
      base = mix(base, pal(ROW_ROOF, 4), strap);
      base = mix(base, pal(ROW_ROOF, 4) * 1.6, rivet * 0.5);
      col = painted(base, sunlight(n, sun, max(cloud, eave)), vec3(0.72, 0.72, 0.76));
      col *= 1.0 - 0.35 * eave;
    } else if (vPaint.w > 1.5) {
      // the bench and the chair: weathered tan
      float grain = gnoise(vec3(uv.x * 22.0, uv.y * 3.0, 4.4), 981u);
      col = painted(pal(ROW_ROOF, 12) * (0.92 + 0.1 * grain), sunlight(n, sun, cloud), vec3(0.72, 0.72, 0.76));
    } else {
      col = painted(pal(ROW_ROOF, 9), sunlight(n, sun, max(cloud, eave)), vec3(0.72, 0.72, 0.78));
    }
  } else if (uKind == 3) {
    col = painted(pal(ROW_ROOF, 4) * 1.4, sunlight(n, sun, cloud), vec3(0.7));
  } else if (uKind == 4) {
    // glass: the meadow's light in the lower panes, the sky in the upper, each pane its own, a glint
    float up = clamp((vLocal.y - 1.57) / 1.3, 0.0, 1.0);
    vec2 pane = floor(uv / vec2(0.325, 0.32));
    float own = hash12(pane + 2.0);
    vec3 refl = mix(pal(ROW_ROOF, 10), pal(ROW_ROOF, 11), smoothstep(0.35, 0.75, up + 0.25 * (own - 0.5) + 0.12 * gnoise(vec3(uv * 4.0, 2.0), 982u)));
    refl *= 0.86 + 0.2 * own;
    refl = mix(refl, vec3(0.97), smoothstep(0.55, 0.75, gnoise(vec3(uv * 6.0, 7.7), 983u)) * 0.5);
    float glint = pow(clamp(dot(reflect(-v, n), sun), 0.0, 1.0), 10.0);
    float eave = eaveShadow(vLocal.y, n, sun, 0.0);
    col = mix(refl, pal(ROW_LIGHT, 3), glint * 0.4) * (1.0 - 0.3 * cloud) * (1.0 - 0.4 * eave);
  } else {
    // the terrace, pier and steps: plastered like the walls, their tops pale; damp at the waterline, the pier's stone arch
    bool top = vLocalNormal.y > 0.7;
    vec2 p = top ? vLocal.xz : uv;
    float bloom;
    vec3 base = top ? mix(pal(ROW_STONE, 8), plaster(p * 1.3, bloom), 0.35) : mix(pal(ROW_STONE, 9), plaster(p, bloom), 0.6);
    float brush = gnoise(vec3(p * vec2(2.4, 1.2), 8.7), 957u);
    vec2 st = courses(p, top ? 0.9 : 0.3, top ? 1.1 : 0.6);
    base = mix(base, pal(ROW_STONE, 5), st.x * (top ? 0.12 : 0.18) * smoothstep(-0.4, 0.4, brush));
    if (!top) base = mix(base, pal(ROW_STONE, 6) * 0.85, (1.0 - smoothstep(-1.15, -0.75, vLocal.y + 0.12 * brush)) * 0.65);
    if (!top && vLocalNormal.z > 0.7 && abs(vLocal.z - PIER_FRONT) < 0.05) {
      vec2 q = (vLocal.xy - ARCH.xy) / ARCH.zw;
      float r = length(vec2(q.x, max(q.y, 0.0)));
      bool open = abs(q.x) < 1.0 && (q.y < 0.0 || r < 1.0);
      float ring = (1.0 - step(1.3, r)) * step(1.0, r) * step(-0.05, q.y);
      if (open) {
        // into the dark under the pier, the water's light at its foot
        base = mix(vec3(0.05, 0.08, 0.08), vec3(0.12, 0.18, 0.18), smoothstep(-1.2, -0.9, vLocal.y));
      } else if (ring > 0.0) {
        // the arch's stones, a shade darker than the face, their joints brushed in
        float a = atan(q.y, q.x) / 3.14159 * 9.0;
        float fa = fract(a);
        float joint = 1.0 - smoothstep(0.0, 0.1 + fwidth(a), min(fa, 1.0 - fa));
        joint = max(joint, 1.0 - smoothstep(0.0, 0.05 + fwidth(r), min(r - 1.0, 1.3 - r)));
        base = mix(base * mix(0.82, 0.9, hash12(vec2(floor(a), 4.0))), pal(ROW_STONE, 5), joint * 0.5);
      }
    }
    // the house's shadow falls on the terrace as on the meadow
    float house = top ? 0.85 * cottageShadow(dir) : 0.0;
    col = painted(base, sunlight(n, sun, max(cloud, house)), vec3(0.78, 0.8, 0.84));
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), dir), 1.0);
}
