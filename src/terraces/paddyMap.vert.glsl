// The built terraces drawn into the paddy map (paddyMap.ts) from above: an
// azimuthal map round the focus, each surface where it lies; the higher in
// front (a bund over the floor beside it), each floor with its paddy's
// plants, the rest with none.
#include <meadow_common>
uniform float uRadius;
#include <terraces_common>
#include <terraces_paddy>
uniform vec4 uMapCentre; // focus direction, angular radius Θ
uniform vec3 uMapT1;

attribute float aPart;
attribute vec4 aPaddy; // its paddy's constants (build/construct.ts)
attribute vec4 aFloor; // its floor (m), fallow, share across its band, -

varying vec4 vData;

void main() {
  vec3 dir = normalize(position);
  vec3 c = uMapCentre.xyz;
  vec3 t2 = cross(c, uMapT1);
  vec2 tan2 = vec2(dot(dir, uMapT1), dot(dir, t2));
  float s = length(tan2);
  float a = atan(s, dot(dir, c));
  vec2 xy = s > 1e-9 ? tan2 / s * (a / uMapCentre.w) : vec2(0.0);
  float h = length(position) - uRadius;
  // plants' height, its floor, colour, stage: a floor's; none on the walls, dams, ridges or the woods
  Crop crop = cropFrom(aPaddy.x, aPaddy.y, aPaddy.z, aPaddy.w, aFloor.y);
  vData = aPart < 0.5 ? vec4(crop.height, aFloor.x, crop.variant, crop.maturity) : vec4(0.0);
  gl_Position = vec4(xy, clamp(1.0 - (h + 20.0) / 200.0, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}
