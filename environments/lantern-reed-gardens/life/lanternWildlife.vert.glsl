#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uWildlifeTime;
attribute float aKind;
attribute vec3 aJoint;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aAnimal;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vNormal;
varying vec2 vUv;
varying float vKind;
varying float vPhase;
vec3 turnZ(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec3 turnY(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
void main(){
 vec3 p=position,n=normal;
 float t=uWildlifeTime,phase=aAnimal.y;
 if(aKind>1.5&&aKind<2.5){
   if(aJoint.z< -1.3){float a=sin(t*1.5+phase)*0.14;p=aJoint+turnY(p-aJoint,a);n=turnY(n,a);}
   else{float a=sign(aJoint.x)*sin(t*1.3+phase)*0.13;p=aJoint+turnZ(p-aJoint,a);n=turnZ(n,a);}
 }
 if(aAnimal.w>0.5){
   if(aKind<7.5||aKind>8.5)p.y+=(0.012*sin(t*1.4+phase)+aAnimal.z*0.014*sin(t*3.2+phase))*max(p.y,0.0);
   if(aKind>5.5&&aKind<6.5)p.y+=0.018*sin(t*0.8+phase+position.z)*uv.y;
   if(aKind>7.5&&aKind<8.5){float stride=sin(t*2.0+phase+(position.x*position.z>0.0?3.14159:0.0));p.z+=stride*0.055*aAnimal.z;p.y+=max(stride,0.0)*0.04*aAnimal.z;}
   if(aKind>8.5&&aKind<9.5)p.x+=sign(position.x)*0.018*sin(t*1.2+phase)*uv.y;
 }
 p*=aAnimal.x;
 vec3 U=normalize(aAnchor.xyz),X=normalize(aAcross),Z=normalize(cross(X,U));
 float d=length(p.xz),s=min(d/uRadius,0.9),c=sqrt(1.0-s*s);
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T)),up=U*c+T*s;
 vec3 planet=up*(uRadius+aAnchor.w+p.y);
 vec3 normalPlanet=normalize(X*n.x+U*n.y+Z*n.z);
 normalPlanet=normalPlanet*c+cross(axis,normalPlanet)*s+axis*dot(axis,normalPlanet)*(1.0-c);
 vPlanet=planet;vNormal=normalPlanet;vWorld=warpPosition(planet);vUv=uv;vKind=aKind;vPhase=phase;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
