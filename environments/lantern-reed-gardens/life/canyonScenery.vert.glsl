#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uSceneryTime;
attribute float aKind;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vModelNormal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 rotateAround(vec3 n,vec3 axis,float a){return n*cos(a)+cross(axis,n)*sin(a)+axis*dot(axis,n)*(1.0-cos(a));}
void main(){
 vec3 U=normalize(aAnchor.xyz),X=normalize(aAcross),Z=normalize(cross(X,U));
 vec3 p=position*aPlacement.x;
 if((aKind>0.5&&aKind<1.5)||(aKind>2.5&&aKind<3.5)||(aKind>6.5&&aKind<9.5)){
   p.x+=sin(uSceneryTime*0.55+aPlacement.y)*position.y*position.y*0.0025*aPlacement.x;
 }
 if(aKind>0.5&&aKind<1.5) p.z+=sin(uSceneryTime*0.7+aPlacement.y+position.x*0.4)*0.04*uv.y*uv.y*aPlacement.x;
 if(aKind>9.5&&aKind<10.5) p.y+=abs(p.x)*sin(uSceneryTime*14.0+aPlacement.y)*0.65;
 float d=length(p.xz),angle=asin(min(d/uRadius,0.9));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T)),up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(uRadius+aAnchor.w+p.y);
 vec3 n=rotateAround(normalize(X*normal.x+U*normal.y+Z*normal.z),axis,angle);
 vPlanet=planet;vPlanetNormal=n;vWorld=warpPosition(planet);
 vLocal=position;vModelNormal=normal;vUv=uv;vKind=aKind;vVariation=aPlacement.z;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
