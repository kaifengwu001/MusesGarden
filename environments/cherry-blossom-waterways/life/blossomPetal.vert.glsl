#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
uniform float uTime;
uniform vec4 uBloom;
uniform vec4 uCottage;
attribute vec4 aAnchor;
attribute vec4 aStyle;
varying vec3 vColour;
void main(){
  vec3 U=aAnchor.xyz;
  if(acos(clamp(dot(U,uCottage.xyz),-1.0,1.0))>uBloom.x){gl_Position=vec4(0.0,0.0,-2.0,1.0);return;}
  vec3 X=normalize(cross(abs(U.y)<0.9?vec3(0,1,0):vec3(1,0,0),U));
  vec3 Z=cross(X,U);
  float age=fract(uTime/(9.0+fract(aStyle.y)*5.0)+aStyle.y);
  float phase=aStyle.y*23.0;
  float height=(1.0-age)*7.8*aStyle.x+0.12;
  float x=sin(phase)*3.6*aStyle.x + age*3.0+sin(age*11.0+phase)*0.65;
  float z=cos(phase)*3.6*aStyle.x+sin(age*8.0+phase)*0.75;
  float spin=uTime*1.8+phase;
  vec3 p = U*(uRadius+aAnchor.w+height)+X*x+Z*z;
  float life=smoothstep(0.0,0.04,age)*(1.0-smoothstep(0.93,1.0,age));
  p += (X*(position.x*cos(spin)-position.y*sin(spin))+Z*position.z+U*(position.x*sin(spin)+position.y*cos(spin)))*0.15*life;
  vec3 w=warpPosition(p);
  vec3 col=mix(vec3(1.0,0.65,0.74),vec3(1.0,0.95,0.87),step(0.6,aStyle.w));
  vColour=applyAerial(col,length(cameraPosition-w),U);
  gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);
}
