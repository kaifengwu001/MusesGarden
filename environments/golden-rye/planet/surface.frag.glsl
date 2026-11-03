// The ground: painted meadow and painted water under soft toon light, cloud
// shadows sweeping over both, haze.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
uniform float uPixelAngle;
uniform vec2 uResolution;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_wind>
#include <meadow_warp>
#include <meadow_clouds>
#include <meadow_water>
#include <rye_crop>

uniform int uDebug;
uniform vec4 uNearField; // focus direction xyz, blade radius (m): where real grass takes over

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
varying float vClearing;
varying float vSlope;
varying float vBloom;
varying vec2 vGrid;
varying float vMorph;
varying float vFlowersBuilt;
flat varying vec2 vNodeInfo;

vec3 faceColour(float f) {
  if (f < 0.5) return vec3(0.95, 0.55, 0.45);
  if (f < 1.5) return vec3(0.55, 0.8, 0.45);
  if (f < 2.5) return vec3(0.45, 0.6, 0.95);
  if (f < 3.5) return vec3(0.95, 0.85, 0.4);
  if (f < 4.5) return vec3(0.75, 0.5, 0.9);
  return vec3(0.4, 0.85, 0.85);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float viewDist = length(toCam);
  vec3 v = toCam / viewDist;
  float pixelMeters = viewDist * uPixelAngle / max(dot(n, v), 0.3);

  // the ground here: per pixel from the bake, so shores are crisp at any mesh density (AWAY_FROM_HOME:
  // a node the homestead shapes and shades none of, surface.ts, drawn without its code)
  vec4 fields = textureLod(uTerrainBake, dir, 0.0);
  fields.r = bakeHeight(dir);
#ifdef AWAY_FROM_HOME
  float h = fields.r;
#else
  float h = homestead(dir, fields.r);
#endif
  float shore = 1000.0;
  float aa = max(fwidth(h), 1e-4);
  float wet = smoothstep(aa, -aa, h);
  float depth = max(-banked(h, shore), 0.0);

  // light: toon bands, the cottage's shadow, cloud shadows with brushed edges
  float stroke = strokeAt(dir, pixelMeters);
  // (the cottage's shadow is painted like a cloud's: deep and cool)
#ifdef AWAY_FROM_HOME
  float cloud = cloudShadowAt(dir * (uRadius + max(h, 0.0)), stroke * 2.2);
#else
  float cloud = max(cloudShadowAt(dir * (uRadius + max(h, 0.0)), stroke * 2.2), 0.85 * cottageShadow(dir));
#endif
  float b = toonLight(dot(n, uSunDir)) * (1.0 - 0.9 * cloud);

  // wind on the grass (and the water)
  vec2 waves = gustWaves(dir);
  float gust = waves.x;

  // the fields, wherever any of them shows
  vec3 land = vec3(0.0);
  if (wet < 1.0) {
    // The fields (crop.glsl): under the standing crop its dark floor (the
    // canopy covers it but between the ears near the camera), olive grass on
    // the bunds and yards, the farm road, and the crop's shadow on both.
    vec4 parcel=parcelAt(dir);
    float edgeAA=max(pixelMeters,0.02);
    float inCrop=smoothstep(-edgeAA,edgeAA,parcel.x);
    float onRoad=smoothstep(edgeAA,-edgeAA,parcel.z);
    float hide=cropShade(dir,0.0,localSun(dir),uRadius);
    vec3 cropC=cropTop(parcel.y,parcel.w);
    // reaped ground: pale straw in mown rows; standing crop: its dark floor
    float reaped=cropReaped(parcel);
    float rows=0.5+0.5*sin(dot(dir,windDir(dir))*uRadius*9.0);
    vec3 floorC=mix(cropDeep(cropC)*0.8,cropC*(0.78+0.12*rows),reaped);
    floorC=tone3(floorC*1.05,floorC*0.85,floorC*0.62,b*0.8);
    float tuft=smoothstep(0.2,0.7,stroke);
    vec3 grassC=bundGrass(0.35+0.4*tuft);
    // the grass darkens where it meets the crop's wall, and in its shadow
    float foot=smoothstep(-0.7,0.0,parcel.x)*(1.0-onRoad);
    grassC=tone3(grassC*1.08,grassC*0.86,grassC*vec3(0.55,0.6,0.7),b*(1.0-0.62*hide)*(1.0-0.3*foot));
    vec3 roadC=roadDust(0.55+0.4*smoothstep(-0.4,0.6,stroke));
    roadC*=1.0-0.14*smoothstep(-0.35,0.0,parcel.z);
    roadC=tone3(roadC,roadC*0.9,roadC*vec3(0.62,0.66,0.78),b*(1.0-0.55*hide));
    land=mix(mix(grassC,floorC,inCrop),roadC,onRoad);
    // the bank's face: where the turf drops to the water it is steep, and in its own shade. The
    // slope is taken per pixel (the height's screen derivatives over the position's, in the
    // ground's tangent plane), so a steep bank's face follows the shore, not the mesh's triangles
    vec3 a1;
    vec3 a2;
    gradientFrame(dir, a1, a2);
    vec3 px = dFdx(dir) * uRadius;
    vec3 py = dFdy(dir) * uRadius;
    mat2 J = mat2(dot(px, a1), dot(py, a1), dot(px, a2), dot(py, a2));
    float slope = abs(determinant(J)) > 1e-10 ? length(inverse(J) * vec2(dFdx(h), dFdy(h))) : vSlope;
    float steep = 1.0 - inversesqrt(1.0 + slope * slope);
    land = mix(land, tone3(pal(ROW_GRASS, 2), pal(ROW_GRASS, 5), pal(ROW_WATER, 8), b * 0.7), smoothstep(0.06, 0.3, steep + 0.06 * stroke) * smoothstep(1.2, 0.2, shore) * 0.75);
    land *= cloudTint(cloud);
  }

  vec3 col = land;
  // the water is level whatever the mesh under the shoreline does
  if (wet > 0.0) col = mix(land, waterColour(dir, vWarped, shore, depth, b, cloud, gust, stroke, warpNormal(dir * uRadius, dir), v, pixelMeters), wet);
  col += pal(ROW_LIGHT, 3) * sunRim(n, v) * 0.12 * (1.0 - wet);
  col = applyAerial(col, viewDist, dir);

  if (uDebug == 1) {
    vec3 base = faceColour(vNodeInfo.x) * (0.72 + 0.28 * mod(vNodeInfo.y, 2.0));
    vec2 w = fwidth(vGrid) * 1.5;
    vec2 e2 = smoothstep(vec2(0.0), w, vGrid) * smoothstep(vec2(0.0), w, 1.0 - vGrid);
    col = base * (0.45 + 0.55 * toonLight(dot(n, uSunDir))) * mix(0.35, 1.0, min(e2.x, e2.y));
  } else if (uDebug == 2) {
    col = mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.45, 0.2), vMorph);
  } else if (uDebug == 3) {
    col = vec3(0.5) + 0.5 * n;
  }
  gl_FragColor = vec4(col, 1.0);
}
