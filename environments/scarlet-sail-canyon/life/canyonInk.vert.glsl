#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <canyon_ground>
uniform float uSceneryTime;
uniform vec4 uWindVec;
attribute float aKind;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
attribute float aHeightScale;
attribute vec2 aGroundSlope;
attribute float aPlantBase;
attribute vec3 aInkNormalA;
attribute vec3 aInkNormalB;
attribute float aInkRule;
varying vec2 vFacing;
varying float vRule;
varying float vDistance;
varying float vKind;
varying float vPresence;

vec3 rotateAround(vec3 n, vec3 axis, float a) {
  return n*cos(a)+cross(axis,n)*sin(a)+axis*dot(axis,n)*(1.0-cos(a));
}

void main() {
  // This placement and wind block deliberately mirrors canyonScenery.vert.
  // Both draw calls consume the very same instance attributes and clock.
  vec3 U=normalize(aAnchor.xyz);
  vec3 X=normalize(aAcross);
  vec3 Z=normalize(cross(X,U));
  vec3 p=position*aPlacement.x;
  bool plant=(aKind>2.5&&aKind<3.5)||aKind>7.5;
  float verticalScale=plant?1.0:aHeightScale;
  p.y=(aPlantBase*aHeightScale+(position.y-aPlantBase)*verticalScale)*aPlacement.x;
  p.y+=dot(p.xz,aGroundSlope);
  vec3 breeze=cross(uWindVec.xyz,U);
  vec2 breezeLocal=vec2(dot(breeze,X),dot(breeze,Z));
  if(aKind>0.5&&aKind<1.5) p.xz+=breezeLocal*sin(uSceneryTime*0.65+aPlacement.y+position.y*0.4)*0.24*uWindVec.w*uv.y*uv.y*aPlacement.x;
  if(aKind>2.5&&aKind<3.5) p.x+=sin(uSceneryTime*0.9+aPlacement.y)*0.035*uWindVec.w*uv.y*aPlacement.x;
  float d=length(p.xz);
  float angle=asin(min(d/uRadius,0.9));
  vec3 T=d>1e-5?(X*p.x+Z*p.z)/d:X;
  vec3 axis=normalize(cross(U,T));
  vec3 up=U*cos(angle)+T*sin(angle);
  float groundedHeight=canyonGroundedHeight(up,aAnchor.w+p.y,aKind,position.y);
  vec3 planet=up*(uRadius+groundedHeight);
  vec3 world=warpPosition(planet);
  vec3 view=normalize(cameraPosition-world);
  vec3 localA=normalize(vec3(aInkNormalA.x,aInkNormalA.y/verticalScale,aInkNormalA.z));
  vec3 localB=normalize(vec3(aInkNormalB.x,aInkNormalB.y/verticalScale,aInkNormalB.z));
  localA.xz-=localA.y*aGroundSlope;localA=normalize(localA);
  localB.xz-=localB.y*aGroundSlope;localB=normalize(localB);
  vec3 normalA=rotateAround(X*localA.x+U*localA.y+Z*localA.z,axis,angle);
  vec3 normalB=rotateAround(X*localB.x+U*localB.y+Z*localB.z,axis,angle);
  vFacing=vec2(dot(warpNormal(planet,normalA),view),dot(warpNormal(planet,normalB),view));
  vRule=aInkRule;
  vDistance=distance(cameraPosition,world);
  vKind=aKind;
  vPresence=aPlacement.w;
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
  // A tiny depth bias seats the one-pixel line on its surface without an
  // expanded shell or visible separation from the swaying leaf rim.
  gl_Position.z-=0.000002*gl_Position.w;
}
