// Small mineral relief changes diffuse lighting as well as colour. It is
// surface shading, not extra coincident geometry or a floating decal.
float cobaltRelief(vec3 p, float footprint) {
  float coarseFade=1.0-smoothstep(.16,.48,footprint);
  if(coarseFade<=0.0)return 0.0;
  float relief=.055*gnoise(p*1.35,719u);
  if(footprint<.16)relief+=.014*gnoise(p*5.2,720u)*(1.0-smoothstep(.04,.16,footprint));
  return relief*coarseFade;
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
float mineralSegmentSquared(vec2 p, vec2 a, vec2 b) {
  vec2 e=b-a;
  vec2 d=p-a-e*clamp(dot(p-a,e)/max(dot(e,e),0.00001),0.0,1.0);
  return dot(d,d);
}
// A rock has a dominant fracture habit, but its individual faults do not
// repeat a fixed glyph. Return distance, physical width and ink strength.
// Neighbouring cells contribute complete paths, including those that cross
// a cell boundary. Cells are only a search structure, not clipping boxes.
vec3 cobaltJoint(vec2 p, float seed, float footprint) {
  float rock=hash12(vec2(seed*197.3+3.1,41.7));
  float habit=floor(rock*5.0);
  float angle=(hash12(vec2(seed*91.7,7.3))-.5)*1.15;
  if(habit>0.5&&habit<1.5)angle+=1.5707963;
  float cs=cos(angle),sn=sin(angle);
  vec2 q=mat2(cs,sn,-sn,cs)*p+vec2(seed*29.7,seed*43.1);
  float spacing=mix(3.0,6.8,hash12(vec2(seed*107.3,21.2)));
  vec2 size=vec2(spacing,spacing*mix(.92,1.45,rock));
  vec2 here=floor(q/size);
  float density=habit<.5?.66:(habit<1.5?.58:(habit<2.5?.70:(habit<3.5?.57:.23)));
  float maxLength=.76*min(size.x,size.y);
  if(habit>1.5&&habit<2.5)maxLength*=.83;
  if(habit>3.5)maxLength*=.88;
  // Include the line's antialias footprint in bounds, so skipping work never
  // cuts a softened endpoint off as the camera recedes.
  float padding=.08+footprint*1.5;
  float reach=maxLength*1.3+padding;
  vec3 nearest=vec3(100000000.0,.009,0.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
    vec2 cell=here+vec2(float(x),float(y));
    vec2 toCentres=max(abs(q-(cell+.5)*size)-size*.28,vec2(0.0));
    if(dot(toCentres,toCentres)>reach*reach)continue;
    vec2 salt=cell+vec2(seed*53.7,seed*19.3);
    float a=hash12(salt+3.17);
    if(a>density)continue;
    float b=hash12(salt+vec2(17.6,4.1));
    float c=hash12(salt+vec2(5.2,29.8)),d=hash12(salt+vec2(37.1,11.3));
    vec2 centre=(cell+vec2(.22+.56*b,.22+.56*c))*size;
    vec2 v=q-centre;
    float length=mix(.28,.76,d)*min(size.x,size.y);
    if(habit>1.5&&habit<2.5)length*=.38+.45*c;
    if(habit>3.5)length*=.48+.40*b;
    float pathReach=length*1.3+padding;
    if(dot(v,v)>pathReach*pathReach)continue;
    // Most marks share the stone's stress direction; a few are cross-joints.
    float turn=(d-.5)*(.28+.65*b);
    if(c>.84&&habit!=1.0)turn+=mix(.65,1.3,b);
    float ct=cos(turn),st=sin(turn);
    v=mat2(ct,st,-st,ct)*v;
    // This bound contains the trunk and its widest possible branch.
    if(abs(v.x)>length+padding||abs(v.y)>length*1.15+padding)continue;
    float bend=length*(.07+.16*b);
    vec2 p0=vec2((c-.5)*bend,-length);
    vec2 p1=vec2((b-.5)*bend,-length*(.18+.20*d));
    vec2 p2=vec2((d-.5)*bend,length*(.15+.33*b));
    vec2 p3=vec2((a/density-.5)*bend,length);
    float distanceToFault=min(mineralSegmentSquared(v,p0,p1),mineralSegmentSquared(v,p1,p2));
    distanceToFault=min(distanceToFault,mineralSegmentSquared(v,p2,p3));
    // Branched faces have unequal side fractures; bedding and hairline
    // faces keep largely unbranched seams, including completely quiet cells.
    bool branched=habit<.5&&b>.54||habit>2.5&&habit<3.5;
    if(branched) {
      float side=c>.5?1.0:-1.0;
      vec2 f0=mix(p1,p2,.18+.64*c);
      vec2 f1=f0+vec2(side*length*(.18+.20*d),length*(.05+.16*b));
      vec2 f2=f1+vec2(side*length*(.07+.18*c),length*(.12+.22*d));
      distanceToFault=min(distanceToFault,mineralSegmentSquared(v,f0,f1));
      distanceToFault=min(distanceToFault,mineralSegmentSquared(v,f1,f2));
      if(habit>2.5&&d>.58) {
        vec2 f3=p2+vec2(-side*length*(.23+.22*b),length*(.08+.20*c));
        distanceToFault=min(distanceToFault,mineralSegmentSquared(v,p2,f3));
      }
    }
    float width=mix(.004,.016,b)*mix(.38,1.0,clamp(1.0-abs(v.y)/length,0.0,1.0));
    if(habit>1.5&&habit<2.5)width*=.6;
    float strength=mix(.38,.83,c)*(habit>3.5?.55:1.0);
    if(distanceToFault<nearest.x)nearest=vec3(distanceToFault,width,strength);
  }
  return vec3(sqrt(nearest.x),nearest.yz);
}
vec3 cobaltMineral(vec3 p, vec3 faceNormal, float variation, float footprint, float ndl, float shadow) {
  vec3 n=abs(normalize(faceNormal));
  vec2 uv=n.y>max(n.x,n.z)?p.xz:(n.x>n.z?p.zy:p.xy);
  float macro=gnoise(p*.42+vec3(variation*17.0),710u);
  float fineFade=1.0-smoothstep(.045,.16,footprint);
  float detailFade=1.0-smoothstep(.16,.65,footprint);
  float flake=fineFade>0.0?gnoise(p*vec3(2.8,4.8,2.8)+vec3(variation*7.0),711u):0.0;
  float stratum=gnoise(vec3(p.x*.68,p.y*3.4,p.z*.68),712u);
  float wear=smoothstep(-.15,.50,macro+.36*stratum);
  vec3 mid=mix(pal(ROW_ROCK,0),pal(ROW_ROCK,3),variation*.52);
  mid=mix(mid,pal(ROW_ROCK,2),wear*.28);
  // A continuous diffuse term keeps oblique faces distinct instead of
  // saturating every sunward face into the same toon band.
  float light=clamp(.27+.73*max(ndl,0.0),0.0,1.0)*(1.0-shadow*.3);
  vec3 col=tone3(mid*1.20,mid*.87,pal(ROW_ROCK,1)*.95,light);
  col*=1.0+(.30*macro+.065*flake*fineFade+.10*stratum*detailFade);
  if(detailFade>0.0) {
    uv.x+=gnoise(vec3(uv*.95,variation*3.0),714u)*.17;
    vec3 joint=cobaltJoint(uv,variation,footprint);
    float fault=mineralStroke(joint.x,joint.y,footprint)*detailFade*joint.z;
    float lip=mineralStroke(abs(joint.x-joint.y*2.4),joint.y*.7,footprint)*detailFade*joint.z;
    col=mix(col,pal(ROW_ROCK,1)*.52,fault*.78);
    col=mix(col,pal(ROW_ROCK,2),lip*.035);
  }
  // Sparse mineral grains and chipped surfaces, smoothly removed below
  // pixel size rather than screen-space noise that flickers while moving.
  float grainFade=1.0-smoothstep(.009,.035,footprint);
  if(grainFade>0.0)col*=1.0+gnoise(p*22.0,713u)*.07*grainFade;
  return col;
}
