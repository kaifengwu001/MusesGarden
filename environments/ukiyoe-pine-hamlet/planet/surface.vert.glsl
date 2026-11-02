// CDLOD surface: one shared grid mesh, instanced per selected node.
// AWAY_FROM_HOME: nodes the homestead reaches none of (surface.ts) read the baked ground alone.
#ifdef AWAY_FROM_HOME
#define BAKED_GROUND
#endif
#include <meadow_common>
#include <meadow_noise>
#include <meadow_cubesphere>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>

attribute vec4 aNode; // u0, v0, size (uv), face
attribute vec4 aLod;  // morph start, morph end (m), level, -
uniform float uGridSteps;
uniform sampler2D uFlowersBuilt; // a texel per flower tile, 1 once its flowers are built (scatter.ts builtMap)
uniform float uFlowerCells;      // flower tiles along a face's edge (0: none yet)

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;       // warped (lighting, rims)
varying float vClearing;
varying float vSlope;       // |∇h|: turns height into distance to the shore per pixel
varying float vBloom;
varying vec2 vGrid;
varying float vMorph;
varying float vFlowersBuilt; // 1 where the near field's flowers are built (the paint waits for them)
flat varying vec2 vNodeInfo; // face, level

// Separate physical surfaces: signed land continues below the water table;
// water lies on the base sphere. Clamping land vertices to zero would make
// shore-crossing triangles into sloping water ramps and produce saw teeth.
float meshHeight(vec3 d, Ground g) {
#ifdef WATER_SURFACE
  return 0.0;
#else
  return bankedAt(g.height0, g.water, distance(cameraPosition, d * uRadius));
#endif
}

vec3 surfacePoint(int face, vec2 uv) {
  vec3 d = uvToSphere(face, uv);
  return d * (uRadius + meshHeight(d, sampleGround(d)));
}

// The ground at a neighbour, sharing this vertex's slope.
float neighbourHeight(vec3 d, float slope) {
#ifdef WATER_SURFACE
  return 0.0;
#else
  float h = height0(d);
  return bankedAt(h, h / max(slope, uBank.w), distance(cameraPosition, d * uRadius));
#endif
}

void main() {
  int face = int(aNode.w + 0.5);
  vec2 idx = floor(position.xy * uGridSteps + 0.5);
  vec2 uv = aNode.xy + idx / uGridSteps * aNode.z;
  vec3 dir = uvToSphere(face, uv);
  Ground g = sampleGround(dir);
  float height = meshHeight(dir, g);
  vec3 p = dir * (uRadius + height);

  // Symmetric geomorph: odd vertices blend toward the midpoint of their two
  // parent-grid neighbours (see chunks.ts).
  vec2 odd = mod(idx, 2.0);
  float k = 0.0;
  if (odd.x + odd.y > 0.5) {
    k = clamp((distance(cameraPosition, dir * uRadius) - aLod.x) / max(aLod.y - aLod.x, 1e-3), 0.0, 1.0);
    if (k > 0.0) {
      vec3 a = surfacePoint(face, aNode.xy + (idx - odd) / uGridSteps * aNode.z);
      vec3 b = surfacePoint(face, aNode.xy + (idx + odd) / uGridSteps * aNode.z);
      p = mix(p, 0.5 * (a + b), k);
    }
  }

  // Water's normal is radial. Land uses two neighbours about half a grid
  // step away, with the same signed height used by its rendered triangles.
#ifdef WATER_SURFACE
  vec3 n = dir;
#else
  float spacing = aNode.z * 1.5707963 * uRadius / uGridSteps;
  float e = clamp(0.5 * spacing, 0.15, 30.0) / uRadius;
  vec3 t1, t2;
  gradientFrame(dir, t1, t2);
  vec3 d1 = normalize(dir + t1 * e);
  vec3 d2 = normalize(dir + t2 * e);
  vec3 p0 = dir * (uRadius + height);
  vec3 p1 = d1 * (uRadius + neighbourHeight(d1, g.slope));
  vec3 p2 = d2 * (uRadius + neighbourHeight(d2, g.slope));
  vec3 n = normalize(cross(p1 - p0, p2 - p0));
#endif

  vec3 w = warpPosition(p);
  vDir = dir;
  vWarped = w;
  vNormal = warpNormal(p, n);
  vClearing = g.clearing;
  vSlope = g.slope;
  vBloom = bloomAt(dir);
  vGrid = position.xy;
  vMorph = k;
  float cells = uFlowerCells;
  if (cells > 0.5) {
    ivec2 cell = ivec2(clamp(floor(uv * cells), 0.0, cells - 1.0));
    vFlowersBuilt = texelFetch(uFlowersBuilt, ivec2(cell.x, cell.y + face * int(cells)), 0).r;
  } else {
    vFlowersBuilt = 0.0;
  }
  vNodeInfo = vec2(aNode.w, aLod.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
