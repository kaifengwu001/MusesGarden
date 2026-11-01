#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uWildSpecies;
uniform float uWildOutline;
uniform float uWildDisplayScale;
attribute float aKind;
attribute float aJoint;
attribute vec3 aPivot;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aMotion;
attribute vec4 aFeet;
attribute vec2 aSlope;
attribute float aPresence;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec2 vUv;
varying float vKind;
varying float vPresence;
vec3 turnZ(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
void main(){
 vec3 p=position,n=normal;
 if(aJoint>0.5&&aJoint<4.5){
  float alternate=(aJoint<1.5||aJoint>3.5)?0.0:3.14159265;
  float phase=aMotion.x+alternate;
  float stride=uWildSpecies<0.5?0.012:0.005;
  p.z+=sin(phase)*stride*aMotion.y;
  p.y+=max(0.0,cos(phase))*stride*0.7*aMotion.y;
  float foot=aJoint<1.5?aFeet.x:aJoint<2.5?aFeet.y:aJoint<3.5?aFeet.z:aFeet.w;
  float residual=foot-dot(aSlope,aPivot.xz*uWildDisplayScale);
  p.y+=residual/uWildDisplayScale*(1.0-clamp(position.y/max(aPivot.y,0.001),0.0,1.0));
 }
 if(aJoint>4.5&&aJoint<8.5){
  float angle;
  if(uWildSpecies<0.5) angle=(1.0-aMotion.z)*1.08*(aJoint<5.5?1.0:-1.0);
  else {
   float side=(aJoint<5.5||(aJoint>6.5&&aJoint<7.5))?-1.0:1.0;
   angle=side*(sin(aMotion.x+(aJoint>6.5?0.35:0.0))*0.5*aMotion.y+0.14*(1.0-aMotion.y));
  }
  p=aPivot+turnZ(p-aPivot,angle);n=turnZ(n,angle);
 }
 float partPresence=1.0;
 if(aJoint>8.5){
  float deposited=smoothstep(0.65,0.95,aMotion.w);
  if(uWildSpecies<0.0)partPresence=deposited;
  else{p.y-=0.015*aMotion.w;partPresence=1.0-deposited;}
 }
 p*=uWildDisplayScale*(uWildSpecies<0.0?aMotion.z:1.0);
 p.y+=dot(aSlope,p.xz);
 n=normalize(vec3(n.x-aSlope.x*n.y,n.y,n.z-aSlope.y*n.y));
 // A restrained silhouette stroke, in physical units, also follows the rig.
 p+=n*uWildOutline*(uWildSpecies<0.5?0.00065:0.0003)*uWildDisplayScale;
 vec3 U=normalize(aAnchor.xyz),X=normalize(aAcross),Z=normalize(cross(X,U));
 vec3 up=normalize(U+(X*p.x+Z*p.z)/uRadius);
 vec3 planet=up*(uRadius+aAnchor.w+p.y);
 vPlanet=planet;vWorld=warpPosition(planet);vPlanetNormal=normalize(X*n.x+U*n.y+Z*n.z);
 vUv=uv;vKind=aKind;vPresence=aPresence*partPresence;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
