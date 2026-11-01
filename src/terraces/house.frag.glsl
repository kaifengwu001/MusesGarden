// A house as the ink paintings lay them: white plaster in the sun, a cool
// blue-grey in shade, a grey stone plinth, a dark band under the eaves, a
// dark door and small windows on the front; the roof dark ink grey, its tile
// courses faint, the ridge darkest. Then the haze and the valley fog.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <terraces_plots>
#include <terraces_fog>

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWarped;
flat varying float vPart;
flat varying vec4 vSize;

void main() {
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  if (dot(n, toCam) < 0.0) n = -n;
  float b = toonLight(dot(n, uSunDir));
  vec3 col;
  float L = vSize.x;
  float W = vSize.z;
  if (vPart > 0.5 && vPart < 1.5) {
    // the roof: dark tiles in courses down the slope, the ridge darkest, the eaves' edge catching the light
    float slope = vLocal.y - W;
    float course = fract(slope * 5.0);
    col = tone3(pal(TR_PEAK, 1) * 0.62, pal(TR_PEAK, 3) * 0.95, pal(TR_PEAK, 3) * 0.55, b);
    col *= 0.92 + 0.08 * smoothstep(0.2, 0.6, course);
    col = mix(col, pal(TR_PEAK, 3) * 0.4, smoothstep(0.3 * vSize.y * 0.62 - 0.15, 0.31 * vSize.y * 0.62, slope));
    if (n.y < -0.5 || dot(normalize(vNormal), normalize(vPlanet)) < -0.2) col = pal(TR_PEAK, 3) * 0.35;
  } else {
    // plaster, the plinth, the band under the eaves
    col = tone3(pal(TR_FOG, 3), mix(pal(TR_FOG, 0), pal(TR_FOG, 1), 0.5), pal(TR_FOG, 2) * 0.9, b);
    col *= 0.96 + 0.06 * hash12(floor(vLocal.xz * 3.0 + vSize.w * 50.0));
    col = mix(col, tone3(pal(TR_PEAK, 4), pal(TR_PEAK, 1), pal(TR_PEAK, 3), b), 1.0 - smoothstep(0.38, 0.46, vLocal.y));
    if (vPart < 0.5) col *= mix(1.0, 0.62, smoothstep(W - 0.45, W - 0.05, vLocal.y));
    // the front: a door off the middle and two small windows
    float front = vLocal.z / vSize.y;
    if (vPart < 0.5 && front > 0.49) {
      float doorX = (fract(vSize.w * 7.0) - 0.5) * 0.3 * L;
      if (abs(vLocal.x - doorX) < 0.45 && vLocal.y > 0.38 && vLocal.y < 1.95) col = pal(TR_FOREST, 5) * 0.7;
      for (int k = -1; k <= 1; k += 2) {
        float wx = doorX + float(k) * 0.3 * L;
        if (abs(wx) < 0.5 * L - 0.6 && abs(vLocal.x - wx) < 0.32 && abs(vLocal.y - 1.45) < 0.3) col = pal(TR_PEAK, 3) * 0.5;
      }
    }
  }
  col = applyAerial(col, dist, normalize(vPlanet));
  col = applyValleyFog(col, vPlanet);
  gl_FragColor = vec4(col, 1.0);
}
