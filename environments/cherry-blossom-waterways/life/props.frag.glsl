// The riverside pavilion: cool glazed tiles, muted coral structural timber,
// weathered landing planks and pale warm stone. Broad paint stays subordinate
// to courses, joints and grain; no cottage walls or chimney are implied.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform int uKind;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vUp;

vec3 pigment(vec3 srgb) { return pow(srgb, vec3(2.2)); }

void main() {
  vec3 dir=normalize(vPlanet);
  vec3 n=normalize(vPlanetNormal);
  if(!gl_FrontFacing) n=-n;
  float sun=smoothstep(-0.25,0.7,dot(n,localSun(dir)));
  float cloud=cloudShadowAt(vPlanet,0.0);
  float brush=gnoise(vec3(vUv*vec2(1.3,4.0),3.4),431u);
  float footprint=max(length(fwidth(vUv)),0.001);
  vec3 base;
  if(uKind==1) {
    float course=floor(vPaint.z);
    float f=clamp(vPaint.x*14.0-course,0.0,1.0);
    float tx=vUv.x/0.34+hash12(vec2(course,2.7))*0.5;
    float tile=floor(tx);
    float tint=hash12(vec2(tile,course));
    base=mix(pigment(vec3(0.30,0.40,0.47)),pigment(vec3(0.42,0.52,0.57)),tint*0.65);
    if(!gl_FrontFacing) {
      base=pigment(vec3(0.25,0.23,0.25));
      sun=0.0;
    } else if(vPaint.w<0.5) {
      float seam=1.0-smoothstep(0.012,0.035+footprint,min(fract(tx),1.0-fract(tx))*0.34);
      base*=1.0-0.24*seam;
      base*=mix(1.06,0.78,smoothstep(0.55,0.98,f));
      // A slender blue-white glaze catches the lower curved edge of each tile.
      base=mix(base,pigment(vec3(0.63,0.71,0.72)),(1.0-smoothstep(0.0,0.14,f))*0.24);
    } else if(vPaint.w<2.5) {
      base=pigment(vec3(0.48,0.59,0.63))*(0.92+0.12*tint);
    } else {
      base=mix(pigment(vec3(0.34,0.46,0.53)),pigment(vec3(0.60,0.69,0.71)),sin(clamp(vUv.y,0.0,1.0)*3.14159)*0.5);
      base*=1.0-0.16*smoothstep(0.78,1.0,vUv.x);
    }
    base*=1.0+0.045*brush;
  } else if(uKind==2) {
    float grain=gnoise(vec3(vUv.x*24.0,vUv.y*1.7,8.2),432u);
    if(vPaint.w>2.5) {
      base=mix(pigment(vec3(0.53,0.37,0.27)),pigment(vec3(0.68,0.49,0.35)),0.4+0.2*grain);
    } else if(vPaint.w>1.5) {
      base=pigment(vec3(0.56,0.35,0.25))*(1.0+0.10*grain);
    } else {
      base=pigment(vec3(0.65,0.32,0.26))*(1.0+0.055*grain);
      // Posts darken under the eaves while retaining the coral colour.
      base*=mix(1.0,0.72,smoothstep(2.65,3.40,vLocal.y));
    }
    base*=0.94+0.06*smoothstep(0.0,0.035,vPaint.x);
  } else if(uKind==3) {
    base=pigment(vec3(0.22,0.29,0.31));
  } else {
    bool top=vLocalNormal.y>0.7;
    vec2 p=top?vLocal.xz:vUv;
    float row=floor(p.y/(top?0.8:0.35));
    vec2 cell=vec2(p.x/(top?1.05:0.7)+hash12(vec2(row,3.1))*0.6,p.y/(top?0.8:0.35));
    vec2 edge=min(fract(cell),1.0-fract(cell));
    float joint=1.0-smoothstep(0.005,0.018+footprint,min(edge.x,edge.y));
    base=mix(pigment(vec3(0.82,0.82,0.73)),pigment(vec3(0.94,0.91,0.82)),top?0.8:0.15);
    base*=1.0-0.09*joint+0.035*brush;
    if(!top) base=mix(base,pigment(vec3(0.43,0.53,0.40)),(1.0-smoothstep(-1.1,-0.65,vLocal.y))*0.55);
    if(top && abs(vLocal.x)<4.3 && abs(vLocal.z)<2.7) base*=0.84;
  }
  vec3 tint=mix(vec3(0.80,0.86,0.96),vec3(1.03,1.00,0.94),sun);
  vec3 col=base*tint*(0.80+0.22*sun)*(1.0-0.18*cloud);
  gl_FragColor=vec4(applyAerial(col,length(cameraPosition-vWorld),dir),1.0);
}
