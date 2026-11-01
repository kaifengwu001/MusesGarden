#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uSceneryTime;
uniform vec4 uWindVec;
attribute float aKind;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
attribute float aHeightScale;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
varying float vPresence;
vec3 rotateAround(vec3 n,vec3 axis,float a){return n*cos(a)+cross(axis,n)*sin(a)+axis*dot(axis,n)*(1.0-cos(a));}
void main(){
 vec3 U=normalize(aAnchor.xyz);
 vec3 X=normalize(aAcross);
 vec3 Z=normalize(cross(X,U));
 vec3 p=position*aPlacement.x;
 p.y*=aHeightScale;
 vec3 breeze=cross(uWindVec.xyz,U);
 vec2 breezeLocal=vec2(dot(breeze,X),dot(breeze,Z));
 if(aKind>0.5&&aKind<1.5) p.xz+=breezeLocal*sin(uSceneryTime*0.65+aPlacement.y+position.y*0.4)*0.24*uWindVec.w*uv.y*uv.y*aPlacement.x;
 if(aKind>2.5&&aKind<3.5) p.x+=sin(uSceneryTime*0.9+aPlacement.y)*0.07*uWindVec.w*max(position.y,0.0)*aPlacement.x;
 float d=length(p.xz);
 float angle=asin(min(d/uRadius,0.9));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T));
 vec3 up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(uRadius+aAnchor.w+p.y);
 vec3 localNormal=normalize(vec3(normal.x,normal.y/aHeightScale,normal.z));
 vec3 n=rotateAround(normalize(X*localNormal.x+U*localNormal.y+Z*localNormal.z),axis,angle);
 vPlanet=planet;vPlanetNormal=n;vWorld=warpPosition(planet);
 vLocal=position;vUv=uv;vKind=aKind;vVariation=aPlacement.z;vPresence=aPlacement.w;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
