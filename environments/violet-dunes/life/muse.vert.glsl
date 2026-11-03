// Muse (muse.ts): the body skinned by its thirteen joints, then set on the
// planet at its feet and warped like everything else. One mesh drawn as
// instances: the skin first (instance 0), then the fur's shells stepped out
// along the skin's normal (muse.frag.glsl keeps a shell's fragments only
// where a strand of fur reaches that high). The tips droop a little and
// lean with the wind, more the further out they are.
#include <meadow_common>
#include <meadow_warp>

#define MUSE_JOINTS 13
#define MUSE_CHEST 3
#define COMB_LEAN 0.7 // how far a strand's tip lies over along the skin (× the fur's length)
uniform mat4 uBones[MUSE_JOINTS];      // each joint's skin transform
#ifdef MUSE_DQS
uniform vec4 uBoneDQ[MUSE_JOINTS * 2]; // the same as dual quaternions: rotation, translation part
#endif
#ifdef MUSE_RAISE
attribute vec3 aRaise;       // the wave's corrective at the top of a wave (H, the chest's frame: museMesh.ts)
attribute vec3 aRaiseNormal; // the skin's normal there, its length how much of it to take
attribute float aRaiseOpen;  // and the open sky over it there
#endif
#if defined(MUSE_RAISE) || defined(MUSE_HANG)
uniform float uMuseRaise;    // how far the left arm is up in a wave (0 … 1)
#endif
#ifdef MUSE_COMB
attribute vec3 aComb;        // the fur's lie along the skin (rest space: museMesh.ts), its length how far it lies over
#endif
#ifdef MUSE_HANG
attribute vec3 aHang;        // a T-pose sculpt's hung corrective: the roots of hanging arms ironed (H, rest space: museMesh.ts)
attribute vec3 aHangNormal;  // and the normal the skin should have there
#endif
uniform vec3 uMusePos;   // where its feet stand, planet space (m)
uniform mat3 uMuseFrame; // its frame in planet space (columns: left, up, forward)
uniform vec4 uMuseSize;  // height (m), the fur's length (m), shells, -
uniform vec4 uMuseWind;  // the wind's push on the fur's tips (planet space, m at full length), its flutter
uniform float uTime;

attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float aFur;  // the fur's length here (× its full length)
attribute float aOpen; // open sky over the skin (0 deep in a crease … 1 open)

// (all read at the centroid, as in grass.frag.glsl: under MSAA a sub-pixel triangle's
// centre would extrapolate them, and the paint built from them, far out of range)
centroid varying vec3 vRest;   // the rest position (H): the strands and the face's paint stay fixed to it
// Footprints use pixel-centre interpolation; centroid positions can choose
// different covered samples in adjacent pixels of the overlapping shells.
varying vec3 vRestGradient;
#ifdef MUSE_FACET
varying vec3 vPlanetGradient;
#endif
centroid varying vec3 vNormal; // planet space, unwarped (the light)
centroid varying vec3 vPlanet; // planet space (m), unwarped
centroid varying vec3 vWorld;  // warped
centroid varying float vShell; // 0 the skin … 1 the fur's tips
centroid varying float vFur;
centroid varying float vOpen;
centroid varying float vHeight; // over its feet (H)
#ifdef MUSE_COLOURED
attribute vec3 aColour;       // a sculpt's own colour (museMesh.ts), linear
centroid varying vec3 vColour;
#endif
#ifdef MUSE_WEIGHTS
attribute vec3 aWeightColour; // the lab's view of the skin weights
varying vec3 vWeightColour;
#endif
#ifdef MUSE_PAINTED
attribute float aCloth;       // a dressed muse's cloth (0 its fur … 1 cloth: src/life/museMesh.ts), painted from its texture
centroid varying float vCloth;
centroid varying vec2 vUv;    // (at the centroid too: under MSAA a seam's extrapolated coordinates read another island of the paint)
#endif

void main() {
  ivec4 j = ivec4(skinIndex);
  vec3 rest = position;
  vec3 restNormal = normal;
#ifdef MUSE_HANG
  // full on a hanging arm's root, gone from the left one as it rises into a wave
  float hung = position.x > 0.0 ? 1.0 - uMuseRaise : 1.0;
  rest += aHang * hung;
  restNormal = normalize(mix(normal, aHangNormal, hung));
#endif
#ifdef MUSE_DQS
  // dual-quaternion skinning (the lab's comparison): the joints' turns blended as turns (each
  // aligned with the first, q and −q being one turn), keeping volume where matrices would pinch
  vec4 r0 = uBoneDQ[j.x * 2];
  vec4 r = r0 * skinWeight.x;
  vec4 d = uBoneDQ[j.x * 2 + 1] * skinWeight.x;
  vec4 rk = uBoneDQ[j.y * 2];
  float sk = dot(rk, r0) < 0.0 ? -skinWeight.y : skinWeight.y;
  r += rk * sk;
  d += uBoneDQ[j.y * 2 + 1] * sk;
  rk = uBoneDQ[j.z * 2];
  sk = dot(rk, r0) < 0.0 ? -skinWeight.z : skinWeight.z;
  r += rk * sk;
  d += uBoneDQ[j.z * 2 + 1] * sk;
  rk = uBoneDQ[j.w * 2];
  sk = dot(rk, r0) < 0.0 ? -skinWeight.w : skinWeight.w;
  r += rk * sk;
  d += uBoneDQ[j.w * 2 + 1] * sk;
  float norm = length(r);
  r /= norm;
  d /= norm;
  vec3 p = rest + 2.0 * cross(r.xyz, cross(r.xyz, rest) + r.w * rest) + 2.0 * (r.w * d.xyz - d.w * r.xyz + cross(r.xyz, d.xyz));
  vec3 n = normalize(restNormal + 2.0 * cross(r.xyz, cross(r.xyz, restNormal) + r.w * restNormal));
#ifdef MUSE_COMB
  vec3 comb = aComb + 2.0 * cross(r.xyz, cross(r.xyz, aComb) + r.w * aComb);
#endif
#else
  // the joints' transforms blended as matrices: a raised arm draws the skin it grew from out of the
  // side in a taut slope (museMesh.ts), where blended turns would swing it out round the shoulder
  mat4 skin = uBones[j.x] * skinWeight.x + uBones[j.y] * skinWeight.y + uBones[j.z] * skinWeight.z + uBones[j.w] * skinWeight.w;
  vec3 p = (skin * vec4(rest, 1.0)).xyz;
  vec3 n = normalize(mat3(skin) * restNormal);
#ifdef MUSE_COMB
  vec3 comb = mat3(skin) * aComb;
#endif
#endif
#ifdef MUSE_RAISE
  // the shoulder as the sculpt would have it with the arm up, coming in as the arm rises (in the
  // chest's frame, so it turns with the body)
  mat3 chest = mat3(uBones[MUSE_CHEST]);
  p += chest * aRaise * uMuseRaise;
  float k = uMuseRaise * length(aRaiseNormal);
  if (k > 0.0) n = normalize(mix(n, chest * normalize(aRaiseNormal), k));
#endif
  float shell = float(gl_InstanceID) / uMuseSize.z;
  vec3 world = uMusePos + uMuseFrame * (p * uMuseSize.x);
  vec3 nw = normalize(uMuseFrame * n);
  float len = uMuseSize.y * aFur;
  // out along the normal; the tips droop and lean with the wind, each tuft fluttering on its own beat
  vec3 up = uMuseFrame[1];
  float flutter = 1.0 + uMuseWind.w * sin(uTime * 5.3 + dot(position, vec3(41.0, 29.0, 37.0)));
  world += nw * len * shell + (uMuseWind.xyz * flutter - up * 0.3 * len) * shell * shell * aFur;
  vRest = position;
#ifdef MUSE_COMB
  // the strands lie over along the skin as they rise, as a plush's pile is brushed: each shell slides along the
  // lie, and reads the strands from as far back along it, so each strand is a curve from its root
  float lie = COMB_LEAN * shell * shell;
  world += uMuseFrame * (comb * len * lie);
  vRest -= aComb * (len / uMuseSize.x) * lie;
#endif
  vec3 wp = warpPosition(world);
  vRestGradient = vRest;
#ifdef MUSE_FACET
  vPlanetGradient = world;
#endif
  vNormal = nw;
  vPlanet = world;
  vWorld = wp;
  vShell = shell;
  vFur = aFur;
  vOpen = aOpen;
#ifdef MUSE_RAISE
  vOpen = mix(aOpen, aRaiseOpen, uMuseRaise);
#endif
  vHeight = p.y;
#ifdef MUSE_COLOURED
  vColour = aColour;
#endif
#ifdef MUSE_WEIGHTS
  vWeightColour = aWeightColour;
#endif
#ifdef MUSE_PAINTED
  vCloth = aCloth;
  vUv = uv;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
