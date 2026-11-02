#include <meadow_common>
#include <meadow_noise>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_terrain>
varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
uniform int uFarmCount;
uniform vec4 uFarmUp[20];
uniform vec4 uFarmAcross[20];
uniform vec4 uFarmAlong[20];
vec3 flowerColour(float k){
 if(k<0.5)return vec3(0.323,0.423,0.784);
 if(k<1.5)return vec3(0.93,0.815,0.72);
 if(k<2.5)return vec3(0.847,0.133,0.205);
 if(k<3.5)return vec3(0.913,0.347,0.477);
 if(k<4.5)return vec3(0.93,0.738,0.242);
 return vec3(1.0,0.521,0.133);
}
void main(){
 vec3 dir=normalize(vDir),right=normalize(cross(uCottage.xyz,uCottageB.xyz));
 float x=atan(dot(dir,right),dot(dir,uCottage.xyz))*128.0;
 float z=asin(clamp(dot(dir,uCottageB.xyz),-1.0,1.0))*128.0;
 float field=(x+z*0.18+3.0*sin(z/27.0)+24.0)/9.0;
 float band=mod(floor(field)+floor((z+26.0)/52.0),6.0);
 float distanceEye=distance(cameraPosition,vWarped);
 float paths=max(smoothstep(0.925,0.955,fract(field)),smoothstep(0.965,0.985,fract((z+26.0)/52.0)));
 float homeDistance=chordAngle(dir,uCottage.xyz)*uRadius;
 float textureMark=gnoise(dir*uRadius*8.0,991u);
 vec3 green=mix(vec3(0.29,0.40,0.16),vec3(0.43,0.52,0.23),0.5+0.25*textureMark);
 vec3 flowers=flowerColour(band);
 vec3 ground=mix(green,flowers,0.18+0.72*smoothstep(18.0,70.0,distanceEye));
 float parcel=mod(floor((x+32.0)/64.0)*7.0+floor((z+26.0)/52.0)*3.0,11.0);
 if(parcel<2.0&&homeDistance>70.0)ground=green;
 vec3 soil=vec3(0.66,0.54,0.36);
 float pathMask=paths;
 // Compact row-oriented lawns and a door-to-gate connection. No radial clearing
 // or independent dead-end lane; the gate meets an existing row-gap track.
 for(int i=0;i<20;i++){
   if(i>=uFarmCount)break;
   float facing=dot(dir,uFarmUp[i].xyz);
   if(facing<uFarmAlong[i].w)continue;
   vec2 c=vec2(dot(dir,uFarmAcross[i].xyz),dot(dir,uFarmAlong[i].xyz))*uRadius/(uFarmUp[i].w*facing);
   float plot=1.0-smoothstep(-0.05,0.16,max(abs(c.x)-5.8,abs(c.y)-6.4));
   ground=mix(ground,green*vec3(0.96,1.04,0.98),plot);
   pathMask*=1.0-plot;
   float apron=1.0-smoothstep(0.0,0.12,boxDistance(c-vec2(0.9,4.2),vec2(2.35,0.45))-0.15);
   float gate=uFarmAcross[i].w;
   float t=clamp((c.y-3.95)/4.05,0.0,1.0);
   float pathX=mix(0.9,gate,t*t*(3.0-2.0*t));
   float width=mix(0.45,0.25*uRadius/128.0/uFarmUp[i].w,t);
   float slope=(gate-0.9)*6.0*t*(1.0-t)/4.05;
   float distancePath=length(vec2((c.x-pathX)/sqrt(1.0+slope*slope),c.y-clamp(c.y,3.95,8.0)))-width;
   float walk=1.0-smoothstep(0.0,0.12,distancePath);
   pathMask=max(pathMask,max(walk,apron));
 }
 // One earth material after combining every path mask, so the home path and
 // the cultivated tracks cannot inherit two different underlying colours.
 ground=mix(ground,soil,pathMask);
 float light=0.76+0.24*max(dot(normalize(vNormal),uSunDir),0.0);
 vec3 col=ground*mix(vec3(0.88,0.90,1),vec3(1),light)*(0.97+textureMark*0.05);
 gl_FragColor=vec4(applyAerial(col,distanceEye,dir),1);
}
