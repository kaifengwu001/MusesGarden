#include <meadow_common>
#include <meadow_toon>
#include <meadow_noise>
#include <meadow_fog>
varying vec3 vColour;
varying vec3 vPlanet;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vKind;
void main(){
 vec3 n=normalize(vNormal);
 float light=0.6+0.4*max(dot(n,uSunDir),0.0);
 if(!gl_FrontFacing)light=0.68+0.27*max(dot(-n,uSunDir),0.0);
 vec3 shade=mix(vec3(0.78,0.79,0.95),vec3(1),light);
 float grain=gnoise(vPlanet*31.0,711u)*0.035;
 vec3 col=vColour*shade*(0.97+grain);
 col=applyAerial(col,distance(vWorld,cameraPosition),normalize(vPlanet));
 gl_FragColor=vec4(col,1);
}
