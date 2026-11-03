#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uTime;
uniform vec4 uWindVec;
uniform vec4 uBloom;
uniform vec4 uCottage;
uniform vec4 uUserBloom[8];
varying float vBloom;
attribute vec4 aAnchor;
attribute vec4 aStyle;
attribute float aKind;
attribute float aTint;
attribute vec4 aFlex;
attribute float aShade;
varying float vShade;
varying float vScale;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vLocal;
varying vec3 vWorld;
varying float vKind;
varying float vTint;
void main() {
  vec3 U = aAnchor.xyz;
  float distance = acos(clamp(dot(U,uCottage.xyz),-1.0,1.0));
  vBloom=1.0-smoothstep(uBloom.x-uBloom.y,uBloom.x+uBloom.y,distance);
  for(int i=0;i<8;i++){
    float d=acos(clamp(dot(U,uUserBloom[i].xyz),-1.0,1.0));
    vBloom=max(vBloom,1.0-smoothstep(uUserBloom[i].w-.02,uUserBloom[i].w+.02,d));
  }
  vec3 X = normalize(cross(abs(U.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0), U));
  vec3 Z = cross(X,U);
  vec3 XX = X*cos(aStyle.y)+Z*sin(aStyle.y);
  vec3 ZZ = Z*cos(aStyle.y)-X*sin(aStyle.y);
  vec3 p = position*aStyle.x;
  float sway = sin(uTime*0.72+aStyle.z*12.0+p.y*0.37)*0.14*uWindVec.w*smoothstep(2.5,9.0,p.y);
  p.x += sway;
  p.z += sin(uTime*0.47+aStyle.z*17.0)*0.09*uWindVec.w*smoothstep(3.0,9.0,p.y);
  if (aStyle.w > 2.5) {
    // Each stem and its leaves share a bend field: attachment fixed, free tip moves most.
    float phase = aStyle.z*11.0 + aFlex.x*0.47 + aFlex.z*0.61;
    float bend = aFlex.w*uWindVec.w*aStyle.x;
    p.x += (sin(uTime*0.82+phase)*0.48 + sin(uTime*1.31+phase)*0.11)*bend;
    p.z += sin(uTime*0.63+phase+1.2)*0.34*bend;
    p.y += sin(uTime*0.82+phase)*0.055*bend;
  }
  vec3 world = U*(uRadius+aAnchor.w+p.y) + XX*p.x + ZZ*p.z;
  vec3 n = normalize(XX*normal.x + U*normal.y + ZZ*normal.z);
  vNormal = n;
  vPlanet = normalize(world);
  vLocal = position;
  vKind = aKind;
  vTint = aTint;
  vShade = aShade;
  vScale = aStyle.x;
  vWorld = warpPosition(world);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.0);
}
