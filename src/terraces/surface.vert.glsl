// The terraces' CDLOD ground (planet/surface.ts draws it as it draws the
// meadow's): one shared grid mesh, instanced per selected node. Near the
// camera its rows gather onto the walls' edges, so the steps stand sharp in
// the mesh itself and the water lies at each paddy's own level; beyond where
// the grid could draw a riser the hills keep their own shape and the
// fragment shader paints the terraces on them (ground.glsl, terraceVertex).
#include <meadow_common>
#include <meadow_noise>
#include <meadow_cubesphere>
#include <meadow_warp>
uniform float uRadius;
#include <terraces_common>
#include <terraces_plots>
#include <terraces_paddy>
#include <terraces_village>
#include <terraces_ground>

attribute vec4 aNode; // u0, v0, size (uv), face
attribute vec4 aLod;  // morph start, morph end (m), level, -
uniform float uGridSteps;

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal; // warped; the hills' own (the paint lights the terraces' faces itself)
varying vec2 vGrid;
varying float vMorph;
varying float vHeight; // the mesh's own height (m): where it stands off the true ground it is a wall's face
flat varying vec2 vNodeInfo; // face, level

vec3 surfacePoint(int face, vec2 uv) {
  vec3 d = uvToSphere(face, uv);
  vec4 m = terraceVertex(d, distance(cameraPosition, d * uRadius));
  return m.xyz * (uRadius + m.w);
}

void main() {
  int face = int(aNode.w + 0.5);
  vec2 idx = floor(position.xy * uGridSteps + 0.5);
  vec2 uv = aNode.xy + idx / uGridSteps * aNode.z;
  vec3 dir = uvToSphere(face, uv);
  vec4 m = terraceVertex(dir, distance(cameraPosition, dir * uRadius));
  vec3 p = m.xyz * (uRadius + m.w);

  // symmetric geomorph, as the meadow's (chunks.ts): toward the midpoint of its neighbours' moved positions
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

  float slope;
  vec3 up = uphillAt(dir, textureLod(uTerraceBake, dir, 0.0).r, slope);
  vec3 n = normalize(dir - up * slope);

  vec3 w = warpPosition(p);
  vDir = normalize(p);
  vWarped = w;
  vNormal = warpNormal(p, n);
  vGrid = position.xy;
  vMorph = k;
  vHeight = length(p) - uRadius;
  vNodeInfo = vec2(aNode.w, aLod.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
