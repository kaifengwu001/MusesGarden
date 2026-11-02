#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
uniform float uWildOutline;
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec2 vUv;
varying float vKind;
varying float vPresence;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
void main(){
 // Presence is based on projected displayed span. Foreground wildlife remains
 // solid; only genuinely tiny silhouettes dissolve into the landscape.
 float stipple=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(0.06711056,0.00583715))));
 if(vPresence<=stipple)discard;
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet),base;
 if(vKind<0.5)base=linearColor(vec3(0.22,0.38,0.63));
 else if(vKind<1.5)base=linearColor(vec3(0.93,0.61,0.47));
 else if(vKind<2.5)base=linearColor(vec3(0.98,0.94,0.79));
 else if(vKind<3.5)base=linearColor(vec3(0.94,0.56,0.45));
 else if(vKind<4.5)base=linearColor(vec3(0.07,0.10,0.14));
 else if(vKind<5.5)base=linearColor(vec3(0.46,0.32,0.23));
 else if(vKind<6.5)base=linearColor(vec3(0.73,0.56,0.35));
 else base=linearColor(vec3(0.72,0.23,0.16));
 float light=toonLight(dot(n,localSun(dir)))*(1.0-cloudShadowAt(vPlanet,0.0)*0.22);
 if(vKind>1.5&&vKind<3.5)light=max(light,0.52);
 vec3 col=tone3(base*1.06,base*0.94,base*vec3(0.58,0.64,0.78),light);
 if(uWildOutline>0.5)col=linearColor(vec3(0.16,0.20,0.28));
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
