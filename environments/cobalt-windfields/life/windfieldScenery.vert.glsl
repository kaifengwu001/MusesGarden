#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uSceneryTime;
uniform vec4 uWindVec;
uniform vec4 uCottage;
uniform vec4 uBloom;
uniform vec4 uUserBloom[8];
attribute float aKind;
attribute float aGround;
attribute float aFootDepth;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 rotateAround(vec3 n,vec3 axis,float a){return n*cos(a)+cross(axis,n)*sin(a)+axis*dot(axis,n)*(1.0-cos(a));}
void main(){
 vec3 U=normalize(aAnchor.xyz), X=normalize(aAcross), Z=normalize(cross(X,U));
 vec3 p=position*aPlacement.x;
 p.y-=aGround*aFootDepth;
 // The existing bloom gesture unfolds this world's sails and coral.
 float angleFromHome=acos(clamp(dot(U,normalize(uCottage.xyz)),-1.0,1.0));
 float flourish=1.0-smoothstep(uBloom.x-uBloom.y,uBloom.x+uBloom.y,angleFromHome);
 for(int i=0;i<8;i++){
  vec4 disc=uUserBloom[i];
  if(disc.w>0.0){
   float gap=acos(clamp(dot(U,normalize(disc.xyz)),-1.0,1.0));
   flourish=max(flourish,1.0-smoothstep(disc.w*0.7,disc.w,gap));
  }
 }
 if(aKind<1.5||aKind>2.5&&aKind<3.5)p*=mix(0.55,1.0,flourish);
 vec3 wind=cross(uWindVec.xyz,U);
 float breath=0.7+0.3*sin(uSceneryTime*0.8+aPlacement.y);
 if(aKind<1.5){
  float bend=pow(max(position.y,0.0)/4.5,2.0)*uWindVec.w*breath*0.42*aPlacement.x;
  p.x+=dot(wind,X)*bend; p.z+=dot(wind,Z)*bend;
  if(aKind>0.5)p.z+=sin(uSceneryTime*1.7+aPlacement.y+position.y)*0.045*uWindVec.w*aPlacement.x;
 }
 if(aKind>2.5&&aKind<3.5)p.x+=sin(uSceneryTime+aPlacement.y)*0.012*position.y*uWindVec.w;
 if(aKind>10.5&&aKind<11.5)p.x+=(sin(uSceneryTime*0.3+aPlacement.y)*0.5+0.5)*max(position.y-0.32,0.0)*0.27*aPlacement.x;
 if(aKind>11.5&&aKind<12.5)p.y+=sin(uSceneryTime*12.0+aPlacement.y)*abs(position.x)*0.65*aPlacement.x;
 if(aPlacement.w>0.5&&aKind<10.5)p.y+=sin(uSceneryTime*3.8+aPlacement.y)*0.008*aPlacement.x;
 float d=length(p.xz), angle=asin(min(d/uRadius,0.9));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X, axis=normalize(cross(U,T));
 vec3 up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(uRadius+aAnchor.w+p.y);
 vec3 n=rotateAround(normalize(X*normal.x+U*normal.y+Z*normal.z),axis,angle);
 vPlanet=planet;vPlanetNormal=n;vWorld=warpPosition(planet);
 vLocal=position;vLocalNormal=normal;vUv=uv;vKind=aKind;vVariation=aPlacement.z;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
