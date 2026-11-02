#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uGroveTime;
attribute vec4 aAnchor;
attribute vec4 aPlacement;
attribute vec3 aAcross;
attribute float aKind;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vTint;
void main(){
  vec3 U=normalize(aAnchor.xyz),X=normalize(aAcross),Z=normalize(cross(X,U));
  vec3 p=position*aPlacement.x;
  if(aKind>0.5&&aKind<1.5){
    float sway=sin(uGroveTime*0.22+aPlacement.y+position.y*0.12)*0.045;
    p.x+=sway*max(0.0,position.y-12.0)*0.025;
  }
  if(aKind>2.5&&aKind<3.5)p.x+=sin(uGroveTime*0.65+aPlacement.y)*0.018*position.y;
  float d=length(p.xz),angle=asin(min(d/uRadius,0.88));
  vec3 T=d>0.0001?(X*p.x+Z*p.z)/d:X;
  vec3 axis=normalize(cross(U,T));
  vec3 up=U*cos(angle)+T*sin(angle);
  vec3 planet=up*(uRadius+aAnchor.w+p.y);
  vec3 N=normalize(X*normal.x+U*normal.y+Z*normal.z);
  vec3 n=N*cos(angle)+cross(axis,N)*sin(angle)+axis*dot(axis,N)*(1.0-cos(angle));
  vPlanet=planet;vPlanetNormal=normalize(n);vWorld=warpPosition(planet);
  vLocal=position;vKind=aKind;vTint=aPlacement.z;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
