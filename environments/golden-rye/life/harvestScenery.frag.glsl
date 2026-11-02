#include <meadow_common>
#include <meadow_toon>
#include <meadow_sun>
#include <meadow_fog>
varying vec3 vPlanet;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vKind;
varying float vTint;
vec3 harvestLinear(vec3 c){return pow(c,vec3(2.2));}
void main(){
 vec3 up=normalize(vPlanet),n=normalize(vNormal);
 float light=toonLight(dot(n,localSun(up)));
 float footprint=length(fwidth(vLocal));
 float fine=1.0-smoothstep(.014,.09,footprint);
 // Flowing vertical paint grooves follow wood, foliage and bundled straw.
 float strokes=sin(vLocal.x*27.0+sin(vLocal.y*2.4+vLocal.z*9.0)*1.5+vLocal.z*12.0);
 float coarse=hash13(floor(vLocal*vec3(2.3,5.5,2.7)));
 vec3 base;
 vec3 shadow=vec3(.55,.57,.44);
 if(vKind<.5){base=harvestLinear(vec3(.28,.25,.13));}
 else if(vKind<1.5){
  float broadBrush=sin(vLocal.x*5.0+sin(vLocal.y*.85+vLocal.z*1.8)*.6+vLocal.z*4.4);
  float brushDetail=1.0-smoothstep(.14,.45,footprint);
  float crownLight=smoothstep(-.3,.75,dot(n,localSun(up)));
  base=mix(harvestLinear(vec3(.10,.19,.12)),harvestLinear(vec3(.30,.38,.16)),.25+vTint*.25+(.5+.5*broadBrush)*.30*brushDetail);
  base*=1.0+strokes*.08*fine+broadBrush*.13*brushDetail;
  light=.12+.80*crownLight;
  shadow=vec3(.32,.42,.47);
 }else if(vKind<2.5){
  base=mix(harvestLinear(vec3(.88,.72,.39)),harvestLinear(vec3(.96,.86,.61)),.45+coarse*.3);
  base*=1.0+sin(vLocal.y*14.0+vLocal.x*1.9)*.025*fine;
  shadow=vec3(.58,.61,.71);
 }else if(vKind<3.5){
  base=mix(harvestLinear(vec3(.57,.22,.11)),harvestLinear(vec3(.79,.35,.16)),vTint*.5+.25);
  float course=sin(vLocal.y*22.0+vLocal.z*3.0);
  base*=1.0+course*.07*fine;
  shadow=vec3(.52,.53,.63);
 }else if(vKind<4.5){
  base=mix(harvestLinear(vec3(.67,.43,.12)),harvestLinear(vec3(.94,.73,.28)),vTint*.4+.45);
  base*=1.0+strokes*.12*fine;
  shadow=vec3(.62,.56,.35);
 }else if(vKind<5.5){base=harvestLinear(vec3(.50,.47,.31));}
 else{base=harvestLinear(vec3(.16,.23,.21));}
 vec3 color=tone3(base*1.09,base,base*shadow,.27+.73*light);
 gl_FragColor=vec4(applyAerial(color,distance(cameraPosition,vWorld),up),1.0);
}
