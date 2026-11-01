// Little things that float about Muse (museProps.ts): Zzz, hearts, notes,
// steam, drops of water, its snore bubble. Each a square turned to face the
// camera about its middle (planet space, warped like everything else), drawn
// from one sheet of pictures.
#include <meadow_common>
#include <meadow_warp>

attribute vec4 aMote; // middle (planet space, m), size (m)
attribute vec4 aLook; // which picture, how opaque, its turn (rad), -

varying vec2 vUv;
varying float vPicture;
varying float vAlpha;

void main() {
  vec4 view = viewMatrix * vec4(warpPosition(aMote.xyz), 1.0);
  float c = cos(aLook.z);
  float s = sin(aLook.z);
  view.xy += mat2(c, s, -s, c) * position.xy * aMote.w;
  gl_Position = projectionMatrix * view;
  vUv = position.xy + 0.5;
  vPicture = aLook.x;
  vAlpha = aLook.y;
}
