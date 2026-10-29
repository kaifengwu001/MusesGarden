// CDLOD surface: one shared grid mesh, instanced per selected node.
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
uniform float uPixelAngle;

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;       // warped (lighting, rims)
varying vec3 vPlanetNormal; // unwarped (slope)
varying float vMountain;
varying float vRock;
varying float vClearing;
varying vec2 vGrid;
varying float vMorph;
varying vec3 vFields; // lushness, flower drift, bloom
flat varying vec2 vNodeInfo; // face, level

vec3 surfacePoint(int face, vec2 uv) {
  vec3 d = uvToSphere(face, uv);
  return d * (uRadius + sampleGround(d).height);
}

void main() {
  int face = int(aNode.w + 0.5);
  vec2 idx = floor(position.xy * uGridSteps + 0.5);
  vec2 uv = aNode.xy + idx / uGridSteps * aNode.z;
  vec3 dir = uvToSphere(face, uv);
  Ground g = sampleGround(dir);
  vec3 p = dir * (uRadius + g.height);

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
  vec3 ref = abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(dir, ref));
  vec3 t2 = cross(dir, t1);
  vec3 d1 = normalize(dir + t1 * e);
  vec3 d2 = normalize(dir + t2 * e);
  vec3 p0 = dir * (uRadius + g.height);
  vec3 p1 = d1 * (uRadius + sampleGround(d1).height);
  vec3 p2 = d2 * (uRadius + sampleGround(d2).height);
  vec3 n = normalize(cross(p1 - p0, p2 - p0));

  vec3 w = warpPosition(p);
  vDir = dir;
  vWarped = w;
  vPlanetNormal = n;
  vNormal = warpNormal(p, n);
  vMountain = g.mountain;
  vRock = g.rock;
  vClearing = g.clearing;
  vGrid = position.xy;
  vMorph = k;
  vNodeInfo = vec2(aNode.w, aLod.z);
  vFields = meadowFields(dir, distance(cameraPosition, w) * uPixelAngle);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
