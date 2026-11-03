// One shell of the standing crop: the cross-sections of the stalks that reach
// this height, as round dots on a jittered grid (one stalk a cell), each
// stalk its own height and tapering toward its ear. Under the ears the crop
// is dark warm olive; the ears catch the sun; a field's rounded edge leans
// its light toward or away from the sun, so each field reads as a raised,
// shaded mass. The bunds grow short grass the same way; the road is bare.
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_sun>
#include <rye_crop>
uniform float uRadius;
uniform float uPixelAngle;
uniform float uRyeTime;
uniform vec4 uWindVec;
uniform vec4 uCottage;
uniform float uCanopyTop;
uniform float uCanopyStep;     // height between shells (m)
uniform vec2 uCanopyFade;      // near the camera the shells give way to the detailed ears (m)
uniform float uCanopyCoverage; // 1: MSAA turns alpha into coverage; 0: cut at half

varying vec3 vDir;
varying vec3 vWarped;
varying float vHeight;
varying float vCloud;
varying float vRipe;

const float STALK_CELL = 0.05;  // one stalk per 5 cm cell, near
const float GRASS_CELL = 0.032;

// Meters across the point's cube face (equi-angular, so cells stay square), and the face.
vec3 faceMeters(vec3 d) {
  vec3 a = abs(d);
  float face;
  vec2 st;
  if (a.x >= a.y && a.x >= a.z) {
    face = d.x > 0.0 ? 0.0 : 1.0;
    st = d.yz / a.x;
  } else if (a.y >= a.z) {
    face = d.y > 0.0 ? 2.0 : 3.0;
    st = d.xz / a.y;
  } else {
    face = d.z > 0.0 ? 4.0 : 5.0;
    st = d.xy / a.z;
  }
  return vec3((atan(st) * (4.0 / MEADOW_PI) + 1.0) * (uRadius * MEADOW_PI * 0.25), face);
}

// Coverage of the stalk in this cell at height h, for stalks reaching up to
// `top` (m). rel: how far up its own stalk h is; rnd: the stalk's own random.
float stalk(vec3 m, float cell, float salt, float h, float top, float pixelMeters, float taper, float fill, out float rel, out float rnd) {
  vec2 g = m.xy / cell;
  vec2 c = floor(g);
  vec2 f = g - c;
  float r1 = hash13(vec3(c, m.z * 13.0 + salt));
  float r2 = hash13(vec3(c.yx + 71.3, m.z * 7.0 + salt + 3.1));
  rnd = r2;
  float tall = top * (0.72 + 0.28 * r1);
  rel = h / max(tall, 1e-4);
  if (rel > 1.0) return 0.0;
  // feather the stalk's last shell, so where a field's shoulder rounds off
  // the shells' edges blend instead of standing as stair steps
  float tip = clamp((tall - h) / uCanopyStep, 0.0, 1.0);
  vec2 centre = 0.5 + (vec2(r1, r2) - 0.5) * 0.36;
  // crop (taper 1): a stem swelling into its ear over the top third, then the
  // ear's tip; grass (taper 0): a blade narrowing to its point
  float radius = (taper > 0.5 ? 0.34 + 0.11 * smoothstep(0.62, 0.8, rel) - 0.2 * smoothstep(0.88, 1.0, rel) : 0.44 - 0.3 * rel) + fill * 0.32;
  float aa = 0.75 * pixelMeters / cell + 0.03;
  return smoothstep(radius + aa, radius - aa, length(f - centre)) * tip;
}

// The stalks a shell shows where the eye's ray crosses its slab of crop (the
// height between it and its neighbours): seen from above that is one point;
// seen across a field the ray runs a long way through the slab, so the stalks
// along it are sampled (up to four points, both cell sizes), and past that
// the chance the ray meets one is filled in. Without this a field seen edge
// on shows its shells as separate planes of dots with the sky between.
float stalksAlongRay(vec3 at, vec3 toward, float run, float tanView, float h, float cellA, float t, float l0, float top, float pixelMeters, float taper, float fill, out float rel, out float rnd) {
  int n = int(clamp(ceil(run / (cellA * 0.75)), 1.0, 4.0));
  float best = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    float s = n == 1 ? 0.0 : (float(i) / float(n - 1) - 0.5) * run;
    vec3 m = faceMeters(normalize(at + toward * (s / uRadius)));
    float hs = h + s * tanView;
    float r0, d0, r1, d1;
    float a0 = stalk(m, cellA, l0, hs, top, pixelMeters, taper, fill, r0, d0);
    float a1 = stalk(m, cellA * 2.0, l0 + 1.0, hs, top, pixelMeters, taper, fill, r1, d1);
    float a = mix(a0, a1, t);
    if (i == 0 || a > best) {
      best = max(a, best);
      rel = mix(r0, r1, t);
      rnd = t < 0.5 ? d0 : d1;
    }
  }
  float cells = run / cellA;
  if (cells > 3.0) {
    // stalks are 0.72–1 of the crop's height: how many reach this one, and how much of a cell each fills
    float reaching = clamp((1.0 - h / max(top, 1e-3)) / 0.28, 0.0, 1.0);
    float cover = (taper > 0.5 ? 0.36 + 0.3 * fill : 0.3) * reaching;
    best = max(best, 1.0 - pow(1.0 - cover, cells - 3.0));
  }
  return best;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = vHeight;
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  // a shell's underside matters only where the eye's ray leaves the crop near
  // the horizon: anywhere it is seen more steeply, drop it before any work
  if (!gl_FrontFacing && abs(dot(toCam, dir)) > 0.3 * viewDist) discard;
  // Far off, every other shell is left out while the shells are close-set (a
  // screen dither blends the change): the mass reads the same, for less work.
  float thin = uCanopyStep < 0.09 ? smoothstep(30.0, 45.0, viewDist) : 0.0;
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (mod(floor(h / uCanopyStep), 2.0) > 0.5 && dither < thin) discard;
  float pixelMeters = viewDist * uPixelAngle / max(abs(dot(dir, toCam / viewDist)), 0.25);

  // the crop leans with the wind, the most at the ears; long waves run through it
  vec3 windAcross = cross(uWindVec.xyz, dir);
  float windLen = length(windAcross);
  vec3 wind = windLen > 1e-5 ? windAcross / windLen : vec3(0.0);
  float stream = sin(dot(dir, vec3(23.0, 11.0, -17.0)) - uRyeTime * 0.8);
  float ripple = sin(uRyeTime * 1.45 + dot(dir, vec3(171.0, 93.0, 149.0)));
  float bend = (0.18 + 0.19 * stream + 0.065 * ripple) * uWindVec.w;
  vec3 at = normalize(dir - wind * (bend * h * h * 0.5 / uRadius));

  vec4 p = parcelAt(at);
  float crop = cropHeight(p);
  float grass = grassHeight(p);
  bool isCrop = crop > 0.0;
  float top = isCrop ? crop : grass;
  if (h > top) discard;
  // the cottage's own ground: its terrace and steps stay clear
  if (2.0 * asin(clamp(0.5 * length(dir - uCottage.xyz), 0.0, 1.0)) * uRadius < 8.6) discard;

  // stalks no finer than about two pixels: two cell sizes, blended
  float cell0 = isCrop ? STALK_CELL : GRASS_CELL;
  float lv = max(0.0, log2(2.2 * pixelMeters / cell0));
  float l0 = floor(lv);
  float t = lv - l0;
  float taper = isCrop ? 1.0 : 0.0;
  // A field's side, seen across: the stalks there fill their cells, so the
  // shells stack into a solid wall instead of rows of dots with gaps.
  float wall = isCrop ? 1.0 - smoothstep(0.1, CROP_SHOULDER * 1.5, p.x) : 0.0;
  // how far the eye's ray runs through this shell's slab (m), and which way
  vec3 view = toCam / viewDist;
  float sinView = abs(dot(view, dir));
  vec3 flat_ = view - dir * dot(view, dir);
  float cosView = max(length(flat_), 1e-4);
  float tanView = max(sinView / cosView, 0.02);
  float slab = uCanopyStep * (1.0 + thin);
  float run = slab / tanView;
  float rel, rnd;
  float alpha = stalksAlongRay(at, flat_ / cosView, run, tanView, h, cell0 * exp2(l0), t, l0, top, pixelMeters, taper, wall, rel, rnd);
  // near the camera the shells thin out, stalk by stalk, under the detailed ears
  float keep = smoothstep(uCanopyFade.x, uCanopyFade.y, viewDist);
  alpha *= step(fract(rnd * 7.13 + 0.37), keep);
  if (alpha < mix(0.5, 0.02, uCanopyCoverage)) discard;

  vec3 sun = localSun(dir);
  // the field's surface: up over its middle, leaning out over its rounded edge
  vec3 n = dir;
  float shoulder = 1.0;
  if (isCrop && p.x < CROP_SHOULDER * 1.6) {
    vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(dir, t1);
    const float STEP = 0.22;
    float dx = parcelAt(normalize(at + t1 * (STEP / uRadius))).x - p.x;
    float dz = parcelAt(normalize(at + t2 * (STEP / uRadius))).x - p.x;
    vec2 grad = vec2(dx, dz) / STEP;
    float gl = length(grad);
    vec3 outward = gl > 1e-4 ? -(t1 * grad.x + t2 * grad.y) / gl : vec3(0.0);
    shoulder = clamp(p.x / CROP_SHOULDER, 0.0, 1.0);
    // the side of the mass faces out; its top bends over into it
    n = normalize(dir * (0.25 + 1.2 * shoulder * rel) + outward * (1.0 - shoulder) * 1.3);
  }
  // (where shells are thinned, a stalk's highest shell is on average half a step lower: light it as if not)
  float s = clamp((h + 0.5 * thin * uCanopyStep) / max(top, 1e-3), 0.0, 1.0);
  float shade = isCrop && p.x > 0.9 ? 0.0 : cropShade(dir, h, sun, uRadius);
  float b = toonLight(dot(n, sun)) * (1.0 - 0.9 * vCloud) * (1.0 - 0.6 * shade);

  vec3 col;
  if (isCrop) {
    vec3 topC = cropTop(p.y, p.w);
    float reaped = cropReaped(p);
    vec3 deep = mix(cropDeep(topC), topC * 0.72, reaped);
    col = mix(deep, topC, pow(s, 0.9));
    // the ears: some catch a pale cream glint, some stay a shade deeper
    float ear = smoothstep(0.7, 0.95, rel);
    col = mix(col, mix(topC, cropLinear(vec3(1.0, 0.94, 0.70)), 0.42), ear * step(0.74, rnd) * 0.85);
    col *= mix(1.0, 0.8, ear * step(rnd, 0.2));
    // waves of wind run across the field as broad paler bands on the ears
    col = mix(col, cropLinear(vec3(1.0, 0.93, 0.62)), smoothstep(0.55, 1.0, stream) * ear * 0.22 * uWindVec.w * 2.0);
    // On the wall each stalk keeps its own colour all the way up (streaks, not
    // rows): darker, warm, only a little lighter toward the ears.
    vec3 side = mix(deep, topC, 0.38 + 0.4 * rnd) * (0.82 + 0.22 * smoothstep(0.0, 0.9, s));
    col = mix(col, side, wall * (1.0 - ear * 0.5));
    col = mix(cropUnripe(s) * mix(0.5, 1.0, s), col, vRipe);
    // light reaches into the crop only so far
    b *= mix(0.45, 1.0, smoothstep(0.0, 0.8, s));
  } else {
    col = bundGrass(s) * (0.88 + 0.24 * rnd);
    b *= mix(0.6, 1.0, s);
  }
  vec3 lit = col * 1.06;
  vec3 mid = col * 0.84;
  vec3 dark = col * vec3(0.56, 0.58, 0.66);
  col = tone3(lit, mid, dark, b) * cloudTint(vCloud);
  col = applyAerial(col, viewDist, dir);
  gl_FragColor = vec4(col, uCanopyCoverage > 0.5 ? alpha : 1.0);
}
