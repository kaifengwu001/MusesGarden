#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uTulipTime;
uniform float uTulipBloom;
uniform float uTulipWind;
#include <meadow_terrain>
#ifdef DENSE_FIELD
#include <tulip_rows>
attribute vec2 aCell;
uniform vec4 uDenseGrid;
uniform vec3 uDenseColours[6];
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
 TulipCell cell=tulipCell(tulipField(U));
 float scale=(0.9+0.28*random)*uDenseGrid.w;
 // True paths, resting fields and farm lawns stay open at every view and planet size.
 if(abs(latitude)>MEADOW_PI*0.5||abs(aCell.x)>=rings*0.5||(cell.rowGap&&cell.across>0.925)||(cell.runEnd&&cell.along>0.965))scale=0.0;
 if(cell.fallow&&dot(U,uCottage.xyz)<cos(0.55))scale=0.0;
 vec2 farm=tulipFarmGround(U);
 if(farm.x>0.0||farm.y>0.0)scale=0.0;
 scale*=1.0-smoothstep(102.0,112.0,max(abs(aCell.x),abs(aCell.y-111.5)));
 if(scale<=0.001){gl_Position=vec4(2,2,2,1);return;}
 float yaw=random*2.0*MEADOW_PI;
 vec3 tint=uDenseColours[int(cell.colour)];
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
