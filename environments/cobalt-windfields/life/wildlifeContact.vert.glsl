#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
attribute vec4 aShadowAnchor;
attribute vec3 aShadowAcross;
attribute vec3 aShadowShape;
varying vec2 vContact;
varying float vOpacity;
void main(){
 vec3 up=normalize(aShadowAnchor.xyz),across=normalize(aShadowAcross),forward=normalize(cross(across,up));
 vec2 offset=position.xy*aShadowShape.xy;
 vec3 dir=normalize(up+(across*offset.x+forward*offset.y)/uRadius);
 // Read the same GPU ground as the visible terrain: the shadow cannot float
 // at a CPU approximation height or follow an animal into the air.
 float ground=height0(dir)+uBank.x;
 vec3 planet=dir*(uRadius+ground+0.0015);
 vContact=position.xy;vOpacity=aShadowShape.z;
 gl_Position=projectionMatrix*viewMatrix*vec4(warpPosition(planet),1.0);
}
