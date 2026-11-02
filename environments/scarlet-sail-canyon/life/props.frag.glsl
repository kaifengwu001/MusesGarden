#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width,float footprint){float w=max(footprint,0.001);return (1.0-smoothstep(width,width+w*1.2,abs(value)))*min(1.0,width/max(w*0.65,0.001));}
void main(){
 // Sample derivatives once, before all material/visibility decisions. Fine
 // strokes use analytic coordinate footprints, including across UV wrapping.
 vec2 uvPixel=fwidth(vUv);
 vec3 localPixel=fwidth(vLocal);
 vec3 localNormal=normalize(cross(dFdx(vLocal),dFdy(vLocal)));
 float uvFootprint=max(uvPixel.x,uvPixel.y);
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet);
 vec3 sun=localSun(dir);
 float cloud=cloudShadowAt(vPlanet,0.0)*0.5;
 float light=toonLight(dot(n,sun))*(1.0-cloud*0.45);
 // The open shelter still shades its rear working bay. This local wash
 // follows the supported furniture/wall volume and leaves the canopy lit.
 float interior=(1.0-smoothstep(-0.7,2.0,vLocal.z))*(1.0-smoothstep(3.7,4.3,abs(vLocal.x)));
 if(vKind<3.5||(vKind>4.5&&vKind<6.5)||vKind>7.5)light*=1.0-0.28*interior;
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  float wear=gnoise(vLocal*vec3(0.8,0.32,0.8),351u);
  base=mix(linearColor(vec3(0.46,0.39,0.32)),linearColor(vec3(0.65,0.56,0.43)),0.55+wear*0.28);
  float grain=sin(vUv.x*43.0+gnoise(vec3(vUv.x*3.0,vUv.y*0.5,1.0),120u)*2.3);
  mark=inkLine(grain,0.024,uvPixel.x*49.0+uvPixel.y*1.2)*0.18*smoothstep(-0.3,0.2,gnoise(vec3(vUv.x*2.0,vUv.y*2.1,3.0),120u));
  base*=0.97+0.045*sin(vUv.x*24.0+vUv.y*0.23);
 }else if(vKind<1.5){
  base=mix(linearColor(vec3(0.81,0.27,0.27)),linearColor(vec3(0.91,0.38,0.32)),vVariation*0.55);
  float veins=fract(vUv.x*12.0+0.5)-0.5;
  mark=inkLine(veins,0.004,uvPixel.x*12.0)*smoothstep(0.08,0.3,vUv.y)*0.22;
  mark+=inkLine(vUv.y-0.985,0.006,uvPixel.y)*0.2;
  light=max(light,0.32+0.18*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
  // Dust coats the ledge's walking top, while cooler broken faces expose
  // the mineral beneath. There is no bright continuous white fascia.
  float cap=smoothstep(0.42,0.88,abs(dot(n,dir)));
  float wash=gnoise(vLocal*vec3(0.71,1.4,0.63),391u);
  base=mix(linearColor(vec3(0.59,0.65,0.66)),linearColor(vec3(0.79,0.77,0.68)),cap);
  base*=0.96+0.065*wash;
  float foot=(1.0-smoothstep(0.02,0.40,vLocal.y))*(0.35+0.25*smoothstep(-0.2,0.35,wash));
  base=mix(base,linearColor(vec3(0.52,0.55,0.40)),foot);
  vec3 axis=abs(localNormal);
  vec2 plane=cap>0.5?vLocal.xz:(axis.x>axis.z?vLocal.zy:vLocal.xy);
  vec2 planePixel=cap>0.5?localPixel.xz:(axis.x>axis.z?localPixel.zy:localPixel.xy);
  float trace=plane.x+0.046*sin(plane.y*4.2)+0.025*sin(plane.y*10.1);
  float column=floor(trace/0.83);
  float selected=step(0.33,fract(sin(column*7.13+0.9)*62.7));
  float joint=fract(trace/0.83+0.5)-0.5;
  mark=inkLine(joint,0.009,(planePixel.x+planePixel.y*0.46)/0.83)*selected*mix(0.29,0.16,cap);
  float split=vLocal.y-(0.28+0.055*sin(plane.x*1.8));
  mark+=inkLine(split,0.009,localPixel.y+planePixel.x*0.10)*(1.0-cap)*0.17;
  float grain=gnoise(vLocal*19.0,482u)*(1.0-smoothstep(0.025,0.10,length(localPixel)));
  base*=0.99+0.035*grain;
 }else if(vKind<3.5){
  base=linearColor(vec3(0.94,0.91,0.76));
  mark=inkLine(vUv.x-0.5,0.012,uvPixel.x)*0.2;
  light=max(light,0.35);
 }else if(vKind<4.5){
  // Faded, repaired canvas: seams, interrupted stitching and the dark
  // doubled hem are pigment on one sheet, never coplanar patch quads.
  float panel=floor(vUv.x/1.62);
  float panelTone=fract(sin(panel*2.71+1.7)*31.73);
  base=mix(linearColor(vec3(0.66,0.24,0.22)),linearColor(vec3(0.84,0.35,0.29)),0.45+panelTone*0.35);
  float seam=fract(vUv.x/1.62+0.5)-0.5;
  float stitch=(1.0-smoothstep(0.16,0.30,abs(fract(vUv.y*17.0)-0.5)))*(1.0-smoothstep(0.25,0.8,uvPixel.y*17.0));
  mark=inkLine(seam,0.003,uvPixel.x/1.62)*0.22+inkLine(abs(seam)-0.016,0.002,uvPixel.x/1.62)*stitch*0.24;
  float hem=min(min(vUv.x,9.6962736-vUv.x),min(vUv.y,6.799984-vUv.y));
  mark+=inkLine(hem-0.065,0.006,uvFootprint)*0.27+inkLine(hem-0.022,0.005,uvFootprint)*0.19;
  float repairMask=step(0.28,vUv.x)*step(vUv.x,1.18)*step(4.58,vUv.y)*step(vUv.y,5.21);
  base=mix(base,linearColor(vec3(0.65,0.30,0.25)),repairMask*0.5);
  float weave=sin(vUv.x*185.0)*sin(vUv.y*195.0);
  float footprint=uvFootprint;
  base*=0.96+0.055*gnoise(vec3(vUv*1.8,1.0),416u)+0.025*weave*(1.0-smoothstep(0.003,0.018,footprint));
  // The cloth's broad crease follows its suspension direction.
  base*=0.96+0.04*sin(vUv.x*5.2+sin(vUv.y*0.8));
 }else if(vKind<5.5){
  float panel=floor((vLocal.x+3.97)/0.88);
  float tone=fract(sin(panel*7.13+1.2)*62.7);
  base=mix(linearColor(vec3(0.48,0.37,0.29)),linearColor(vec3(0.69,0.55,0.42)),0.24+0.61*tone);
  float seam=fract((vLocal.x+3.97)/0.88+0.5)-0.5;
  mark=inkLine(seam,0.007,localPixel.x/0.88)*0.28;
  float weaveA=fract(vUv.x*27.0)-0.5,weaveB=fract(vUv.y*29.0)-0.5;
  float weaveFade=1.0-smoothstep(0.008,0.04,uvFootprint);
  mark+=(inkLine(weaveA,0.018,uvPixel.x*27.0)*0.075+inkLine(weaveB,0.018,uvPixel.y*29.0)*0.05)*weaveFade;
  base*=0.95+0.065*gnoise(vLocal*2.1,782u)+0.025*sin(vLocal.x*14.0);
 }else if(vKind<6.5){
  base=linearColor(vec3(0.26,0.29,0.28));
 }else if(vKind<7.5){
  base=linearColor(vec3(0.96,0.79,0.45));light=max(light,0.75);
 }else if(vKind<8.5){
  base=mix(linearColor(vec3(0.38,0.47,0.35)),linearColor(vec3(0.56,0.61,0.41)),vVariation);
  mark=inkLine(vUv.x-0.5,0.006,uvPixel.x)*0.08;
 }else if(vKind<9.5){
  // Main-bay planks are one physical floor surface. Seams and grain are
  // material variation on that surface, never coplanar overlay geometry.
  float row=floor((vLocal.z+2.63)/0.48);
  float variation=fract(sin(row*4.231+2.1)*431.21);
  base=mix(linearColor(vec3(0.39,0.33,0.27)),linearColor(vec3(0.62,0.53,0.42)),0.3+0.5*variation);
  float seam=fract((vLocal.z+2.63)/0.48+0.5)-0.5;
  float end=fract((vLocal.x+mod(row,3.0)*0.93)/2.8+0.5)-0.5;
  mark=inkLine(seam,0.009,localPixel.z/0.48)*0.32+inkLine(end,0.002,localPixel.x/2.8)*0.23;
  float grain=sin(vLocal.z*121.0+gnoise(vec3(vLocal.x*0.45,vLocal.z*4.0,2.0),138u)*2.0);
  mark+=inkLine(grain,0.018,localPixel.z*129.0+localPixel.x)*0.12;
  base*=0.97+0.05*gnoise(vec3(vLocal.x*0.8,vLocal.z*3.0,1.0),782u);
 }else if(vKind<11.5){
  bool earthen=vKind<10.5;
  base=earthen?linearColor(vec3(0.65,0.39,0.28)):linearColor(vec3(0.39,0.52,0.44));
  float mineral=gnoise(vLocal*11.0,716u);
  base*=0.94+0.075*mineral;
  mark=inkLine(fract(vUv.y*11.0+0.5)-0.5,0.005,uvPixel.y*11.0)*0.07;
 }else if(vKind<12.5){
  base=linearColor(vec3(0.82,0.76,0.58));
  mark=inkLine(fract(vUv.y*24.0)-0.5,0.013,uvPixel.y*24.0)*0.11;
  base*=0.97+0.04*gnoise(vLocal*8.0,814u);
 }else{
  base=linearColor(vec3(0.43,0.36,0.24));
  mark=inkLine(fract(vUv.x*6.0+vUv.y*22.0)-0.5,0.02,uvPixel.x*6.0+uvPixel.y*22.0)*0.18;
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.02,0.1,abs(dot(warpNormal(vPlanet,n),view))))*0.16;
 base*=1.0-min(mark+silhouette,0.5);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.59,0.67,0.8),light);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
