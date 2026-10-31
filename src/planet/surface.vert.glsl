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

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;       // warped (lighting, rims)
varying float vClearing;
varying float vSlope;       // |∇h|: turns height into distance to the shore per pixel
varying float vBloom;
varying vec2 vGrid;
varying float vMorph;
flat varying vec2 vNodeInfo; // face, level

// The mesh's ground at d (banked for its distance, water flat at the table).
float meshHeight(vec3 d, Ground g) {
  return max(bankedAt(g.height0, g.water, distance(cameraPosition, d * uRadius)), 0.0);
}

vec3 surfacePoint(int face, vec2 uv) {
  vec3 d = uvToSphere(face, uv);
  return d * (uRadius + meshHeight(d, sampleGround(d)));
}

// The ground at a neighbour, sharing this vertex's slope.
float neighbourHeight(vec3 d, float slope) {
  float h = height0(d);
  return max(bankedAt(h, h / max(slope, uBank.w), distance(cameraPosition, d * uRadius)), 0.0);
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

  // Normal from two neighbours about half a grid step away.
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

  vec3 w = warpPosition(p);
  vDir = dir;
  vWarped = w;
  vNormal = warpNormal(p, n);
  vClearing = g.clearing;
  vSlope = g.slope;
  vBloom = bloomAt(dir);
  vGrid = position.xy;
  vMorph = k;
  vNodeInfo = vec2(aNode.w, aLod.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
