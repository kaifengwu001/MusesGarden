#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
attribute float aKind;
attribute float aVariation;
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
 float d=length(position.xz),angle=asin(min(d/uRadius,1.0));
 vec3 T=d>1e-5?(X*position.x+Z*position.z)/d:X;
 vec3 axis=normalize(cross(U,T));
 vec3 up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(ground+position.y);
 vPlanet=planet;vWorld=warpPosition(planet);
 vPlanetNormal=turn(normalize(X*normal.x+U*normal.y+Z*normal.z),axis,angle);
 vLocal=position;vUv=uv;vKind=aKind;vVariation=aVariation;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
