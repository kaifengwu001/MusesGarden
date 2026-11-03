#include <meadow_common>
#include <meadow_noise>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_terrain>
#include <tulip_rows>
varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vNormal;
vec3 flowerColour(float k){
 if(k<0.5)return vec3(0.323,0.423,0.784);
 if(k<1.5)return vec3(0.93,0.815,0.72);
 if(k<2.5)return vec3(0.847,0.133,0.205);
 if(k<3.5)return vec3(0.913,0.347,0.477);
 if(k<4.5)return vec3(0.93,0.738,0.242);
 return vec3(1.0,0.521,0.133);
}
void main(){
 vec3 dir=normalize(vDir);
 TulipCell cell=tulipCell(tulipField(dir));
 float distanceEye=distance(cameraPosition,vWarped);
 // Row gaps between beds (none inside a double bed) and the soil track where a bed's run ends.
 float paths=max(cell.rowGap?smoothstep(0.925,0.955,cell.across):0.0,cell.runEnd?smoothstep(0.965,0.985,cell.along):0.0);
 float textureMark=gnoise(dir*uRadius*8.0,991u);
 vec3 green=mix(vec3(0.29,0.40,0.16),vec3(0.43,0.52,0.23),0.5+0.25*textureMark);
 vec3 flowers=flowerColour(cell.colour);
 vec3 ground=mix(green,flowers,0.18+0.72*smoothstep(18.0,70.0,distanceEye));
 // Resting fields, kept back from the home as the tulips are.
 if(cell.fallow&&dot(dir,uCottage.xyz)<cos(0.55))ground=green;
 vec3 soil=vec3(0.66,0.54,0.36);
 // Each farm's lawn is whole beds between two short tracks; its walk runs straight to the front one.
 vec2 farm=tulipFarmGround(dir);
 if(farm.x>0.5){ground=green*vec3(0.96,1.04,0.98);paths=0.0;}
 float pathMask=max(paths,farm.y);
 // One earth material after combining every path mask, so the home path and
 // the cultivated tracks cannot inherit two different underlying colours.
 ground=mix(ground,soil,pathMask);
 float light=0.76+0.24*max(dot(normalize(vNormal),uSunDir),0.0);
 vec3 col=ground*mix(vec3(0.88,0.90,1),vec3(1),light)*(0.97+textureMark*0.05);
 gl_FragColor=vec4(applyAerial(col,distanceEye,dir),1);
}
