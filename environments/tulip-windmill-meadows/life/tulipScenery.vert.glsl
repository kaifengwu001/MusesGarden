#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uTulipTime;
uniform float uTulipBloom;
uniform float uTulipWind;
#include <meadow_terrain>
#ifdef DENSE_FIELD
attribute vec2 aCell;
uniform vec4 uDenseGrid;
uniform vec3 uDenseColours[6];
uniform int uFarmCount;
uniform vec4 uFarmUp[20];
uniform vec4 uFarmAcross[20];
uniform vec4 uFarmAlong[20];
#else
attribute vec4 aPlant;
attribute vec4 aTint;
#endif
attribute float aKind;
varying vec3 vColour;
varying vec3 vPlanet;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vKind;
void main(){
#ifdef DENSE_FIELD
 float row=uDenseGrid.x+aCell.y;
 float latitude=(row+0.5)*uDenseGrid.z/uRadius;
 float rings=max(1.0,floor(2.0*MEADOW_PI*uRadius*max(0.001,cos(latitude))/uDenseGrid.z));
 float column=mod(floor((uDenseGrid.y+MEADOW_PI)/(2.0*MEADOW_PI)*rings)+aCell.x,rings);
 float identity=mod(float(uTerrainSeed),8191.0);
 float random=hash12(vec2(column,row)+identity);
 float jitter=hash12(vec2(row,column)+identity+21.0)-0.5;
 latitude+=(random-0.5)*0.18*uDenseGrid.z/uRadius;
 float longitude=(column+0.5+jitter*0.18)/rings*(2.0*MEADOW_PI)-MEADOW_PI;
 vec3 right=normalize(cross(uCottage.xyz,uCottageB.xyz));
 vec3 U=normalize(uCottage.xyz*cos(latitude)*cos(longitude)+right*cos(latitude)*sin(longitude)+uCottageB.xyz*sin(latitude));
 float x=longitude*128.0,z=latitude*128.0;
 float field=(x+z*0.18+3.0*sin(z/27.0)+24.0)/9.0;
 float band=mod(floor(field)+floor((z+26.0)/52.0),6.0);
 float scale=(0.9+0.28*random)*uDenseGrid.w;
 // True paths and cottage plots stay open at every view and planet size.
 if(abs(latitude)>MEADOW_PI*0.5||abs(aCell.x)>=rings*0.5||fract(field)>0.925||fract((z+26.0)/52.0)>0.965)scale=0.0;
 float parcel=mod(floor((x+32.0)/64.0)*7.0+floor((z+26.0)/52.0)*3.0,11.0);
 if(parcel<2.0&&dot(U,uCottage.xyz)<cos(0.55))scale=0.0;
 for(int i=0;i<20;i++){
   if(i>=uFarmCount)break;
   float facing=dot(U,uFarmUp[i].xyz);if(facing<uFarmAlong[i].w)continue;
   vec2 c=vec2(dot(U,uFarmAcross[i].xyz),dot(U,uFarmAlong[i].xyz))*uRadius/(uFarmUp[i].w*facing);
   float t=clamp((c.y-3.95)/4.05,0.0,1.0),gate=uFarmAcross[i].w;
   float pathX=mix(0.9,gate,t*t*(3.0-2.0*t)),width=mix(0.45,0.25*uRadius/128.0/uFarmUp[i].w,t);
   float slope=(gate-0.9)*6.0*t*(1.0-t)/4.05;
   float distancePath=length(vec2((c.x-pathX)/sqrt(1.0+slope*slope),c.y-clamp(c.y,3.95,8.0)));
   if((abs(c.x)<6.0&&abs(c.y)<6.6)||distancePath<width+0.22)scale=0.0;
 }
 scale*=1.0-smoothstep(102.0,112.0,max(abs(aCell.x),abs(aCell.y-111.5)));
 if(scale<=0.001){gl_Position=vec4(2,2,2,1);return;}
 float yaw=random*2.0*MEADOW_PI;
 vec3 tint=uDenseColours[int(band)];
#else
 vec3 U=normalize(aPlant.xyz);
 float scale=aPlant.w,yaw=aTint.w;
 vec3 tint=aTint.rgb;
#endif
 vec3 X=normalize(cross(U,abs(U.y)<0.9?vec3(0,1,0):vec3(1,0,0)));
 vec3 Z=cross(X,U);
 vec3 p=position*scale;
#ifdef DENSE_FIELD
 p.xz*=1.12;
#endif
 if(aKind>0.5)p.xz*=0.4+0.6*uTulipBloom;
 p.x+=sin(uTulipTime*1.3+yaw+position.y*1.2)*0.12*uTulipWind*position.y*position.y;
 vec2 h=mat2(cos(yaw),sin(yaw),-sin(yaw),cos(yaw))*p.xz;
 float distanceLocal=length(h);
 vec3 T=distanceLocal>0.00001?normalize(X*h.x+Z*h.y):X;
 float angle=asin(min(distanceLocal/uRadius,0.9));
 vec3 up=U*cos(angle)+T*sin(angle);
 vec3 planet=up*(uRadius+height0(up)+uBank.x+p.y-0.015);
 vec3 n=normalize(X*normal.x+U*normal.y+Z*normal.z);
 vColour=aKind<0.5?vec3(0.19,0.36,0.16):tint*(aKind>1.5?1.08:0.96);
 if(aKind>0.5)vColour=mix(vec3(0.36,0.49,0.2),vColour,0.2+0.8*uTulipBloom);
 vPlanet=planet;vNormal=n;vWorld=warpPosition(planet);vKind=aKind;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}
