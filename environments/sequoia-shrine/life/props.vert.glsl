#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
attribute float aKind;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying float vKind;
vec3 turn(vec3 v,vec3 axis,float a){return v*cos(a)+cross(axis,v)*sin(a)+axis*dot(axis,v)*(1.0-cos(a));}
void main(){
  vec3 X=normalize(modelMatrix[0].xyz),U=normalize(modelMatrix[1].xyz),Z=normalize(modelMatrix[2].xyz);
  vec3 p=position*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));
  float ground=length(modelMatrix[3].xyz),d=length(p.xz),angle=asin(min(d/uRadius,0.95));
  vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
  vec3 axis=normalize(cross(U,T)),up=U*cos(angle)+T*sin(angle);
  vec3 planet=up*(ground+p.y);
  vec3 n=turn(normalize(X*normal.x+U*normal.y+Z*normal.z),axis,angle);
  vPlanet=planet;vPlanetNormal=n;vWorld=warpPosition(planet);vLocal=position;vLocalNormal=normal;vKind=aKind;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
