import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** Small hard-edged rural forms; the cypress mesh uses an asymmetric smooth
 * profile rather than stacks of cones or spheres. */
class Builder {
  private p:number[]=[]; private n:number[]=[]; private uv:number[]=[]; private k:number[]=[];
  tri(a:Vector3,b:Vector3,c:Vector3,kind:number,normal?:readonly Vector3[]):void {
    const face=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for(const [i,v] of [a,b,c].entries()) {this.p.push(v.x,v.y,v.z);const n=normal?.[i]??face;this.n.push(n.x,n.y,n.z);this.uv.push(v.x,v.y);this.k.push(kind);}
  }
  quad(a:Vector3,b:Vector3,c:Vector3,d:Vector3,kind:number):void {this.tri(a,b,c,kind);this.tri(a,c,d,kind);}
  box(x:number,y:number,z:number,w:number,h:number,d:number,kind:number):void {
    const p=(u:number,v:number,q:number)=>new Vector3(x+u*w/2,y+v*h/2,z+q*d/2);
    this.quad(p(-1,-1,1),p(1,-1,1),p(1,1,1),p(-1,1,1),kind);
    this.quad(p(1,-1,-1),p(-1,-1,-1),p(-1,1,-1),p(1,1,-1),kind);
    this.quad(p(-1,-1,-1),p(-1,-1,1),p(-1,1,1),p(-1,1,-1),kind);
    this.quad(p(1,-1,1),p(1,-1,-1),p(1,1,-1),p(1,1,1),kind);
    this.quad(p(-1,1,1),p(1,1,1),p(1,1,-1),p(-1,1,-1),kind);
    this.quad(p(-1,-1,-1),p(1,-1,-1),p(1,-1,1),p(-1,-1,1),kind);
  }
  tube(points:Vector3[],radii:number[],kind:number,sides=5):void {
    const rings=points.map((p,i)=>{const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();const x=new Vector3().crossVectors(tangent,new Vector3(0,0,1)).normalize(),z=new Vector3().crossVectors(tangent,x);return Array.from({length:sides},(_,j)=>p.clone().addScaledVector(x,Math.cos(j/sides*Math.PI*2)*radii[i]).addScaledVector(z,Math.sin(j/sides*Math.PI*2)*radii[i]));});
    for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++)this.quad(rings[i][j],rings[i][(j+1)%sides],rings[i+1][(j+1)%sides],rings[i+1][j],kind);
  }
  build():BufferGeometry {const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(this.p,3));g.setAttribute('normal',new Float32BufferAttribute(this.n,3));g.setAttribute('uv',new Float32BufferAttribute(this.uv,2));g.setAttribute('aKind',new Float32BufferAttribute(this.k,1));g.computeBoundingSphere();return g;}
}

export function cypressGeometry():BufferGeometry {
  const b=new Builder();
  b.tube([new Vector3(0,-.3,0),new Vector3(.08,2.4,0),new Vector3(.18,5.3,.04)],[.17,.12,.055],0,7);
  const flame=(base:Vector3,height:number,width:number,curve:number,rings:number,sides:number,phase:number):void=>{
    const point=(t:number,a:number):Vector3=>{
      // Slender but full-bodied: a rounded lower crown, unequal swellings,
      // a curling narrow tip and vertical, offset finger-like ridges.
      const profile=Math.pow(Math.sin(Math.PI*Math.pow(t,.72)),.67)*Math.pow(1-t,.23);
      const swell=1+.11*Math.sin(t*19+phase)+.07*Math.sin(t*31+1.5);
      const ridge=1+.17*Math.sin(a*3+t*7+phase)+.065*Math.cos(a*7-t*5);
      const r=.012+width*profile*swell*ridge;
      const cx=curve*(.22*Math.sin(t*6.1)+t*t*.78);
      const cz=.17*Math.sin(t*4.2+phase)*Math.sin(t*Math.PI);
      return base.clone().add(new Vector3(cx+Math.cos(a)*r,t*height,cz+Math.sin(a)*r*.78));
    };
    const normal=(t:number,a:number):Vector3=>point(Math.min(1,t+.001),a).sub(point(Math.max(0,t-.001),a)).cross(point(t,a+.001).sub(point(t,a-.001))).normalize();
    for(let r=0;r<rings-1;r++)for(let side=0;side<sides;side++){
      const t0=r/(rings-1),t1=(r+1)/(rings-1),a0=side/sides*Math.PI*2,a1=(side+1)/sides*Math.PI*2;
      const a=point(t0,a0),q=point(t0,a1),c=point(t1,a1),d=point(t1,a0);
      b.tri(a,q,c,1,[normal(t0,a0),normal(t0,a1),normal(t1,a1)]);
      b.tri(a,c,d,1,[normal(t0,a0),normal(t1,a1),normal(t1,a0)]);
    }
  };
  flame(new Vector3(0,.5,0),11.7,1.12,.7,20,13,.4);
  // A secondary flame grows into one shoulder, breaking the single-cone
  // silhouette while keeping an upright, tapered cypress anatomy.
  flame(new Vector3(-.28,2.5,.04),5.7,.46,-.82,10,9,1.9);
  return b.build();
}

export function farmGeometry():BufferGeometry {
  const b=new Builder(),p=(x:number,y:number,z:number)=>new Vector3(x,y,z);
  b.box(0,1.35,0,5.4,3.1,3.7,2);
  // Two real sloped roof faces, closed gable ends, quiet square openings.
  b.quad(p(-3,2.85,2.15),p(3,2.85,2.15),p(3,4.4,0),p(-3,4.4,0),3);
  b.quad(p(3,2.85,-2.15),p(-3,2.85,-2.15),p(-3,4.4,0),p(3,4.4,0),3);
  b.tri(p(-2.7,2.8,-1.85),p(-2.7,2.8,1.85),p(-2.7,4.24,0),2);
  b.tri(p(2.7,2.8,1.85),p(2.7,2.8,-1.85),p(2.7,4.24,0),2);
  b.box(-.85,.82,1.87,.75,1.75,.07,0);
  b.box(1.1,1.75,1.87,.65,.7,.075,6);
  b.box(1.8,3.2,-.5,.52,2.5,.6,2);
  b.box(1.8,4.49,-.5,.66,.18,.74,3);
  return b.build();
}

export function harvestSheafGeometry():BufferGeometry {
  const b=new Builder();
  for(let i=0;i<25;i++){
    const a=i*2.3999632297,r=.22+.11*Math.sin(i*1.9),s=Math.sin(a),c=Math.cos(a),height=1.65+.24*Math.sin(i*1.7);
    b.tube([new Vector3(c*r,-.13,s*r),new Vector3(c*.12,.68,s*.12),new Vector3(c*.38,height,s*.38)],[.022,.017,.012],4,3);
    b.tube([new Vector3(c*.38,height-.16,s*.38),new Vector3(c*.43,height+.11,s*.43)],[.065,.025],4,4);
  }
  // Rope binds the narrower waist of the grain bundle.
  for(let i=0;i<16;i++){const a=i*Math.PI/8,next=(i+1)*Math.PI/8;b.tube([new Vector3(Math.cos(a)*.19,.68,Math.sin(a)*.19),new Vector3(Math.cos(next)*.19,.68,Math.sin(next)*.19)],[.022,.022],0,3);}
  return b.build();
}
