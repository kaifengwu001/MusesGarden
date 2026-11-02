#include <meadow_sun>
uniform float uRadius;
uniform mat3 uCubeFace;
uniform vec3 uFaceWindow;
attribute vec4 aAnchor;
attribute vec4 aStyle;
varying vec2 vOff;
void main(){
  vOff=position.xy;
  vec3 U=aAnchor.xyz;
  vec3 X=normalize(cross(abs(U.y)<0.9?vec3(0,1,0):vec3(1,0,0),U));
  vec3 Z=cross(U,X);
  vec3 L=localSun(U);
  float height=7.0*aStyle.x;
  vec3 centre=U*(uRadius+aAnchor.w)- (L-U*dot(L,U))*height/max(dot(L,U),0.2);
  vec3 corner=centre+(X*position.x+Z*position.y)*5.4*aStyle.x;
  vec3 f=corner*uCubeFace;
  gl_Position=vec4((f.xy-uFaceWindow.xy*f.z)*uFaceWindow.z,0.0,f.z);
}
