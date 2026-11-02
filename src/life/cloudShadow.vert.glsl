// Cloud shadows, and the clouds seen from below, as maps over the planet in
// direction space: cube maps that clouds.ts renders a face at a time. Every
// puff of every cloud, in sight or not, is splatted additively as optical
// depth (the same lumpy outline the cloud is drawn with):
//   shadows (default)  where the puff's shadow reaches the water table, down
//                      the sun that place sees (sun.glsl): the ellipse a
//                      sphere throws on the ground. The ground looks up the
//                      point under it (cloudShadowAt)
//   RADIAL             straight down: the cloud cover seen from below, which
//                      the lakes read from orbit (cloudsFromOrbit)
// Nothing here depends on the camera, so the maps are fixed to the planet.
// The shadows are drawn twice: the cube map, and a sharper window of one
// face about where you stand (clouds.ts), its texels fixed to the planet.
#include <meadow_noise>
#include <meadow_cloud_lumps>
#include <meadow_sun>
uniform highp sampler2D uCloudData;
uniform vec4 uCloudLook; // -, -, clouds, -
uniform float uRadius;
uniform mat3 uCubeFace;  // this face's axes as columns: across, up, out (the GL cube-map convention)
uniform vec3 uFaceWindow; // the part of the face drawn: centre (face units), 1 / half-width ((0, 0, 1): the whole face)

varying vec2 vOff;        // across the splat, × the puff's radius
flat varying float vRadius;
flat varying uint vSeed;
flat varying vec3 vSideA; // directions on the puff's outline, seen down the light
flat varying vec3 vSideB;

void main() {
  int row = gl_InstanceID / 8;
  int k = gl_InstanceID - row * 8;
  vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
  vOff = position.xy * (1.0 + 1.5 * CLOUD_LUMPS);
  vRadius = puff.w;
  vSeed = lumpSeed(uint(texelFetch(uCloudData, ivec2(2, row), 0).x), k);
  if (row >= int(uCloudLook.z) || puff.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 c = puff.xyz;
  vec3 up = normalize(c);
#ifdef RADIAL
  vec3 centre = c;
  vec3 a = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(up, a);
  float stretch = 1.0;
  vSideA = a;
#else
  // down the light to the water table
  vec3 L = localSun(up);
  float cl = dot(c, L);
  vec3 centre = c - L * (cl - sqrt(max(cl * cl - dot(c, c) + uRadius * uRadius, 0.0)));
  vec3 g = normalize(centre);
  vec3 a = L - g * dot(L, g); // toward the sun along the ground
  float al = length(a);
  a = al > 1e-4 ? a / al : normalize(cross(g, abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(g, a);
  // a sphere's shadow is drawn out along the light by 1 / sin(elevation)
  float stretch = 1.0 / max(dot(L, g), 0.2);
  vSideA = normalize(a - L * dot(a, L));
#endif
  vSideB = b;
  vec3 corner = centre + (a * vOff.x * stretch + b * vOff.y) * puff.w;
  // projected from the planet's centre onto this face: perspective-correct, so the splat keeps its shape
  vec3 f = corner * uCubeFace;
  gl_Position = vec4((f.xy - uFaceWindow.xy * f.z) * uFaceWindow.z, 0.0, f.z);
}
