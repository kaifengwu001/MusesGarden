// Muse's hut inside (hut.ts), painted like the cottage but lit from within:
// the stove's fire (warm, flickering, falling off over a few meters and
// wrapped softly round what it lights), a candle and a lantern, daylight
// soft from above as if the roof were still on, warmer bounced up from the
// floor. Dark wood planks, warm plaster; what stands on the floor darkens it
// round its foot, the corners and the foot of the walls are darker. The cut
// through the walls shows their rubble stone in its mortar, the plaster skin
// at each face, the timber plates along the tops and the lintels in the front;
// it is outside, lit by the cottage's sun as its walls are. Looking at Muse's
// shelf, whatever stands in front of it dissolves (meadow_occlude).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
#include <meadow_occlude>

uniform int uKind;          // 0 the floor, 1 the walls inside, 2 the cut through the walls, 3 a model (its own picture), 4 the rug, 5 the timber in the cut
uniform float uShowpiece;   // 1: Muse's showpiece (never dissolved)
uniform sampler2D uMap;     // a model's or the rug's picture
uniform vec4 uFire;         // the stove's fire: where (local m), how bright now
uniform vec4 uLamps[2];     // the candle on the table, the lantern on the desk: where, how bright
uniform vec4 uRest[RESTS];  // what stands on the floor: its middle x, z and half sizes (local m)
uniform float uRests;       // how many

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;
varying vec3 vUp;

const vec3 FIRE = vec3(1.0, 0.5, 0.2);

// The cut's height over the clearing at a point of the walls (props.ts cutAt): the front and the right end low, over
// the front's lintels; the back and the left end whole.
float cutHeight(vec2 xz) {
  return xz.x > -ROOM_X + 0.01 && xz.y > -ROOM_Z + 0.01 ? CUT_FRONT : CUT_BACK;
}

// Rubble stone cut through (p: meters in the cut): stones of every size and shade, set in pale mortar.
vec3 rubble(vec2 p) {
  vec2 q = p / 0.16;
  vec2 cell = floor(q);
  vec2 f = q - cell;
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(cell + g), hash12(cell + g + 17.3)) * 0.8 + 0.1;
      float d = length(g + o - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = cell + g;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float joint = 1.0 - smoothstep(0.04, 0.16, d2 - d1);
  float h = hash12(id * 1.7 + 3.1);
  vec3 stone = mix(pal(ROW_STONE, 3) * 0.86, pal(ROW_STONE, 0), 0.25 + 0.75 * h);
  stone = mix(stone, pal(ROW_STONE, 14), step(0.75, hash12(id + 9.1)) * 0.6);
  stone = mix(stone, pal(ROW_STONE, 7), step(0.85, hash12(id + 4.4)) * 0.5);
  // each stone a little rounded: lighter toward its middle, its edges in shadow where the mortar is set back
  stone *= 0.82 + 0.26 * smoothstep(0.65, 0.0, d1);
  return mix(stone, pal(ROW_STONE, 5) * 0.62, joint);
}

// Sun on something outside in the cut, facing up: lit and shaded as the cottage's walls are.
vec3 sunlit(vec3 base, vec3 dir) {
  vec3 sun = localSun(dir);
  float cloud = 0.85 * cloudShadowAt(vPlanet, 0.0);
  float light = smoothstep(-0.3, 0.6, dot(vUp, sun)) * (1.0 - cloud);
  return mix(base * vec3(0.66, 0.7, 0.58) * mix(vec3(1.0), uShadeTint, 0.5), base * vec3(1.04, 1.0, 0.92) * uSunTint, light);
}
const vec3 CANDLE = vec3(1.0, 0.62, 0.3);

// The light inside at a point (local m) facing n: the fire, the lamps, the daylight from above, the floor's bounce.
vec3 roomLight(vec3 p, vec3 n) {
  vec3 toFire = uFire.xyz - p;
  float d2 = dot(toFire, toFire);
  float wrap = clamp(dot(n, toFire * inversesqrt(d2)) * 0.6 + 0.4, 0.0, 1.0);
  vec3 light = FIRE * uFire.w * wrap * wrap / (1.0 + d2 / 7.0);
  for (int k = 0; k < 2; k++) {
    vec3 toLamp = uLamps[k].xyz - p;
    float l2 = dot(toLamp, toLamp);
    float lw = clamp(dot(n, toLamp * inversesqrt(l2 + 1e-4)) * 0.5 + 0.5, 0.0, 1.0);
    light += CANDLE * uLamps[k].w * lw / (1.0 + l2 / 1.1);
  }
  float up = n.y * 0.5 + 0.5;
  light += mix(vec3(0.26, 0.16, 0.09), vec3(0.72, 0.56, 0.38), up);
  return light;
}

// How much what stands on the floor darkens it round its foot (0..1).
float underfoot(vec2 p) {
  float shade = 0.0;
  for (int k = 0; k < RESTS; k++) {
    if (float(k) >= uRests) break;
    vec4 r = uRest[k];
    vec2 q = abs(p - r.xy) - r.zw;
    float out_ = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    shade = max(shade, 1.0 - smoothstep(-0.12, 0.22, out_));
  }
  return shade;
}

// Dark planks along the room, staggered, each its own shade, the grain drawn out along it, dark seams.
vec3 planks(vec2 p) {
  float width = 0.19;
  float across = p.y / width;
  float row = floor(across);
  float len = 1.5 + 1.1 * hash12(vec2(row, 9.0));
  float along = p.x / len + hash12(vec2(row, 5.0)) * 7.0;
  float plank = floor(along);
  float t = hash12(vec2(row, plank + 3.0));
  float grain = gnoise(vec3(p.x * 2.2, p.y * 30.0, t * 13.0), 1101u);
  float knots = smoothstep(0.55, 0.8, gnoise(vec3(p.x * 6.0, p.y * 9.0, t * 7.0), 1102u));
  vec3 dark = vec3(0.085, 0.045, 0.024);
  vec3 mid = vec3(0.19, 0.105, 0.055);
  vec3 c = mix(dark, mid, 0.3 + 0.45 * t + 0.25 * grain);
  c = mix(c, dark * 0.7, knots * 0.5);
  float seam = min(fract(across), 1.0 - fract(across)) * width;
  float joint = min(fract(along), 1.0 - fract(along)) * len;
  c *= mix(0.45, 1.0, smoothstep(0.0, 0.006 + fwidth(seam), seam));
  c *= mix(0.5, 1.0, smoothstep(0.0, 0.006 + fwidth(joint), joint));
  // worn paler where feet go, in the room's middle
  c *= 1.0 + 0.18 * smoothstep(1.6, 0.4, length(p - vec2(0.3, 0.2))) * (0.6 + 0.4 * grain);
  return c;
}

// Irregular courses of stones (p: meters along and up): 1 on a joint, and a random per stone (as props.frag.glsl's).
vec2 stones(vec2 p) {
  float y = p.y / 0.24 + 0.2 * gnoise(vec3(p.x * 0.9, 0.0, 7.0), 1114u);
  float row = floor(y);
  float h = hash12(vec2(row, 3.1));
  float len = 0.44 * (0.75 + 0.5 * h);
  float x = p.x / len + h * 5.3;
  float d = min(min(fract(x), 1.0 - fract(x)) * len, min(fract(y), 1.0 - fract(y)) * 0.24) + 0.006 * gnoise(vec3(p * 9.0, 4.0), 1115u);
  return vec2(1.0 - smoothstep(0.006, 0.022 + fwidth(d), d), hash12(vec2(row, floor(x) + 17.0)));
}

// Warm plaster inside: an ochre limewash in broad soft blooms over stone, the stones showing through
// low down and where it has worn; p: meters along the wall and up from the floor.
vec3 plasterIn(vec2 p, float corner) {
  float big = gnoise(vec3(p * 0.6, 1.7), 1111u) + 0.5 * gnoise(vec3(p * 1.5, 2.4), 1112u);
  float fine = gnoise(vec3(p.x * 5.0, p.y * 7.0, 3.3), 1113u);
  float streak = gnoise(vec3(p.x * 1.1, p.y * 6.5, 5.3), 1116u);
  vec3 c = mix(vec3(0.6, 0.45, 0.27), vec3(0.7, 0.55, 0.34), smoothstep(-0.35, 0.45, big));
  c *= 0.95 + 0.06 * fine + 0.04 * streak;
  vec2 st = stones(p);
  vec3 stone = mix(vec3(0.42, 0.33, 0.23), vec3(0.55, 0.45, 0.33), st.y);
  float worn = (1.0 - smoothstep(0.15, 0.85, min(p.y, corner + 0.2) + 0.25 * big)) * smoothstep(-0.1, 0.35, gnoise(vec3(p * 1.4, 9.1), 1117u) + 0.3);
  c = mix(c, mix(stone, stone * 0.55, st.x), worn * 0.8);
  c *= 1.0 - 0.06 * st.x * (1.0 - worn);
  return c;
}

void main() {
  vec3 p = vLocal;
  vec3 n = normalize(vLocalNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  vec3 dir = normalize(vPlanet);
  // the walls inside go no higher than the cut; what stands in front of Muse's shelf, looked at, dissolves
  if (uKind == 1 && p.y > cutHeight(p.xz) + 0.002) discard;
  if (uKind != 0 && uKind != 4 && uShowpiece < 0.5 && screenDoor(occluded(vWorld))) discard;
  vec3 col;
  if (uKind == 2) {
    // the cut: rubble stone in its mortar, the plaster's skin at each face (v: m in from the outer face); the high
    // walls' ends where they meet the low ones stand upright
    float skin = max(1.0 - smoothstep(0.018, 0.03, vUv.y), smoothstep(0.33, 0.342, vUv.y));
    vec2 q = abs(n.x) > 0.5 ? p.zy : abs(n.z) > 0.5 ? p.xy : p.xz;
    vec3 base = mix(rubble(q), mix(pal(ROW_STONE, 0), pal(ROW_STONE, 8), 0.4), skin);
    col = sunlit(base, dir) * (abs(n.y) > 0.5 ? 1.0 : 0.85);
  } else if (uKind == 5) {
    // the timber: dark oak, its grain drawn out along the beam, the lintels' ends in the light
    float along = vPaint.w > 1.5 ? p.x : (abs(p.x) > ROOM_X - 0.05 ? p.z : p.x);
    float grain = gnoise(vec3(along * 1.6, p.y * 24.0 + p.z * 9.0, 3.3), 1131u) + 0.5 * gnoise(vec3(along * 7.0, p.y * 60.0, 1.1), 1132u);
    vec3 base = mix(vec3(0.13, 0.075, 0.04), vec3(0.24, 0.15, 0.08), 0.45 + 0.35 * grain);
    float face = n.y > 0.7 ? 1.0 : 0.7;
    col = sunlit(base * face, dir);
  } else {
    vec3 albedo;
    float ao = 1.0;
    if (uKind == 0) {
      albedo = planks(p.xz);
      vec2 wall = vec2(ROOM_X, ROOM_Z) - abs(p.xz);
      ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, min(wall.x, wall.y)));
      ao *= 1.0 - 0.6 * underfoot(p.xz);
    } else if (uKind == 1) {
      albedo = plasterIn(vec2(vUv.x, vPaint.z), vPaint.y);
      float height = vPaint.z;
      // the foot of the wall and the corners darker; a dark band of damp low down
      ao = mix(0.6, 1.0, smoothstep(0.0, 0.7, height)) * mix(0.72, 1.0, smoothstep(0.0, 0.45, vPaint.y));
      ao *= mix(0.8, 1.0, smoothstep(0.0, 0.1, vPaint.x));
    } else {
      vec4 tex = texture2D(uMap, vUv);
#ifdef RUG
      if (tex.a < 0.5) discard;
      ao = 1.0 - 0.35 * underfoot(p.xz);
#endif
      albedo = tex.rgb;
    }
    col = albedo * roomLight(p, n) * ao;
  }
  gl_FragColor = vec4(applyAerial(col, length(toCam), dir), 1.0);
}
