// The shelter (props.ts), painted, never textured. The geometry carries the
// structure (posts, beams, the plinth's shape, the door frame); the paint only
// the small detail, each material its own way, the three of them kept apart
// in value and hue (slate, timber, ivory):
//   stone   the plinth: irregular dry-stone courses of slate, each stone a
//           plane of its own (tilted a little, so the sun picks the stones out
//           one by one) in its own tone, dark joints, a few fissures, violet
//           sand drifted against the foot; flagstones on top, the shelter's
//           shadow on them as on the sand
//   timber  long grain following each member whatever the face, a few checks
//           and knots, worn arrises, darker toward the joints; rings on the
//           cut ends; the door's planks; the iron pull
//   cloth   the roof: ivory canvas, broad tension gradients (its sag, streaks
//           pulled in from the corners), two seams down each slope, the hems,
//           the weave only close up; the sun glowing through it underneath;
//           plain canvas in the gables and beside the door; woven mats on the
//           sides and the back
//   rope    the lashings: turns of twisted rope
// Light: the sun each place sees, the clouds' shadow, and the roof's own: a
// ray from each point toward the sun through the canvas's two planes. Marks
// finer than a few pixels fade out with the pixel's footprint. No outlines.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform int uKind; // 0 stone, 1 timber, 2 cloth, 3 rope

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vUp;

// props.ts: the canvas's ridge (m over the pad), its fall per meter out from the ridge, its half extents in plan (m)
const float RIDGE = 3.45;
const float SLOPE = 0.5;
const vec2 ROOF_HALF = vec2(2.5, 2.3);
// the roof's seams, either side of the middle (z, m); the plinth's courses (height, mean stone length, m)
const float SEAM = 0.7;
const vec2 COURSE = vec2(0.125, 0.4);

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

// The roof's shadow at a point p (shelter-local m), the sun s in the same
// frame: 1 where the ray from p toward the sun passes through either slope
// of the canvas within its edges, soft at the edges.
float roofShade(vec3 p, vec3 s) {
  float shade = 0.0;
  for (int k = 0; k < 2; k++) {
    float side = k == 0 ? 1.0 : -1.0;
    // the slope on this side: y = RIDGE - SLOPE·side·x
    float rate = s.y + SLOPE * side * s.x;
    if (rate < 1e-3) continue;
    float t = (RIDGE - p.y - SLOPE * side * p.x) / rate;
    if (t < 0.03) continue;
    vec3 q = p + s * t;
    float inside = min(ROOF_HALF.x - side * q.x, ROOF_HALF.y - abs(q.z));
    shade = max(shade, step(0.0, side * q.x) * smoothstep(-0.03, 0.05, inside));
  }
  return shade;
}

// Irregular courses of stones (p: meters along and up; course height, mean
// stone length; the pixel's footprint, m): the joint (1 on it), a random per
// stone, and where p sits in its stone (0..1 along, 0..1 up).
vec4 drystone(vec2 p, float course, float len, float fw) {
  float y = p.y / course + 0.22 * gnoise(vec3(p.x * 1.3, 0.0, 7.0), 960u);
  float row = floor(y);
  float h = hash12(vec2(row, 3.1));
  // each course its own run of lengths, its joints leaning a little
  float x = p.x / (len * (0.75 + 0.5 * h)) + h * 5.3 + 0.25 * (fract(y) - 0.5) * (hash12(vec2(row, 8.9)) - 0.5);
  vec2 f = fract(vec2(x, y));
  float d = min(min(f.x, 1.0 - f.x) * len, min(f.y, 1.0 - f.y) * course) + 0.004 * gnoise(vec3(p * 11.0, 4.0), 961u);
  float joint = 1.0 - smoothstep(0.004, 0.012 + fw, d);
  return vec4(joint, hash12(vec2(row, floor(x) + 17.0)), f);
}

// Long soft streaks pulled in from the nearest of a cloth's corners (p and
// the corners in meters on it): ±1 along the streaks, fading out by `reach`.
float tension(vec2 p, vec2 lo, vec2 hi, float reach, uint seed) {
  vec2 c = vec2(p.x - lo.x < hi.x - p.x ? lo.x : hi.x, p.y - lo.y < hi.y - p.y ? lo.y : hi.y);
  vec2 d = p - c;
  float r = length(d);
  vec2 along = d / max(r, 1e-4);
  float streak = gnoise(vec3(r * 0.9, dot(d, vec2(-along.y, along.x)) * 9.0, float(seed % 7u)), seed);
  return streak * (1.0 - smoothstep(0.2, reach, r));
}

// A canvas's weave: a fine over-under of threads (period 6 mm), there only
// while a pixel is smaller than a thread or two.
float weave(vec2 p, float fw) {
  vec2 q = p / 0.006 * MEADOW_PI * 2.0;
  return sin(q.x) * sin(q.y) * (1.0 - smoothstep(0.0012, 0.003, fw));
}

void main() {
  vec3 n = normalize(vPlanetNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  vec3 dir = normalize(vPlanet);
  vec3 sun = localSun(dir);
  float cloud = 0.85 * cloudShadowAt(vPlanet, 0.0);
  // the sun in the shelter's frame (x across, y up, z toward its front)
  vec3 across = normalize(cross(uCottage.xyz, uCottageB.xyz));
  vec3 sunHere = vec3(dot(sun, across), dot(sun, uCottage.xyz), dot(sun, uCottageB.xyz));
  float shadow = max(cloud, roofShade(vLocal, sunHere));
  vec2 uv = vUv;
  // a pixel's footprint on the surface (m)
  float fw = max(length(fwidth(vLocal)), 1e-5);
  int flag = int(vPaint.w + 0.5);
  vec3 col;
  if (uKind == 0) {
    bool wall = flag >= 3;
    bool top = flag == 1 || flag == 4;
    vec2 p = top ? vLocal.xz : uv;
    vec4 st = wall ? vec4(0.0, fract(vPaint.z), uv / max(vPaint.xy, vec2(0.001)))
                   : top ? drystone(p, 0.62, 0.85, fw) : drystone(p, COURSE.x, COURSE.y, fw);
    float r = st.y;
    vec3 base = top ? mix(pal(ROW_STONE, 5), pal(ROW_STONE, 4), smoothstep(0.15, 0.95, r))
                    : mix(pal(ROW_STONE, 1), pal(ROW_STONE, 0), smoothstep(0.15, 0.95, r));
    base = mix(base, pal(ROW_STONE, 6), step(0.8, hash12(vec2(r, 5.0))) * 0.7);
    base = mix(base, pal(ROW_STONE, 2), step(hash12(vec2(r, 9.0)), 0.16) * (top ? 0.35 : 0.7));
    // across each stone a quiet shift of value: a plane, not a pillow
    vec2 lean = vec2(hash12(vec2(r, 3.3)), hash12(vec2(r, 4.4))) - 0.5;
    base *= 1.0 + 0.16 * dot(st.zw - 0.5, lean);
    if (wall) {
      float edge = min(min(uv.x, vPaint.x - uv.x), min(uv.y, vPaint.y - uv.y));
      base = mix(base, pal(ROW_STONE, 2), (1.0 - smoothstep(0.003, 0.014 + fw, edge)) * 0.28);
    }
    // a few fissures, across the middle of a stone
    vec2 size = top ? vec2(0.85, 0.62) : vec2(COURSE.y, COURSE.x);
    float line = abs((st.w - 0.5) * size.y - (st.z - 0.5) * size.x * (hash12(vec2(r, 7.7)) - 0.5) * 1.2);
    float fissure = step(0.82, hash12(vec2(r, 6.6))) * (1.0 - smoothstep(0.0012, 0.003 + fw, line)) * smoothstep(0.08, 0.22, min(st.z, 1.0 - st.z));
    base = mix(base, pal(ROW_STONE, 3), max(st.x * 0.9, fissure * 0.7));
    if (flag == 2) base = mix(base, pal(ROW_STONE, 4), 0.35 * (1.0 - st.x));
    // each stone a plane of its own, tilted a little
    vec3 t1 = top ? across : normalize(cross(vUp, n));
    vec3 t2 = top ? normalize(cross(across, n)) : vUp;
    float tilt = top ? 0.12 : 0.5;
    vec3 ns = normalize(n + (t1 * lean.x + t2 * (lean.y + 0.1)) * tilt * (1.0 - st.x));
    float sh = top ? max(cloud, 0.85 * cottageShadow(dir)) : shadow;
    col = painted(base, sunlight(ns, sun, sh), vec3(0.66, 0.66, 0.8));
    // violet sand drifted against the foot, and a dusting on the ledge toward its outer edge
    float drift = top ? (1.0 - smoothstep(0.05, 0.35, min(2.47 - abs(vLocal.x), 2.37 - abs(vLocal.z)))) * 0.3 * smoothstep(-0.2, 0.5, gnoise(vec3(vLocal.xz * 1.7, 2.0), 963u))
                      : 1.0 - smoothstep(-0.02, 0.06 + 0.05 * gnoise(vec3(uv.x * 1.6, 0.0, 3.0), 962u), vLocal.y);
    col = mix(col, painted(pal(ROW_SAND, 1), sunlight(vUp, sun, sh), vec3(0.72, 0.72, 0.86)), drift * 0.75);
  } else if (uKind == 1) {
    float seed = fract(vPaint.z);
    float face = floor(vPaint.z);
    if (flag == 1) {
      // a cut end: growth rings round a pith a little off the axis, a check or two, darker toward its rim
      vec2 c = uv - (vec2(hash12(vec2(seed, 1.0)), hash12(vec2(seed, 2.0))) - 0.5) * 0.04;
      float r = length(c);
      float ring = r / 0.008 + 0.7 * gnoise(vec3(c * 22.0, seed * 9.0), 995u);
      float rf = fract(ring);
      float rings = (1.0 - smoothstep(0.0, 0.3, min(rf, 1.0 - rf))) * (1.0 - smoothstep(0.25, 0.6, fw / 0.008 * 1.7));
      vec3 base = mix(pal(ROW_TIMBER, 2), pal(ROW_TIMBER, 0), 0.35 + 0.4 * smoothstep(0.0, 0.08, r));
      base = mix(base, pal(ROW_TIMBER, 3), rings * 0.35);
      float a = atan(c.y, c.x);
      float check = (1.0 - smoothstep(0.0, 0.05 + fw / max(r, 0.005), abs(a - (seed - 0.5) * 6.0))) * smoothstep(0.01, 0.03, r);
      base = mix(base, pal(ROW_TIMBER, 3), check * 0.8);
      base *= 1.0 - 0.3 * smoothstep(0.6, 1.0, max(abs(uv.x) / vPaint.x, abs(uv.y) / vPaint.y));
      col = painted(base, sunlight(n, sun, shadow), vec3(0.6, 0.58, 0.7));
    } else if (flag == 3) {
      // the iron pull: dark, a dull light along its edge
      col = painted(pal(ROW_TIMBER, 3) * 0.75, sunlight(n, sun, shadow), vec3(0.7));
      col += pal(ROW_TIMBER, 4) * 0.12 * smoothstep(0.6, 1.0, dot(n, sun)) * (1.0 - shadow);
    } else {
      // uv: across the face from an arris, along the member (m); the grain follows the member
      float width = vPaint.x;
      float len = vPaint.y;
      float x = uv.x;
      float along = uv.y;
      float near = 1.0 - smoothstep(0.003, 0.009, fw);
      float broad = gnoise(vec3(x * 5.0, along * 0.35, seed * 9.0 + face), 990u);
      float streak = gnoise(vec3(x * 38.0 + seed * 17.0, along * 0.6, face * 3.7 + seed * 11.0), 991u);
      float fibre = gnoise(vec3(x * 120.0, along * 2.5, face + seed * 5.0), 992u);
      vec3 base;
      if (flag == 2 && width > 0.3) {
        // the door: five planks, each its own tone, dark seams between, the grain up them
        float k = x / (width / 5.0);
        float plank = floor(k);
        float fk = fract(k);
        float tone = hash12(vec2(plank, seed * 13.0));
        base = mix(pal(ROW_TIMBER, 6), pal(ROW_TIMBER, 5), 0.55 + 0.35 * tone + 0.2 * broad);
        base = mix(base, pal(ROW_TIMBER, 6) * 0.9, smoothstep(0.15, 0.55, streak) * 0.45);
        base *= 1.0 + 0.07 * fibre * near;
        float seam = 1.0 - smoothstep(0.0, 0.004 + fw, min(fk, 1.0 - fk) * width / 5.0);
        base = mix(base, pal(ROW_TIMBER, 3), seam * 0.75);
      } else {
        base = mix(pal(ROW_TIMBER, 0), pal(ROW_TIMBER, 2), clamp(0.45 + 0.3 * broad + 0.3 * (seed - 0.5), 0.0, 1.0));
        base = mix(base, pal(ROW_TIMBER, 1), smoothstep(0.05, 0.45, streak) * 0.6);
        base = mix(base, pal(ROW_TIMBER, 4), smoothstep(0.2, 0.6, -streak) * 0.3);
        base *= 1.0 + 0.08 * fibre * near;
        // a few long checks along the grain
        float split = gnoise(vec3(x * 14.0 + seed * 3.0, along * 0.45, face + 40.0), 993u);
        float gate = smoothstep(0.25, 0.5, gnoise(vec3(x * 2.0, along * 0.8, face + seed * 7.0), 994u));
        base = mix(base, pal(ROW_TIMBER, 3), (1.0 - smoothstep(0.0, 0.025 + fw * 18.0, abs(split))) * gate * 0.7);
        // now and then a knot, drawn out along the grain
        float cell = floor(along / 1.1);
        float hk = hash12(vec2(cell + face * 7.0, seed * 31.0));
        vec2 knot = vec2(width * (0.25 + 0.5 * hash12(vec2(cell, hk))), (cell + 0.25 + 0.5 * hk) * 1.1);
        float dk = length((vec2(x, along) - knot) / vec2(0.014, 0.035));
        float knots = step(0.72, hk) * (1.0 - smoothstep(0.7, 1.0, dk));
        base = mix(base, pal(ROW_TIMBER, 3), knots * 0.75);
        base = mix(base, pal(ROW_TIMBER, 1), step(0.72, hk) * (1.0 - smoothstep(1.0, 2.2, dk)) * 0.35);
        // darker toward the ends, where the joints are
        base *= mix(0.8, 1.0, smoothstep(0.0, 0.2, min(along, len - along)));
      }
      // the arrises worn pale where they catch the light, here and there
      float edge = min(x, width - x);
      float worn = (1.0 - smoothstep(0.002, 0.012 + fw, edge)) * smoothstep(-0.1, 0.4, gnoise(vec3(along * 3.0, face, seed * 7.0), 996u));
      base = mix(base, pal(ROW_TIMBER, 4), worn * 0.45);
      col = painted(base, sunlight(n, sun, shadow), vec3(0.6, 0.58, 0.72));
    }
  } else if (uKind == 2) {
    vec3 shadeCloth = vec3(0.78, 0.76, 0.9);
    if (flag == 0) {
      // the roof: uv along the ridge and down the slope (m); vPaint: share down, distance to a free edge (m), sag 0..1
      // each of the three widths sewn into a slope a touch its own ivory
      float bolt = floor((uv.x + SEAM) / (2.0 * SEAM) + 0.5) + (vLocal.x < 0.0 ? 5.0 : 0.0);
      vec3 cloth = mix(pal(ROW_CANVAS, 0), pal(ROW_CANVAS, 3), 0.25 + 0.3 * hash12(vec2(bolt, 4.1)));
      // broad tension: deeper where it sags between its supports and droops at the eaves, brightest pulled taut over the ridge
      float slack = clamp(vPaint.z * 1.8, 0.0, 1.0);
      cloth = mix(cloth, pal(ROW_CANVAS, 1), 0.65 * slack);
      cloth = mix(cloth, pal(ROW_CANVAS, 2), 0.2 * slack * slack);
      cloth = mix(cloth, pal(ROW_CANVAS, 1), 0.45 * smoothstep(0.78, 1.0, vPaint.x));
      cloth = mix(cloth, pal(ROW_CANVAS, 3), (1.0 - smoothstep(0.0, 0.45, uv.y)) * 0.5);
      cloth *= 1.0 + 0.11 * tension(uv, vec2(-ROOF_HALF.y, 0.0), vec2(ROOF_HALF.y, 2.8), 2.2, 970u);
      cloth *= 1.0 + 0.025 * gnoise(vec3(uv * vec2(0.8, 1.6), 3.0), 971u);
      // two seams down each slope: the overlap a shade deeper, its two lines of stitching
      float sd = abs(abs(uv.x) - SEAM);
      float band = 1.0 - smoothstep(0.012, 0.016 + fw, sd);
      float stitch = (1.0 - smoothstep(0.0012, 0.0024 + fw, abs(sd - 0.009))) * (1.0 - smoothstep(0.004, 0.012, fw));
      cloth = mix(cloth, mix(pal(ROW_CANVAS, 1), pal(ROW_CANVAS, 4), 0.4), band * 0.35 + stitch * 0.35);
      // the hem folded over along the free edges, stitched
      float hem = 1.0 - smoothstep(0.045, 0.05 + fw, vPaint.y);
      float hemStitch = (1.0 - smoothstep(0.0012, 0.0024 + fw, abs(vPaint.y - 0.04))) * (1.0 - smoothstep(0.004, 0.012, fw));
      cloth = mix(cloth, pal(ROW_CANVAS, 4), hem * 0.22 + hemStitch * 0.35);
      cloth *= 1.0 + 0.04 * weave(uv, fw);
      if (gl_FrontFacing) {
        col = painted(cloth, sunlight(n, sun, cloud), shadeCloth);
      } else {
        // underneath: in its own shade, the sand's violet in it, the sun on the outside glowing through
        float through = sunlight(-n, sun, cloud);
        vec3 under = cloth * vec3(0.62, 0.6, 0.72) * mix(vec3(1.0), uShadeTint, 0.5) + pal(ROW_LIGHT, 2) * 0.08;
        col = mix(under, cloth * pal(ROW_CANVAS, 1) * 1.05 * uSunTint, 0.42 * through * (1.0 - 0.6 * band));
      }
    } else if (flag == 1) {
      // a hem: the rolled edge, a shade deeper than the cloth, stitched along
      vec3 cloth = mix(pal(ROW_CANVAS, 0), pal(ROW_CANVAS, 4), 0.35);
      float stitch = step(0.5, fract(uv.x / 0.012)) * (1.0 - smoothstep(0.004, 0.01, fw)) * (1.0 - smoothstep(0.1, 0.2, abs(uv.y - 0.5)));
      cloth = mix(cloth, pal(ROW_CANVAS, 4), stitch * 0.3);
      col = painted(cloth, sunlight(n, sun, cloud), shadeCloth);
    } else {
      // a wall panel: uv from its lower left (m); vPaint: its width and height (m), seed
      vec2 size = vPaint.xy;
      float seed = vPaint.z;
      vec3 cloth;
      if (flag == 2) {
        // canvas, a shade under the roof's, pulled out to its corners
        cloth = mix(pal(ROW_CANVAS, 0), pal(ROW_CANVAS, 1), 0.3);
        cloth *= 1.0 + 0.12 * tension(uv, vec2(0.0), size, 1.4, 972u);
        // a broad soft fall of light across it, the cloth not quite flat
        cloth = mix(cloth, pal(ROW_CANVAS, 1), 0.35 * smoothstep(-0.3, 0.6, gnoise(vec3(uv * vec2(0.6, 0.45), seed * 10.0), 973u)));
        // its hem: a line of stitching just clear of the posts and the floor
        float edge = min(min(uv.x, size.x - uv.x) - 0.11, uv.y - 0.045);
        cloth = mix(cloth, pal(ROW_CANVAS, 4), 0.3 * (1.0 - smoothstep(0.0015, 0.003 + fw, abs(edge))));
        cloth *= 1.0 + 0.04 * weave(uv, fw);
      } else {
        // a woven mat: flat reeds laid across it, each its own tone, twined together by cords running up it every
        // 12 cm; the reeds go as soon as they are a pixel or two high, the cords' lines once they crowd together
        float row = uv.y / 0.026;
        float fr = fract(row);
        float fy = max(fw / 0.026, 1e-4);
        vec3 far = mix(pal(ROW_CANVAS, 5), pal(ROW_CANVAS, 1), 0.3);
        vec3 reed = mix(pal(ROW_CANVAS, 5), pal(ROW_CANVAS, 1), hash12(vec2(floor(row), seed * 37.0)) * 0.6);
        reed *= 0.9 + 0.1 * sin(MEADOW_PI * fr);
        reed = mix(reed, pal(ROW_CANVAS, 2), (1.0 - smoothstep(0.0, 0.1 + fy, min(fr, 1.0 - fr))) * 0.45);
        cloth = mix(far, reed, 1.0 - smoothstep(0.25, 0.5, fy));
        float cx = uv.x / 0.12;
        float sx = (fract(cx) - 0.5) * 0.12;
        float twist = fract(row + sx / 0.014);
        vec3 cordCol = mix(pal(ROW_TIMBER, 8), pal(ROW_CANVAS, 2), 0.45) * (0.82 + 0.18 * sin(MEADOW_PI * twist));
        float cord = (1.0 - smoothstep(0.005, 0.007 + fw, abs(sx))) * (1.0 - smoothstep(0.1, 0.25, fw / 0.12));
        cloth = mix(cloth, cordCol, cord * 0.65);
        cloth = mix(cloth, pal(ROW_CANVAS, 1), 0.3 * smoothstep(-0.3, 0.6, gnoise(vec3(uv * vec2(0.5, 0.4), seed * 10.0), 974u)));
        // violet sand blown against its foot
        cloth = mix(cloth, pal(ROW_SAND, 2), (1.0 - smoothstep(0.0, 0.22 + 0.1 * gnoise(vec3(uv.x * 2.0, 0.0, seed), 975u), uv.y)) * 0.3);
      }
      // a little darker where it meets the floor and the beam over it
      cloth *= mix(0.86, 1.0, smoothstep(0.0, 0.12, uv.y)) * mix(0.88, 1.0, smoothstep(0.0, 0.15, size.y - uv.y));
      col = painted(cloth, sunlight(n, sun, shadow), shadeCloth);
    }
  } else {
    // rope: uv across the band of turns and round the loop (m); each turn rounded, its strands twisted
    float k = uv.x / 0.0145;
    float ft = fract(k);
    float twist = uv.y / 0.011 - ft * 0.7 + floor(k) * 0.37;
    float fs = fract(twist);
    float strand = (1.0 - smoothstep(0.0, 0.2 + fw * 220.0, min(fs, 1.0 - fs))) * (1.0 - smoothstep(0.004, 0.01, fw));
    vec3 rope = mix(pal(ROW_TIMBER, 8), pal(ROW_TIMBER, 7), 0.3 + 0.7 * sin(MEADOW_PI * ft));
    rope = mix(rope, pal(ROW_TIMBER, 8) * 0.8, strand * 0.45);
    rope = mix(rope, pal(ROW_TIMBER, 8) * 0.7, (1.0 - smoothstep(0.0, 0.12 + fw / 0.0145, min(ft, 1.0 - ft))) * 0.5);
    col = painted(rope, sunlight(n, sun, shadow), vec3(0.7, 0.68, 0.82));
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), dir), 1.0);
}
