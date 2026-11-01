// The finds' patches (findBeds.ts): the meadow's own flowers, bunched into a
// small patch per find, a little taller than the meadow's and of one species
// (the find's topic) with a few companions. Shaded as the meadow's flowers
// are (flower.vert.glsl). Inside the near field a plant reads its
// wind and its cloud shadow from the field maps, as the meadow's flowers do;
// a bed beyond them (a few pixels across) sways in the steady wind alone and
// looks its cloud shadow up in the cube map.
// A patch planted while you watch blossoms from its middle outward: each
// flower's stem rises with a little overshoot, then its head opens. The
// picked basket's patches grow larger and take a cool tint; the one under the
// pointer lifts and glows; the one whose card is up is a touch brighter.
// Each patch's hero (findBeds.ts) is hidden while its twin flies in from the
// basket; in focus it stands lifted, larger and lit; as its flower lands a
// sway runs out through the patch and the hero settles with a small bounce.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_rest>
#include <meadow_field>
#include <meadow_wind>
#include <meadow_clouds>
#include <meadow_find>

attribute float aPart; // 0 stem, 1 petal, 2 centre
attribute float aT;    // along the stem 0..1; 1 on the head
attribute vec4 aPlace; // the plant's direction (unit), its ground's height over R (m)
attribute vec4 aLook;  // seed in [0, 1), size factor, colour variant, the find's index (findState)
attribute float aDelay; // s after its patch is planted before this plant starts to rise (its distance from the patch's middle); negative on the hero
uniform float uPixelAngle;
uniform int uSpecies;
uniform vec4 uBedLook; // stem top (m), nod, -, -
centroid varying vec3 vColour; // centroid, as in grass.frag.glsl

// A flower landing: how long its sway runs (s), how fast it spreads (aDelay's units a second), how far it bows a
// plant; how long the hero settles (s). How a hero in focus stands (FOCUS_LIFT m up, FOCUS_SIZE times larger,
// nodding FOCUS_NOD rad) comes from findBeds.ts, which places the basket's flower where its hero stands.
const float LAND_RING = 1.1;
const float LAND_SPEED = 1.6;
const float LAND_BOW = 0.45;
const float LAND_SETTLE = 0.25;

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// 0 → 1 over `span` s with a little overshoot past 1 (ease out, back)
float rise(float age, float span) {
  float t = clamp(age / span, 0.0, 1.0) - 1.0;
  return 1.0 + 2.2 * t * t * t + 1.2 * t * t;
}

void main() {
  FindState find = findState(aLook.w);
  bool hero = aDelay < 0.0;
  float delay = abs(aDelay);
  float age = uPlantClock - find.planted - delay;
  float since = uPlantClock - find.landed;
  float landing = since >= 0.0 && since < LAND_RING ? 1.0 - since / LAND_RING : 0.0;
  float focus = hero ? find.focus : 0.0;
  // the hero in focus or landing stands for the flower that came home: drawn whatever the thinning
  bool shown = hero && (focus > 0.0 || landing > 0.0);
  // past the horizon, or a few pixels across: thinned (the picked basket's kept whole), then not drawn
  vec3 ground = aPlace.xyz * (uRadius + aPlace.w);
  vec3 seen = warpPosition(ground);
  float pixels = BED_SPAN / max(length(cameraPosition - seen) * uPixelAngle, 1e-6);
  float keep = max(mix(0.4, 1.0, smoothstep(6.0, 40.0, pixels)), find.mark) * step(1.5, pixels);
  if (shown) keep = 1.0;
  float facing = dot(warpNormal(ground, aPlace.xyz), normalize(cameraPosition - seen));
  if (age <= 0.0 || facing < -0.05 || rnd(aLook.x, 9.0) >= keep || (hero && find.away > 0.5)) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float grow = rise(age, 0.95);
  float open = smoothstep(0.45, 1.5, age);
  vec3 dir = aPlace.xyz;
  float seed = aLook.x;
  float scale = aLook.y * (0.85 + 0.3 * rnd(seed, 3.0)) * grow * mix(1.0, MARK_SIZE, find.mark);
  if (shown) {
    // larger in focus; just landed, a squash and a spring back
    float settle = clamp(since / LAND_SETTLE, 0.0, 1.0);
    scale *= mix(1.0, FOCUS_SIZE, focus) * (1.0 - 0.12 * sin(6.2831853 * settle) * (1.0 - settle));
  }
  float stemScale = scale * mix(0.7, 1.0, open);

  // local frame: up = surface normal, random yaw
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = rnd(seed, 4.0) * 6.2831853;
  vec3 side = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 fwd = cross(side, up);

  // the wind and the cloud shadow here: from the near field's maps, or (beyond them) the steady flow
  vec4 meadow;
  vec4 wind;
  float inside;
  fieldSample(dir, meadow, wind, inside);
  float strength = uWindVec.w;
  vec3 shared = inside > 0.5 ? wind.xyz : windDir(dir) * strength * (0.18 + 0.42 * strength);
  vec3 bend = windPlant(dir, shared, rnd(seed, 5.0), 1.15 + 0.4 * rnd(seed, 6.0));
  if (landing > 0.0 && !hero) {
    // a ring running out from the middle, bowing each plant it passes downwind, fading as it goes; it builds
    // from nothing as the flower touches down (the hero only settles: it stands where its flower came down)
    float off = delay - since * LAND_SPEED;
    bend += windDir(dir) * (LAND_BOW * exp(-off * off / 0.018) * landing * smoothstep(0.0, 0.12, since) * (1.0 - 0.5 * clamp(delay / 0.85, 0.0, 1.0)));
  }
  float stemTop = uBedLook.x;
  vec3 base = dir * (uRadius + aPlace.w - 0.02 + 0.22 * find.lift);
  if (shown) base += dir * (FOCUS_LIFT * focus);
  vec3 local = position;
  vec3 world;
  if (aPart < 0.5) {
    float t = aT;
    world = base + side * (local.x * stemScale) + fwd * (local.z * stemScale) + up * (local.y * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0) * t)) + bend * (stemTop * stemScale * t * t);
  } else {
    vec3 head = vec3(local.x, local.y - stemTop, local.z) * mix(0.3, 1.0, open);
    vec3 w = vec3(dot(bend, side), 0.0, dot(bend, fwd));
    float wl = length(w);
    vec3 axis = wl > 1e-4 ? normalize(vec3(w.z, 0.0, -w.x)) : vec3(1.0, 0.0, 0.0);
    float flutter = sin(uGust.x * (7.0 + 3.0 * rnd(seed, 7.0)) + seed * 31.0) * 0.08 * (0.3 + uWindVec.w);
    float nod = uBedLook.y * mix(0.4, 1.0, open) + 0.6 * wl + flutter;
    // a hero in focus nods slowly on its own, so the eye finds it among its patch
    if (shown) nod += focus * FOCUS_NOD * sin(uPlantClock * 2.3);
    head = rotateAxis(head, axis, nod);
    vec3 top = base + up * (stemTop * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0))) + bend * (stemTop * stemScale);
    world = top + side * (head.x * scale) + up * (head.y * scale) + fwd * (head.z * scale);
  }

  // colour by species, variant and part, as the meadow's flowers; cloud and cottage shadows
  float cloud = inside > 0.5 ? meadow.z : cloudShadowAt(base, 0.0);
  float shadow = max(cloud, 0.85 * cottageShadow(dir));
  float b = toonLight(dot(up, uSunDir)) * mix(0.55, 1.0, aT) * (1.0 - 0.9 * shadow);
  float v = aLook.z;
  vec3 col;
  if (aPart < 0.5) {
    col = tone3(pal(ROW_PINK, 4), mix(pal(ROW_PINK, 4), pal(ROW_PINK, 5), 0.5), pal(ROW_PINK, 5), b * 0.85);
  } else if (uSpecies == 0) {
    float inner = smoothstep(stemTop + 0.05, stemTop + 0.0, local.y);
    float lipLight = smoothstep(stemTop + 0.065, stemTop + 0.103, local.y);
    vec3 petal = tone3(floraColour(0, v, 1.0), floraColour(0, v, 0.55), floraColour(0, v, 0.0), b * mix(0.75, 1.0, lipLight));
    col = mix(petal, tone3(pal(ROW_PINK, 2), pal(ROW_PINK, 2), floraColour(0, v, 0.4), b), inner * 0.6);
  } else if (uSpecies == 1) {
    col = aPart > 1.5 ? tone3(pal(ROW_STAR, 3), pal(ROW_STAR, 2), pal(ROW_SCATTER, 1), b) : tone3(floraColour(1, v, 1.0), floraColour(1, v, 0.6), floraColour(1, v, 0.0), b);
  } else if (uSpecies == 2) {
    col = tone3(floraColour(2, v, 1.0), floraColour(2, v, 0.6), floraColour(2, v, 0.0), b);
    if (aPart > 1.5) col *= 0.85;
  } else {
    col = aPart > 1.5 ? pal(ROW_STAR, 0) : tone3(floraColour(3, v, 1.0), floraColour(3, v, 0.5), floraColour(3, v, 0.0), b);
  }
  // buds green until they open
  if (aPart > 0.5) col = mix(tone3(pal(ROW_BUD, 0), pal(ROW_BUD, 0), pal(ROW_GRASS, 2), b), col, smoothstep(0.15, 0.85, open));
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);
  float head = step(0.5, aPart);
  col = mix(col, col * 0.85 + findMarkTint() * 0.22, find.mark * mix(0.3, 0.5, head));
  col = mix(col, col * 1.12 + 0.025, find.open * head);
  // under the pointer, coming home or in focus: lit up, the heads most, their own colour made more vivid in a
  // touch of warm light (a blend toward the light's pale colour washed them out to cream)
  float lit = max(max(find.lift, findPulse(find)), focus);
  vec3 vivid = max(mix(vec3(luma(col)), col, 2.0) * 1.06, 0.0) + findGlow() * 0.03;
  col = mix(col, vivid, lit * mix(0.45, 1.0, head));
  // and a hero in focus has its petals' edges caught in the light, as if lit from behind
  if (shown) col += findGlow() * (0.4 * focus * head * smoothstep(0.02, 0.07, length(local.xz)));

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (shown) {
    // a hero landing or in focus is the flower that came home: drawn over its own patch (its depth brought
    // HERO_NEAR m nearer, where it stands on the screen kept), so the plants round it never swallow it
    vec4 view = viewMatrix * vec4(wp, 1.0);
    view.z += HERO_NEAR;
    vec4 near = projectionMatrix * view;
    gl_Position = vec4(gl_Position.xy / gl_Position.w * near.w, near.z, near.w);
  }
}
