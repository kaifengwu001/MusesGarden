// CDLOD surface: one shared grid mesh, instanced per selected node. A dry
// world: the ground is the terrain's height everywhere (no water table, no
// bank lip, no clamp at zero).
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
varying vec3 vGroundNormal; // unwarped slope, for camera-independent slip-face pigment
varying float vClearing;
varying float vSlope;
varying float vBloom;
varying vec2 vGrid;
varying float vMorph;
varying float vFlowersBuilt; // 1 where the near field's flowers are built (the paint waits for them)
flat varying vec2 vNodeInfo; // face, level

vec3 surfacePoint(int face, vec2 uv) {
  vec3 d = uvToSphere(face, uv);
  return d * (uRadius + height0(d));
}

void main() {
  int face = int(aNode.w + 0.5);
  vec2 idx = floor(position.xy * uGridSteps + 0.5);
  vec2 uv = aNode.xy + idx / uGridSteps * aNode.z;
  vec3 dir = uvToSphere(face, uv);
  Ground g = sampleGround(dir);
  float height = g.height;
  vec3 p = dir * (uRadius + height);
  float dist = distance(cameraPosition, dir * uRadius);

  // Symmetric geomorph: odd vertices blend toward the midpoint of their two
  // parent-grid neighbours (see chunks.ts).
  vec2 odd = mod(idx, 2.0);
  float k = 0.0;
  if (odd.x + odd.y > 0.5) {
    k = clamp((dist - aLod.x) / max(aLod.y - aLod.x, 1e-3), 0.0, 1.0);
    if (k > 0.0) {
      vec3 a = surfacePoint(face, aNode.xy + (idx - odd) / uGridSteps * aNode.z);
      vec3 b = surfacePoint(face, aNode.xy + (idx + odd) / uGridSteps * aNode.z);
      p = mix(p, 0.5 * (a + b), k);
    }
  }

  // Normal by central differences over a step that grows with distance, not
  // with the node: the light on bare sand then never changes as a node splits
  // or morphs (the meadow's grass used to hide that), only as smoothly as the
  // camera moves. Never finer than a bake texel or two (uBank.z).
  float e = clamp(0.012 * dist, uBank.z, 30.0) / uRadius;
  vec3 t1, t2;
  gradientFrame(dir, t1, t2);
  float ha = height0(normalize(dir + t1 * e)) - height0(normalize(dir - t1 * e));
  float hb = height0(normalize(dir + t2 * e)) - height0(normalize(dir - t2 * e));
  vec3 n = normalize(dir - (t1 * ha + t2 * hb) / (2.0 * e * uRadius));

  vec3 w = warpPosition(p);
  vDir = dir;
  vWarped = w;
  vNormal = warpNormal(p, n);
  vGroundNormal = n;
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
