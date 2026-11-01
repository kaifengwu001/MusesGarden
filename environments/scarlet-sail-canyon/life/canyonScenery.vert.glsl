#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <canyon_ground>
uniform float uSceneryTime;
uniform vec4 uWindVec;
attribute float aKind;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
attribute float aHeightScale;
attribute float aPlantBase;
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
 bool plant=(aKind>2.5&&aKind<3.5)||aKind>7.5;
 float verticalScale=plant?1.0:aHeightScale;
 // Shelf relief moves the support face, while each rooted plant keeps its form.
 p.y=(aPlantBase*aHeightScale+(position.y-aPlantBase)*verticalScale)*aPlacement.x;
 vec3 breeze=cross(uWindVec.xyz,U);
 vec2 breezeLocal=vec2(dot(breeze,X),dot(breeze,Z));
 if(aKind>0.5&&aKind<1.5) p.xz+=breezeLocal*sin(uSceneryTime*0.65+aPlacement.y+position.y*0.4)*0.24*uWindVec.w*uv.y*uv.y*aPlacement.x;
 if(aKind>2.5&&aKind<3.5) p.x+=sin(uSceneryTime*0.9+aPlacement.y)*0.035*uWindVec.w*uv.y*aPlacement.x;
 float d=length(p.xz);
 float angle=asin(min(d/uRadius,0.9));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T));
 vec3 up=U*cos(angle)+T*sin(angle);
 float groundedHeight=canyonGroundedHeight(up,aAnchor.w+p.y,aKind,position.y);
 vec3 planet=up*(uRadius+groundedHeight);
 vec3 localNormal=normalize(vec3(normal.x,normal.y/verticalScale,normal.z));
 vec3 n=rotateAround(normalize(X*localNormal.x+U*localNormal.y+Z*localNormal.z),axis,angle);
 vPlanet=planet;vPlanetNormal=n;vWorld=warpPosition(planet);
 vLocal=position;vUv=uv;vKind=aKind;vVariation=aPlacement.z;vPresence=aPlacement.w;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
