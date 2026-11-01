// Small mineral relief changes diffuse lighting as well as colour. It is
// surface shading, not extra coincident geometry or a floating decal.
float cobaltRelief(vec3 p, float footprint) {
  return .055*gnoise(p*1.35,719u)
    + .014*gnoise(p*5.2,720u)*(1.0-smoothstep(.04,.16,footprint));
}
vec3 cobaltBumpNormal(vec3 n, vec3 dpdx, vec3 dpdy, vec2 dh) {
  vec3 r1=cross(dpdy,n),r2=cross(n,dpdx);
  float det=dot(dpdx,r1);
  if(abs(det)<1e-12)return n;
  vec3 gradient=sign(det)*(dh.x*r1+dh.y*r2);
  return normalize(abs(det)*n-gradient);
}
// Cobalt's matte mineral surfaces. Coordinates and footprints are in metres;
// derivative inputs are evaluated by the caller before material branching.
float mineralStroke(float distanceToLine, float width, float footprint) {
  return 1.0-smoothstep(width,width+max(footprint*0.85,0.001),distanceToLine);
}
float mineralSegment(vec2 p, vec2 a, vec2 b) {
  vec2 e=b-a;
  return length(p-a-e*clamp(dot(p-a,e)/max(dot(e,e),0.00001),0.0,1.0));
}
float cobaltJoint(vec2 p, float seed) {
  vec2 size=vec2(2.9,4.7),q=p+vec2(seed*11.3,seed*7.9);
  vec2 cell=floor(q/size),s=fract(q/size)*size;
  float a=hash12(cell+11.7),b=hash12(cell+vec2(7.3,1.8));
  vec2 p0=vec2(.35+.70*a,.10+.24*b);
  vec2 p1=vec2(.50+.65*b,1.06+.35*a);
  vec2 p2=vec2(.23+.90*a,2.15+.40*b);
  vec2 p3=vec2(.55+.55*b,3.48+.55*a);
  float d=min(mineralSegment(s,p0,p1),mineralSegment(s,p1,p2));
  d=min(d,mineralSegment(s,p2,p3));
  if(a>.31)d=min(d,mineralSegment(s,p1,p1+vec2(.52+.55*b,.17+.28*a)));
  if(b>.42)d=min(d,mineralSegment(s,p2,p2+vec2(-.40-.42*a,.32+.24*b)));
  return d;
}
vec3 cobaltMineral(vec3 p, vec3 faceNormal, float variation, float footprint, float ndl, float shadow) {
  vec3 n=abs(normalize(faceNormal));
  vec2 uv=n.y>max(n.x,n.z)?p.xz:(n.x>n.z?p.zy:p.xy);
  float macro=gnoise(p*.42+vec3(variation*17.0),710u);
  float flake=gnoise(p*vec3(2.8,4.8,2.8)+vec3(variation*7.0),711u);
  float fineFade=1.0-smoothstep(.045,.16,footprint);
  float detailFade=1.0-smoothstep(.16,.65,footprint);
  float stratum=gnoise(vec3(p.x*.68,p.y*3.4,p.z*.68),712u);
  float wear=smoothstep(-.15,.50,macro+.36*stratum);
  vec3 mid=mix(pal(ROW_ROCK,0),pal(ROW_ROCK,3),variation*.52);
  mid=mix(mid,pal(ROW_ROCK,2),wear*.28);
  // A continuous diffuse term keeps oblique faces distinct instead of
  // saturating every sunward face into the same toon band.
  float light=clamp(.27+.73*max(ndl,0.0),0.0,1.0)*(1.0-shadow*.3);
  vec3 col=tone3(mid*1.20,mid*.87,pal(ROW_ROCK,1)*.95,light);
  col*=1.0+(.30*macro+.065*flake*fineFade+.10*stratum*detailFade);
  uv.x+=gnoise(vec3(uv*.95,variation*3.0),714u)*.17;
  float joint=cobaltJoint(uv,variation);
  float fault=mineralStroke(joint,.009,footprint)*detailFade;
  float lip=mineralStroke(abs(joint-.025),.009,footprint)*detailFade;
  col=mix(col,pal(ROW_ROCK,1)*.52,fault*.56);
  col=mix(col,pal(ROW_ROCK,2),lip*.035);
  // Sparse mineral grains and chipped surfaces, smoothly removed below
  // pixel size rather than screen-space noise that flickers while moving.
  float grain=gnoise(p*22.0,713u);
  float grainFade=1.0-smoothstep(.009,.035,footprint);
  col*=1.0+grain*.07*grainFade;
  return col;
}
