// Muse, painted (muse.ts): a cream plush in the meadow's light.
//   fur    the skin under it dark and warm; each shell keeps only the
//          strands that reach it, in clumps of a centimetre or so, so the
//          coat thins toward its tips and the outline goes soft. Where the
//          strands would be finer than a pixel the clumps alone decide, and
//          further off still the coat is solid to half its length, so it
//          never sparkles
//   face   a smooth peach plate in the hood: two glossy black eyes with a
//          painted highlight (they blink), a small smile, a blush on each
//          cheek; darker toward the fur's roll round it
//   light  the sun its place sees, wrapped softly round the fur with a hint
//          of the meadow's bands; the shade a cool lavender grey with the
//          meadow's green bounced up into the underside; the tips lit
//          through when the sun is behind; the clouds' shadows passing
//          over (read a meter aside, off Muse's own shadow in the same map)
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform vec4 uMuseSize;  // height (m), the fur's length (m), shells, -
uniform vec4 uMuseFace;  // the eyes' openness, the smile (0 at rest … 1 beaming), -, -
uniform mat3 uMuseFrame;
#ifdef MUSE_STUDIO
uniform vec3 uStudioSun;
#endif
#ifdef MUSE_COLOURED
// a sculpt's own colour (museMesh.ts) for the coat, graded to the reference's cream (museTripo.ts); its face is painted here as the field's is
uniform vec3 uMuseGrade;
centroid varying vec3 vColour;
#endif
#ifdef MUSE_WEIGHTS
varying vec3 vWeightColour;
#endif

centroid varying vec3 vRest;
varying vec3 vRestGradient;
#ifdef MUSE_FACET
varying vec3 vPlanetGradient;
#endif
centroid varying vec3 vNormal;
centroid varying vec3 vPlanet;
centroid varying vec3 vWorld;
centroid varying float vShell;
centroid varying float vFur;
centroid varying float vOpen;
centroid varying float vHeight;

// colours (linear), from the reference: the coat in light, its roots, the face, the blush, the eyes and the mouth
const vec3 FUR = vec3(0.776, 0.658, 0.503);
const vec3 ROOTS = vec3(0.6, 0.49, 0.36);
const vec3 SKIN = vec3(0.86, 0.69, 0.5);
const vec3 BLUSH = vec3(0.86, 0.42, 0.34);
const vec3 EYE = vec3(0.008, 0.006, 0.007);
const vec3 MOUTH = vec3(0.03, 0.016, 0.013);
// the face's features (H): museBody.ts FEATURES
const vec3 EYE_AT = vec3(0.0973, 0.7709, 0.0198);
const float GLINT = 0.24; // the eyes' highlight's radius (× the eye's)
const vec4 MOUTH_AT = vec4(0.004, 0.7228, 0.0285, 0.0106);
const float MOUTH_WIDTH = 0.0045;
const vec3 BLUSH_AT = vec3(0.106, 0.727, 0.036);
const vec3 FACE_AT = vec3(0.772, 0.182, 0.127);

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// How high the coat reaches here (× the fur's length): strands in clumps, the
// strands given up for the clumps where they are finer than a pixel, the
// clumps for their mean further off.
float coat(vec3 q, float shell, float px) {
  float clump = vnoise(q / 0.009);
  vec3 cell = floor(q / 0.0024);
  vec3 c = fract(q / 0.0024) - 0.5;
  float strand = hash13(cell + 13.7) * (1.0 - 1.6 * dot(c, c));
  float fine = 1.0 - smoothstep(0.0024 * 0.8, 0.0024 * 1.6, px);
  float coarse = 1.0 - smoothstep(0.011 * 0.8, 0.011 * 1.5, px);
  float reach = mix(0.6, 1.0, clump) * mix(1.0, 0.62 + 0.5 * strand, fine);
  return mix(0.62, reach, coarse);
}

// The face's paint over the skin (rest position, H): returns the colour. A
// smile (0 … 1) widens and deepens the mouth and lifts the cheeks under the
// eyes a little.
vec3 face(vec2 f, float eyes, float smile, out float dark, float aa) {
  vec3 col = SKIN;
  dark = 0.0;
  // blush on each cheek
  vec2 b = vec2(abs(f.x), f.y) - BLUSH_AT.xy;
  col = mix(col, BLUSH, 0.6 * exp(-2.4 * dot(b, b) / (BLUSH_AT.z * BLUSH_AT.z)));
  // in the shade of the fur's roll round the face, most under its top
  vec2 e = abs(vec2(f.x, f.y - FACE_AT.x)) / FACE_AT.yz;
  float r = pow(pow(e.x, 2.6) + pow(e.y, 2.6), 1.0 / 2.6);
  col *= 1.0 - (0.12 + 0.12 * smoothstep(-0.2, 0.8, (f.y - FACE_AT.x) / FACE_AT.z)) * smoothstep(0.78, 1.0, r);
  // the eyes: glossy black, a painted highlight up and to the right; shut, a short dark line
  for (int s = -1; s <= 1; s += 2) {
    vec2 c = vec2(float(s) * EYE_AT.x, EYE_AT.y);
    float open = max(eyes * (1.0 - 0.22 * smile), 0.1);
    vec2 d = (f - c) / vec2(EYE_AT.z, EYE_AT.z * open);
    // its edge softened over a pixel; smaller than that, a dark dot a pixel or two across, paler the further off it is,
    // not a smudge over the face (though darker than its size alone, so the eyes still read)
    float soft = 0.75 * aa / EYE_AT.z;
    float inside = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, length(d))) / max(1.0, soft);
    vec3 eye = mix(EYE, vec3(0.05, 0.045, 0.05), smoothstep(0.2, 1.0, -d.y) * 0.6);
    // the highlight, its edge softened over a pixel about its rim; further off, where it would be under a pixel
    // or so, it goes (smeared over the whole eye, it turned the eyes to white dots): far off, the eyes are dark dots
    float edge = 0.5 * aa / EYE_AT.z;
    float shine = 1.0 - smoothstep(GLINT - edge, GLINT + edge, length(d - vec2(0.34, 0.36)));
    shine *= smoothstep(0.8, 1.3, GLINT / edge);
    eye = mix(eye, vec3(0.92, 0.92, 0.95), shine * smoothstep(0.35, 0.7, eyes));
    col = mix(col, eye, inside);
    dark = max(dark, inside);
  }
  // the smile: a short arc rising to its corners, round-ended
  vec2 m = f - MOUTH_AT.xy;
  float span = MOUTH_AT.z * (1.0 + 0.22 * smile);
  float rise = MOUTH_AT.w * (1.0 + 0.9 * smile);
  m.y += 0.35 * (rise - MOUTH_AT.w);
  float u = m.x / span;
  float dm;
  if (abs(u) <= 1.0) {
    float slope = 2.0 * rise * u / span;
    dm = abs(m.y - rise * u * u) * inversesqrt(1.0 + slope * slope);
  } else {
    dm = length(m - vec2(sign(u) * span, rise));
  }
  float mouth = 1.0 - smoothstep(MOUTH_WIDTH * (0.5 + 0.12 * smile) - aa, MOUTH_WIDTH * (0.5 + 0.12 * smile) + aa, dm);
  col = mix(col, MOUTH, mouth);
  dark = max(dark, mouth);
  return col;
}

void main() {
  // A fur strand may discard just one lane of a fragment quad. Evaluate
  // both footprints while every lane is active, before the shell/face
  // branches, so neighbouring coverage cannot change their derivatives.
  float coatFootprint = max(length(fwidth(vRestGradient * uMuseSize.x)), 1e-6);
  float faceFootprint = max(length(fwidth(vRestGradient.xy)), 1e-5);
#ifdef MUSE_FACET
  vec3 facetNormal = normalize(cross(dFdx(vPlanetGradient), dFdy(vPlanetGradient)));
#endif
  float shell = vShell;
  float H = uMuseSize.x;
  bool skin = shell <= 0.0;
  bool onFace = vFur < 0.5 && vRest.z > 0.1;
  if (!skin) {
    // a shell: only where a strand reaches this high (none on the face)
    if (vFur < 0.03) discard;
    if (coat(vRest * H, shell, coatFootprint) < shell) discard;
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
#ifdef MUSE_FACET
  // the lab's true surface: the normal of the triangle as drawn (not the skinned vertex normals)
  n = facetNormal;
#endif
  vec3 up = uMuseFrame[1];
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
#ifdef MUSE_STUDIO
  vec3 sun = uStudioSun;
  float cloud = 0.0;
#else
  vec3 sun = localSun(normalize(vPlanet));
  // the clouds' shadows, read a meter aside: along the sun the map also holds Muse's own
  vec3 side = cross(up, sun);
  side = dot(side, side) > 1e-6 ? normalize(side) : uMuseFrame[0];
  float cloud = 0.85 * cloudShadowAt(vPlanet + side * 1.0, 0.0);
#endif
  float ndl = dot(n, sun);
  // the shade: cool, with the meadow's green bounced into the underside
  float under = clamp(-dot(n, up), 0.0, 1.0);
  vec3 shade = vec3(0.66, 0.68, 0.8) + vec3(0.05, 0.11, 0.0) * under;
  vec3 col;
  if (skin && onFace) {
    float dark;
    col = face(vRest.xy, uMuseFace.x, uMuseFace.y, dark, faceFootprint);
    float light = smoothstep(-0.25, 0.8, ndl) * (1.0 - cloud);
    light = mix(light, toonLight(ndl) * (1.0 - cloud), 0.25);
    col = mix(col * shade * mix(vec3(1.0), uShadeTint, 0.5), col * vec3(1.03, 1.0, 0.94) * uSunTint, light);
    // the eyes catch a little of the sky either way
    col += vec3(0.02, 0.025, 0.035) * dark * (0.5 + 0.5 * n.y);
  } else {
    // the coat: dark and warm at the roots, the tips catching the light; shut in deep in a crease
    float depth = skin ? 0.0 : smoothstep(0.0, 0.7, shell);
#ifdef MUSE_COLOURED
    vec3 base = vColour * uMuseGrade * mix(0.74, 1.04, depth) * mix(0.7, 1.0, vOpen);
#else
    vec3 base = mix(ROOTS, FUR * 1.05, depth) * mix(0.7, 1.0, vOpen);
#endif
    float light = smoothstep(-0.45, 0.75, ndl);
    light = mix(light, toonLight(ndl), 0.3) * (1.0 - cloud) * mix(0.88, 1.0, depth);
    col = mix(base * shade * mix(vec3(1.0), uShadeTint, 0.5), base * vec3(1.04, 1.0, 0.93) * uSunTint, light);
    // the sun through the tips at the outline when it is behind
    float rim = sunRim(n, v) * (1.0 - cloud);
    col += FUR * vec3(1.05, 0.95, 0.8) * rim * 0.55 * depth;
  }
#ifdef MUSE_WEIGHTS
  col = vWeightColour * (0.55 + 0.45 * max(ndl, 0.0));
#endif
#ifdef MUSE_CLAY
  // the lab's clay: the bare skin in a hard key, a fill and a rim, so every bump and kink shows
  float key = max(ndl, 0.0);
  float fillLight = max(dot(n, normalize(vec3(-0.6, 0.15, 0.55))), 0.0);
  float rimLight = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col = vec3(0.6, 0.59, 0.57) * (0.18 + 0.72 * key + 0.18 * fillLight) + vec3(0.22) * rimLight;
#endif
#ifdef MUSE_WIRE
  col = vec3(0.06, 0.06, 0.08);
#endif
#ifndef MUSE_STUDIO
  col = applyAerial(col, dist, normalize(vPlanet));
#endif
  gl_FragColor = vec4(col, 1.0);
}
