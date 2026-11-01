#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uTime;
uniform vec4 uWindVec;
attribute float aKind;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 turn(vec3 n,vec3 axis,float a){return n*cos(a)+cross(axis,n)*sin(a)+axis*dot(axis,n)*(1.0-cos(a));}
void main(){
 vec3 X=normalize(modelMatrix[0].xyz),U=normalize(modelMatrix[1].xyz),Z=normalize(modelMatrix[2].xyz);
 float ground=length(modelMatrix[3].xyz);
 vec3 p=position;
 if(aKind>3.5&&aKind<4.5)p.y+=0.06*uWindVec.w*sin(uTime*0.8+p.x*1.4)*sin(uv.x*0.324)*sin(uv.y*0.462);
 float d=length(p.xz),angle=asin(min(d/uRadius,1.0));
 vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
 vec3 axis=normalize(cross(U,T));
 vec3 up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(ground+p.y);
 vPlanet=planet;vWorld=warpPosition(planet);
 vPlanetNormal=turn(normalize(X*normal.x+U*normal.y+Z*normal.z),axis,angle);
 vLocal=position;vUv=uv;vKind=aKind;vVariation=0.5;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
