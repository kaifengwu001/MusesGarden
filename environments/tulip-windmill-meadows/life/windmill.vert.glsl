#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
attribute vec3 color;
attribute float aFoot;
varying vec3 vColour;
varying vec3 vPlanet;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vKind;
void main(){
 vec3 planet=(modelMatrix*vec4(position,1)).xyz;
 // Extend foundation bottoms to the actual spherical ground. Walls and roofs
 // remain rigid; only the buried foot ring follows the terrain.
 if(aFoot>0.5){vec3 d=normalize(planet);planet=d*(uRadius+height0(d)+uBank.x-0.08);}
 vColour=color;vPlanet=planet;vNormal=normalize(mat3(modelMatrix)*normal);
 vWorld=warpPosition(planet);vKind=3.0;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);
}
