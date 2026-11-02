#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
uniform float uHarvestTime;
uniform vec4 uWindVec;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
attribute float aKind;
varying vec3 vPlanet;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vKind;
varying float vTint;
vec3 rotateHarvest(vec3 n,vec3 axis,float angle){return n*cos(angle)+cross(axis,n)*sin(angle)+axis*dot(axis,n)*(1.0-cos(angle));}
void main(){
 vec3 U=normalize(aAnchor.xyz),X=normalize(aAcross),Z=normalize(cross(X,U));
 vec3 p=position*aPlacement.x;
 p.y*=aPlacement.y;
 if(aKind>.5&&aKind<1.5){
  vec3 wind=cross(uWindVec.xyz,U);
  vec2 w=vec2(dot(wind,X),dot(wind,Z));
  p.xz+=w*sin(uHarvestTime*.32+aPlacement.z+position.y*.18)*.12*uWindVec.w*pow(clamp(position.y/12.0,0.0,1.0),2.0)*aPlacement.x;
 }
 float d=length(p.xz),angle=asin(min(d/uRadius,.95));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T)),up=U*cos(angle)+T*sin(angle);
 float height=aAnchor.w+p.y;
 if(aKind>1.5&&aKind<2.5&&position.y<-.1)height=min(height,height0(up)+uBank.x-.15);
 vec3 planet=up*(uRadius+height);
 vec3 n=normalize(vec3(normal.x,normal.y/aPlacement.y,normal.z));
 vNormal=rotateHarvest(normalize(X*n.x+U*n.y+Z*n.z),axis,angle);
 vPlanet=planet;vWorld=warpPosition(planet);vLocal=position;vKind=aKind;vTint=aPlacement.w;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
