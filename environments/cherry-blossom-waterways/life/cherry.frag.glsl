#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vLocal;
varying vec3 vWorld;
varying float vKind;
varying float vTint;
varying float vBloom;
void main() {
  vec3 n = normalize(vNormal);
  float light = 0.55 + 0.45*toonLight(dot(n,uSunDir));
  vec3 col;
  if(vKind < 0.5) {
    float stroke = sin(vLocal.y*2.7 + sin(vLocal.x*11.0+vLocal.z*8.0)*1.8);
    col = mix(vec3(0.035,0.046,0.043),vec3(0.125,0.098,0.091),vTint*0.5+light*0.5);
    col += vec3(0.026,0.018,0.019)*smoothstep(0.55,0.85,stroke);
  } else if(vKind < 2.5) {
    vec3 pink = mix(vec3(0.91,0.34,0.51),vec3(1.0,0.65,0.73),vTint);
    vec3 cream = mix(vec3(1.0,0.77,0.76),vec3(1.0,0.96,0.88),vTint);
    col = (vKind > 1.5 ? cream : pink) * (0.8+light*0.2);
    col = mix(col,vec3(0.72,0.38,0.58),0.12*(1.0-light));
    col = mix(vec3(0.32,0.50,0.16)*(0.85+0.15*light),col,vBloom);
  } else {
    col = mix(vec3(0.13,0.34,0.07),vec3(0.52,0.75,0.15),0.45*vTint+0.55*light);
  }
  col = applyAerial(col, length(cameraPosition-vWorld), vPlanet);
  gl_FragColor = vec4(col,1.0);
}
