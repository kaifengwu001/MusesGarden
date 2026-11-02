// Dry sequoia woodland. Terrain.sample in terrain.ts is the CPU mirror.
// Engine uniform names remain compatible; pond fields are inert metadata.
uniform uint uTerrainSeed;
uniform samplerCube uTerrainBake;
uniform samplerCube uFloraBake;
uniform vec4 uBank;
uniform vec4 uCottage;
uniform vec4 uCottageB;
uniform vec4 uHomePond;
uniform vec4 uHomeShape;
uniform vec4 uHomePhase;
uniform vec4 uHomeIslet;
uniform vec4 uCottageSun;
#define FOREST_SITES 6
#define ROUTE_SEGMENTS 14
uniform vec4 uForestSites[FOREST_SITES];
uniform vec4 uForestFronts[FOREST_SITES];
uniform vec3 uRouteA[ROUTE_SEGMENTS];
uniform vec3 uRouteB[ROUTE_SEGMENTS];

struct Ground {float height;float height0;float water;float depth;float clearing;float slope;vec4 fields;};
float chordAngle(vec3 a,vec3 b){return 2.0*asin(clamp(0.5*length(a-b),0.0,1.0));}
vec2 cottageLocal(vec3 dir){vec3 off=dir-uCottage.xyz;return vec2(dot(off,cross(uCottage.xyz,uCottageB.xyz)),dot(off,uCottageB.xyz))*uRadius;}
// A branching trail graph crosses both polar flanks and the far hemisphere.
// Every edge ends at another trail node or at a real shrine/home approach.
float routeSpurBend(int i){
  if(i==0)return 1.1;if(i==1)return 13.0;if(i==2)return 3.0;if(i==3)return -2.6;
  if(i==4)return 3.4;if(i==5)return -3.1;if(i==6)return -4.5;if(i==7)return 9.0;
  if(i==8)return -7.0;if(i==9)return 13.0;if(i==10)return -11.0;if(i==11)return 8.0;
  if(i==12)return -10.0;return 7.0;
}
float routeArcDistance(vec3 dir,vec3 a,vec3 b,int i){
  vec3 n=normalize(cross(a,b)),tangent=cross(n,a);
  float span=acos(clamp(dot(a,b),-1.0,1.0));
  float angle=atan(dot(dir,tangent),dot(dir,a));
  if(angle<0.0||angle>span)return acos(clamp(max(dot(a,dir),dot(b,dir)),-1.0,1.0))*uRadius;
  float t=angle/span,pi=3.141592653589793;
  float base=routeSpurBend(i),bend=sign(base)*min(abs(base),span*uRadius*0.12);
  float wiggle=sign(base)*min(0.6,span*uRadius*0.025);
  float offset=bend*(sin(pi*t)+0.35*sin(2.0*pi*t))+wiggle*sin(5.0*pi*t);
  float slope=(bend*(pi*cos(pi*t)+0.7*pi*cos(2.0*pi*t))+wiggle*5.0*pi*cos(5.0*pi*t))/(span*uRadius);
  float cross_=asin(clamp(dot(dir,n),-1.0,1.0))*uRadius;
  return abs(cross_-offset)/sqrt(1.0+slope*slope);
}
float routePathAt(vec3 dir){
  vec3 across=normalize(cross(uCottage.xyz,uCottageB.xyz));
  float grain=(dot(dir,across)*0.13+dot(dir,uCottageB.xyz)*0.17+dot(dir,uCottage.xyz)*0.11)*uRadius;
  float width=1.15+0.12*sin(grain)+0.07*sin(grain*2.13);
  float path=0.0;
  for(int i=0;i<ROUTE_SEGMENTS;i++){
    float half_=i==0?1.85:width;
    path=max(path,1.0-smoothstep(half_,half_+0.5,routeArcDistance(dir,uRouteA[i],uRouteB[i],i)));
  }
  return path;
}
vec2 forestSiteLocal(vec3 dir,int i){
  return vec2(dot(dir,cross(uForestSites[i].xyz,uForestFronts[i].xyz)),dot(dir,uForestFronts[i].xyz))*uRadius;
}
float routePadAt(vec3 dir){
  float weight=0.0;
  for(int i=0;i<FOREST_SITES;i++){
    if(dot(dir,uForestSites[i].xyz)<0.5)continue;
    vec2 c=forestSiteLocal(dir,i);float s=uForestSites[i].w;
    bool home=uForestFronts[i].w>0.5;
    float hx=home?7.6:7.2*s,hz=home?8.6:11.0*s,cz=home?1.0:2.0*s;
    weight=max(weight,(1.0-smoothstep(hx,hx+4.0,abs(c.x)))*(1.0-smoothstep(hz,hz+5.0,abs(c.y-cz))));
  }
  return weight;
}
float routeCourtAt(vec3 dir){
  float weight=0.0;
  for(int i=0;i<FOREST_SITES;i++){
    if(dot(dir,uForestSites[i].xyz)<0.5)continue;
    vec2 c=forestSiteLocal(dir,i);float s=uForestSites[i].w;
    bool home=uForestFronts[i].w>0.5;
    float hx=home?6.6:6.4*s,hz=home?7.6:9.0*s,cz=home?1.0:2.0*s;
    weight=max(weight,(1.0-smoothstep(hx,hx+1.0,abs(c.x)))*(1.0-smoothstep(hz,hz+1.5,abs(c.y-cz))));
  }
  return weight;
}
float homePond(vec3 dir){return 1000.0;}
float homestead(vec3 dir,float natural){
  float h=1.8+max(0.0,natural+1.0)*0.42;
  return mix(h,uCottage.w,routePadAt(dir));
}
// The dry-height mapping applies on all chunks, even the fast far-ground pass.
float homeGround(vec3 dir,float h){return homestead(dir,h);}
float height0(vec3 dir){return homestead(dir,textureLod(uTerrainBake,dir,0.0).r);}
float banked(float h,float shore){return h+uBank.x;}
float bankedAt(float h,float shore,float dist){return h+uBank.x;}
float clearingAt(vec3 dir,float dc){return max(routeCourtAt(dir),routePathAt(dir));}
void gradientFrame(vec3 dir,out vec3 a,out vec3 b){a=normalize(cross(dir,abs(dir.y)<0.95?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0)));b=cross(dir,a);}
Ground sampleGround(vec3 dir){
  Ground g;g.fields=textureLod(uTerrainBake,dir,0.0);g.height0=homestead(dir,g.fields.r);
  vec3 a,b;gradientFrame(dir,a,b);float e=uBank.z/uRadius;
  float h1=height0(normalize(dir+a*e)),h2=height0(normalize(dir+b*e));
  g.slope=length(vec2(h1-g.height0,h2-g.height0))/uBank.z;
  g.height=g.height0+uBank.x;g.water=1000.0;g.depth=0.0;
  g.clearing=clearingAt(dir,chordAngle(dir,uCottage.xyz)*uRadius);return g;
}
float boxDistance(vec2 p,vec2 halfSize){vec2 d=abs(p)-halfSize;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
// Soft local shadow from the shrine's compact gabled mass, without an old pond/deck shadow.
float cottageShadow(vec3 dir){
  if(chordAngle(dir,uCottage.xyz)*uRadius>45.0)return 0.0;
  vec2 c=cottageLocal(dir);float best=1e3;
  for(int k=0;k<=12;k++){
    float h=float(k)*0.58;
    float roof=clamp((h-3.8)/3.2,0.0,1.0);
    vec2 half_=h<3.8?vec2(3.7,3.1):mix(vec2(5.1,4.2),vec2(0.1,3.3),roof);
    best=min(best,boxDistance(c+uCottageSun.xy*h,half_));
  }
  return smoothstep(0.5,-0.25,best);
}
