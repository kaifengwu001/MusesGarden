import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** Non-indexed botanical templates; only the final render batches are welded. */
class Builder {
  p:number[]=[]; n:number[]=[]; uv:number[]=[]; kind:number[]=[];
  tri(a:Vector3,b:Vector3,c:Vector3,kind:number, normals?:Vector3[]):void {
    const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for(const [i,v] of [a,b,c].entries()){
      this.p.push(v.x,v.y,v.z);const n=normals?.[i]??normal;this.n.push(n.x,n.y,n.z);
      this.uv.push(v.x,v.y);this.kind.push(kind);
    }
  }
  tube(points:Vector3[],radii:number[],kind:number,sides=7):void {
    const rings=points.map((p,i)=>{
      const along=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();
      const x=new Vector3().crossVectors(along,Math.abs(along.z)<0.9?new Vector3(0,0,1):new Vector3(1,0,0)).normalize();
      const z=new Vector3().crossVectors(along,x).normalize();
      return Array.from({length:sides},(_,j)=>p.clone().addScaledVector(x,Math.cos(j/sides*Math.PI*2)*radii[i]).addScaledVector(z,Math.sin(j/sides*Math.PI*2)*radii[i]));
    });
    for(let i=0;i<points.length-1;i++)for(let j=0;j<sides;j++){
      const k=(j+1)%sides;
      const normal=(ring:number,side:number):Vector3=>rings[ring][side].clone().sub(points[ring]).normalize();
      this.tri(rings[i][j],rings[i][k],rings[i+1][k],kind,[normal(i,j),normal(i,k),normal(i+1,k)]);
      this.tri(rings[i][j],rings[i+1][k],rings[i+1][j],kind,[normal(i,j),normal(i+1,k),normal(i+1,j)]);
    }
  }
  /** A broad, irregular, vertically compressed needle bough; never a sphere. */
  foliage(at:Vector3,width:number,depth:number,height:number,turn:number,phase:number,kind=1):void {
    const segments=kind===1?14:kind===2?16:9;
    const ring=(level:number):Vector3[]=>Array.from({length:segments},(_,i)=>{
      const a=i/segments*Math.PI*2;
      const r=(1+0.18*Math.sin(a*3+phase)+0.14*Math.sin(a*7+phase*2)+0.055*Math.cos(a*11-phase))*(level===0?0.73:1);
      const x=Math.cos(a)*width*r,z=Math.sin(a)*depth*r;
      return new Vector3(at.x+x*Math.cos(turn)-z*Math.sin(turn),at.y+(level===0?-height*0.47:height*0.10)+Math.sin(a*4+phase)*height*0.19,at.z+x*Math.sin(turn)+z*Math.cos(turn));
    });
    const lower=ring(0),rim=ring(1),top=at.clone().add(new Vector3(-width*0.09,height,depth*0.07));
    const bottom=at.clone().add(new Vector3(0,-height*0.52,0));
    for(let i=0;i<segments;i++){
      const j=(i+1)%segments;
      this.tri(top,rim[j],rim[i],kind);
      this.tri(rim[i],rim[j],lower[j],kind);
      this.tri(rim[i],lower[j],lower[i],kind);
      this.tri(bottom,lower[i],lower[j],kind);
    }
  }
  build():BufferGeometry {
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(this.p,3));g.setAttribute('normal',new Float32BufferAttribute(this.n,3));g.setAttribute('uv',new Float32BufferAttribute(this.uv,2));g.setAttribute('aKind',new Float32BufferAttribute(this.kind,1));g.computeBoundingSphere();return g;
  }
}

/** Mature trees have clear columnar trunks and huge high boughs; saplings
 * branch lower and keep a slimmer taper rather than shrinking one mesh. */
export function sequoiaGeometry(variant=0):BufferGeometry {
  const b=new Builder(),height=variant===0?43:variant===1?29:15;
  const radius=variant===0?1.65:variant===1?1.05:0.43;
  const sides=16,rings=11;
  const trunk:Vector3[][]=[];
  for(let ring=0;ring<rings;ring++){
    const t=ring/(rings-1),y=t*height;
    const base=radius*(Math.pow(1-t,0.64)*0.87+0.045)+(ring===0?radius*0.66:ring===1?radius*0.13:0);
    trunk.push(Array.from({length:sides},(_,i)=>{
      const a=i/sides*Math.PI*2;
      const flute=1+0.09*Math.cos(a*7+0.4)+0.035*Math.sin(a*11+t*2);
      return new Vector3(Math.cos(a)*base*flute+Math.sin(t*2.4+variant)*t*t*0.5,y,Math.sin(a)*base*flute+t*t*0.35);
    }));
  }
  for(let i=0;i<rings-1;i++)for(let j=0;j<sides;j++){
    const k=(j+1)%sides;
    const n=(r:number,s:number):Vector3=>new Vector3(trunk[r][s].x,0.02,trunk[r][s].z).normalize();
    b.tri(trunk[i][j],trunk[i][k],trunk[i+1][k],0,[n(i,j),n(i,k),n(i+1,k)]);
    b.tri(trunk[i][j],trunk[i+1][k],trunk[i+1][j],0,[n(i,j),n(i+1,k),n(i+1,j)]);
  }
  // Flared woody roots merge into the trunk and taper beneath the soil.
  for(let i=0;i<9;i++){
    const a=i*2.39996323+variant*0.4,d=radius*(1.6+0.6*Math.sin(i*1.4)**2);
    const dir=new Vector3(Math.cos(a),0,Math.sin(a));
    b.tube([dir.clone().multiplyScalar(radius*0.48).setY(radius*1.6),dir.clone().multiplyScalar(radius*1.25).setY(0.25),dir.clone().multiplyScalar(d).setY(-0.45)],[radius*0.28,radius*0.23,0.04],0,4);
  }
  const tiers=variant===0?11:variant===1?10:8;
  const start=variant===0?0.37:variant===1?0.27:0.16;
  for(let tier=0;tier<tiers;tier++){
    const t=tier/(tiers-1),y=height*(start+(0.96-start)*t);
    const branches=tier===tiers-1?2:3+(tier%3===0?1:0);
    for(let j=0;j<branches;j++){
      const a=tier*1.47+j/branches*Math.PI*2+variant*0.4;
      const spread=(variant===0?8.1:variant===1?6.2:3.7)*(0.55+0.45*Math.sin((0.1+t*0.8)*Math.PI))*(1-t*0.65)*(0.87+0.22*Math.sin(tier*4+j*3));
      const dir=new Vector3(Math.cos(a),0,Math.sin(a));
      const stagger=Math.sin(j*2.3+tier*1.9)*height*0.017;
      const root=dir.clone().multiplyScalar(radius*(1-t)*0.6).setY(y+stagger);
      const elbow=dir.clone().multiplyScalar(spread*0.5).setY(y+stagger+0.12*spread);
      const end=dir.clone().multiplyScalar(spread).setY(y+stagger+0.17*spread);
      b.tube([root,elbow,end],[radius*0.12*(1-t*0.5),radius*0.07,0.035],0,5);
      const phase=tier*1.9+j*2.7;
      // The living sprays begin near the stem and overlap neighbouring
      // tiers. This gives a connected, deep crown rather than a ladder of
      // small isolated plates balanced on the tips of bare sticks.
      b.foliage(elbow.clone().addScaledVector(dir,-spread*0.05),spread*0.72,spread*0.58,0.8+spread*0.25,a,phase);
      if((tier+j)%3===0)b.foliage(end.clone().addScaledVector(dir,-spread*0.06),spread*0.34,spread*0.31,0.45+spread*0.16,a+0.7,phase+2);
    }
  }
  const g=b.build();g.userData.species='sequoia';g.userData.habit=variant;g.userData.height=height;return g;
}

/** Distant canopy keeps the full tree's column, rooted base and layered crown.
 * A continuous scalloped volume avoids isolated plates at orbital distances. */
export function sequoiaCanopyGeometry(variant=0):BufferGeometry {
  const b=new Builder(),height=variant===0?43:variant===1?29:15;
  const radius=variant===0?1.65:variant===1?1.05:0.43;
  const start=variant===0?0.37:variant===1?0.27:0.16;
  const width=(variant===0?9.4:variant===1?7.2:4.2)*0.83;
  const trunkLevels=[0,0.08,0.4,0.7,1];
  const trunkPoints=trunkLevels.map(t=>new Vector3(Math.sin(t*2.4+variant)*t*t*0.5,t*height-(t===1?radius*0.05:0),t*t*0.35));
  b.tube(trunkPoints,[1.45,0.85,0.62,0.35,0.04].map(r=>r*radius),0,7);
  for(let root=0;root<6;root++){
    const angle=root*2.39996323+variant*0.4;
    const dir=new Vector3(Math.cos(angle),0,Math.sin(angle)),side=new Vector3(-dir.z,0,dir.x);
    const a=dir.clone().multiplyScalar(radius*0.52).addScaledVector(side,radius*0.25).setY(radius*0.5);
    const c=dir.clone().multiplyScalar(radius*0.52).addScaledVector(side,-radius*0.25).setY(radius*0.5);
    const top=dir.clone().multiplyScalar(radius*0.95).setY(radius*1.65);
    const toe=dir.clone().multiplyScalar(radius*2.05).setY(-0.4);
    b.tri(a,c,top,0);b.tri(a,top,toe,0);b.tri(top,c,toe,0);b.tri(c,a,toe,0);
  }
  const levels=[0,0.14,0.24,0.39,0.52,0.67,0.80,0.93];
  const reaches=[0.60,1,0.75,0.92,0.59,0.68,0.34,0.25];
  const sides=10;
  const rings=levels.map((t,ring)=>Array.from({length:sides},(_,side)=>{
    const angle=side/sides*Math.PI*2+variant*0.39;
    const scallop=1+0.13*Math.sin(angle*3+ring*0.48)+0.09*Math.cos(angle*5+variant+ring*0.31);
    const reach=width*reaches[ring]*scallop;
    const y=height*(start+(1-start)*t)+height*0.008*Math.sin(angle*3+ring*0.7);
    return new Vector3(Math.cos(angle)*reach+Math.sin(t*3+variant)*0.45,y,Math.sin(angle)*reach*0.88+Math.cos(t*4+variant)*0.35);
  }));
  for(let ring=0;ring<rings.length-1;ring++)for(let side=0;side<sides;side++){
    const next=(side+1)%sides;
    b.tri(rings[ring][side],rings[ring+1][next],rings[ring][next],1);
    b.tri(rings[ring][side],rings[ring+1][side],rings[ring+1][next],1);
  }
  const top=trunkPoints[trunkPoints.length-1].clone().setY(height),bottom=new Vector3(0,height*(start-0.025),0);
  for(let side=0;side<sides;side++){
    const next=(side+1)%sides;
    b.tri(top,rings[rings.length-1][next],rings[rings.length-1][side],1);
    b.tri(bottom,rings[0][side],rings[0][next],1);
  }
  const g=b.build();
  g.userData.species='sequoia';g.userData.habit=variant;g.userData.height=height;g.userData.detail='canopy';
  return g;
}

/** One low fern-and-moss assembly used in broken colonies beside tree roots. */
export function groveFloorGeometry():BufferGeometry {
  const b=new Builder();
  b.foliage(new Vector3(-0.4,0.025,0.1),0.78,0.59,0.085,0.3,0.4,2);
  b.foliage(new Vector3(0.48,-0.015,-0.12),0.63,0.45,0.075,-0.5,1.8,2);
  b.foliage(new Vector3(-0.08,-0.02,0.58),0.48,0.34,0.06,0.9,4.3,2);
  for(let frond=0;frond<6;frond++){
    const angle=frond*2.39996323,dir=new Vector3(Math.cos(angle),0,Math.sin(angle));
    const height=0.53+0.12*(frond%3),reach=0.35+0.09*(frond%2);
    const rib=(t:number):Vector3=>dir.clone().multiplyScalar(reach*t*t).setY(0.12+height*Math.sin(t*1.35));
    b.tube([rib(0),rib(0.4),rib(0.7),rib(1)],[0.012,0.009,0.006,0.002],3,3);
    const side=new Vector3(-dir.z,0,dir.x);
    for(let pair=0;pair<7;pair++)for(const sign of [-1,1]){
      const t=0.16+pair*0.112,root=rib(t),length=0.17*Math.sin((t+0.13)*Math.PI);
      const tip=root.clone().addScaledVector(side,sign*length).addScaledVector(dir,length*0.35).add(new Vector3(0,0.06,0));
      const mid=root.clone().lerp(tip,0.45),width=0.027*(1-t*0.5);
      b.tri(root,mid.clone().addScaledVector(dir,width),tip,3);
      b.tri(root,tip,mid.clone().addScaledVector(dir,-width),3);
    }
  }
  // Fractured low stone, mostly mossed; no spherical boulder silhouette.
  b.foliage(new Vector3(-0.62,-0.08,-0.42),0.56,0.39,0.34,0.5,2.5,4);
  return b.build();
}
