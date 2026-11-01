import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** Small non-indexed mesh builder. Hard faces remain hard; foliage is genuinely thin geometry. */
export class CanyonGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private kinds: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1]]): void {
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const [i, p] of [a, b, c].entries()) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.uvs.push(uv[i][0], uv[i][1]);
      this.kinds.push(kind);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, kind: number, width = 1, height = 1): void {
    this.triangle(a, b, c, kind, [[0, 0], [width, 0], [width, height]]);
    this.triangle(a, c, d, kind, [[0, 0], [width, height], [0, height]]);
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, kind: number): void {
    const x0 = x - width / 2, x1 = x + width / 2;
    const y0 = y - height / 2, y1 = y + height / 2;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    const p = (a: number, b: number, c: number): Vector3 => new Vector3(a, b, c);
    this.quad(p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1),p(x0,y1,z1),kind,width,height);
    this.quad(p(x1,y0,z0),p(x0,y0,z0),p(x0,y1,z0),p(x1,y1,z0),kind,width,height);
    this.quad(p(x0,y0,z0),p(x0,y0,z1),p(x0,y1,z1),p(x0,y1,z0),kind,depth,height);
    this.quad(p(x1,y0,z1),p(x1,y0,z0),p(x1,y1,z0),p(x1,y1,z1),kind,depth,height);
    this.quad(p(x0,y1,z1),p(x1,y1,z1),p(x1,y1,z0),p(x0,y1,z0),kind,width,depth);
    this.quad(p(x0,y0,z0),p(x1,y0,z0),p(x1,y0,z1),p(x0,y0,z1),kind,width,depth);
  }

  tube(points: Vector3[], radii: number[], kind: number, sides = 7): void {
    const rings = points.map((p, i) => {
      const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const across = new Vector3().crossVectors(tangent, Math.abs(tangent.z) < 0.9 ? new Vector3(0,0,1) : new Vector3(1,0,0)).normalize();
      const other = new Vector3().crossVectors(tangent, across).normalize();
      return Array.from({length:sides}, (_, k) => p.clone().addScaledVector(across, Math.cos(k/sides*Math.PI*2)*radii[i]).addScaledVector(other, Math.sin(k/sides*Math.PI*2)*radii[i]));
    });
    let length = 0;
    for (let i=0;i+1<rings.length;i++) {
      const segment = points[i].distanceTo(points[i+1]);
      for (let k=0;k<sides;k++) {
        const next=(k+1)%sides;
        this.triangle(rings[i][k],rings[i][next],rings[i+1][next],kind,[[k/sides,length],[(k+1)/sides,length],[(k+1)/sides,length+segment]]);
        this.triangle(rings[i][k],rings[i+1][next],rings[i+1][k],kind,[[k/sides,length],[(k+1)/sides,length+segment],[k/sides,length+segment]]);
      }
      length+=segment;
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    geometry.setAttribute('normal',new Float32BufferAttribute(this.normals,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(this.uvs,2));
    geometry.setAttribute('aKind',new Float32BufferAttribute(this.kinds,1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** A broad thin blade opens into a tilted canopy, with small lobes only at its rim. */
export function addFanLeaf(b: CanyonGeometry, origin: Vector3, length: number, turn: number, kind = 1, spread = 1.43, tilt = 0.88): void {
  const columns=24, rows=6;
  const point=(u:number,v:number):Vector3=>{
    const a=(u*2-1)*spread;
    const edge=1-0.025*Math.cos(u*Math.PI*16);
    const r=v*length*edge;
    const x=Math.sin(a)*r;
    const y=Math.cos(a)*r;
    const z=0.2*r*Math.sin(Math.PI*v)-0.1*length*v*v;
    const pitchedY=y*Math.cos(tilt)-z*Math.sin(tilt);
    const pitchedZ=y*Math.sin(tilt)+z*Math.cos(tilt);
    return origin.clone().add(new Vector3(x*Math.cos(turn)+pitchedZ*Math.sin(turn),pitchedY,pitchedZ*Math.cos(turn)-x*Math.sin(turn)));
  };
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const u0=x/columns,u1=(x+1)/columns,v0=y/rows,v1=(y+1)/rows;
    const a=point(u0,v0),c=point(u1,v1);
    if(y>0)b.triangle(a,point(u1,v0),c,kind,[[u0,v0],[u1,v0],[u1,v1]]);
    b.triangle(a,c,point(u0,v1),kind,[[u0,v0],[u1,v1],[u0,v1]]);
  }
}

export function fanTreeGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  const main=Array.from({length:11},(_,i)=>{
    const t=i/10;return new Vector3(2.0*t*t-0.18*Math.sin(t*Math.PI),5.8*t,0.38*Math.sin(t*1.6));
  });
  b.tube(main,main.map((_,i)=>0.37*Math.pow(1-i/11,1.1)+0.035),0,9);
  addFanLeaf(b,main[10],3.3,0);
  // Supporting branches enter the same crown, leaving room beneath the sail.
  b.tube([main[6],new Vector3(1.15,4.95,0.35),new Vector3(1.55,5.98,0.62)],[0.16,0.1,0.028],0,7);
  b.tube([main[7],new Vector3(2.1,5.1,0.55),new Vector3(2.4,5.96,0.67)],[0.12,0.075,0.02],0,7);
  return b.build();
}

/** A chipped, tilted chalk block built from flat fracture faces, not a rounded primitive. */
export function chalkGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  const lower=[[-1.27,-0.16,-0.6],[-0.9,-0.13,-0.83],[0.61,-0.1,-0.76],[1.22,-0.12,-0.18],[1.04,-0.16,0.4],[0.4,-0.14,0.83],[-0.74,-0.18,0.72],[-1.3,-0.16,0.2]].map(p=>new Vector3(...p as [number,number,number]));
  const shoulder=[[-1.2,0.47,-0.55],[-0.73,0.82,-0.76],[0.62,0.76,-0.64],[1.02,0.45,-0.17],[0.91,0.47,0.36],[0.36,0.6,0.7],[-0.72,0.73,0.6],[-1.15,0.44,0.15]].map(p=>new Vector3(...p as [number,number,number]));
  const upper=[[-0.93,0.7,-0.43],[-0.72,0.91,-0.63],[0.52,0.86,-0.55],[0.79,0.7,-0.12],[0.74,0.65,0.28],[0.29,0.75,0.52],[-0.62,0.85,0.52],[-0.96,0.67,0.12]].map(p=>new Vector3(...p as [number,number,number]));
  const top=new Vector3(-0.08,0.88,-0.04);
  for(let i=0;i<8;i++){
    const n=(i+1)%8;
    b.quad(lower[n],lower[i],shoulder[i],shoulder[n],2,1.8,0.8);
    b.quad(shoulder[n],shoulder[i],upper[i],upper[n],2,1.8,0.28);
    b.triangle(upper[n],upper[i],top,2,[[0,0],[1.4,0],[0.7,0.8]]);
  }
  return b.build();
}

export function fernGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  for(let f=0;f<5;f++){
    const a=f*Math.PI*2/5;
    const axis=new Vector3(Math.sin(a)*0.6,0,Math.cos(a)*0.6);
    const side=new Vector3(Math.cos(a),0,-Math.sin(a));
    const height=0.8+(f%2)*0.22;
    const spine=[new Vector3(),axis.clone().multiplyScalar(0.4).setY(height*0.6),axis.clone().setY(height)];
    b.tube(spine,[0.02,0.014,0.004],3,4);
    for(let k=1;k<=7;k++){
      const t=k/8;
      const mid=axis.clone().multiplyScalar(t*t).setY(height*t);
      const width=0.2*Math.sin(t*Math.PI)*Math.sqrt(1-t)*1.6;
      for(const sign of [-1,1]){
        const tip=mid.clone().addScaledVector(side,width*sign).addScaledVector(axis,0.08).setY(mid.y+0.09);
        const neck=mid.clone().addScaledVector(axis,0.07).setY(mid.y-0.035);
        const upper=mid.clone().addScaledVector(axis,0.045).setY(mid.y+0.055);
        b.triangle(mid,tip,upper,3,[[0,0],[0.5,1],[1,0]]);
        b.triangle(mid,neck,tip,3,[[0,0],[1,0],[0.5,1]]);
      }
    }
  }
  return b.build();
}

export const CHALK_SHELF_CENTRE_HEIGHT = 3.22;

/** A connected, stepped escarpment: broad beds with broken vertical joint faces. */
export function chalkShelfGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  const sections = [
    {x:-4.2,width:2.6,depth:2.7,height:1.55,z:0.2},
    {x:-2.2,width:2.9,depth:3.2,height:2.5,z:-0.1},
    {x:0,width:3.0,depth:3.8,height:3.2,z:0},
    {x:2.15,width:2.5,depth:3.3,height:2.35,z:0.2},
    {x:3.9,width:2.2,depth:2.5,height:1.4,z:0.35},
  ];
  for (const [index, section] of sections.entries()) {
    const {x,width,depth,height,z} = section;
    const footprint = [[-0.5,-0.34],[-0.3,-0.5],[0.34,-0.48],[0.5,-0.24],[0.46,0.34],[0.19,0.5],[-0.38,0.46],[-0.53,0.14]];
    const bottom = footprint.map(([dx,dz]) => new Vector3(x+dx*width,-0.3,z+dz*depth));
    const top = footprint.map(([dx,dz],i) => new Vector3(x+dx*width*0.93,height+(i%3-1)*0.08,z+dz*depth*0.94));
    const centre = new Vector3(x,index===2?CHALK_SHELF_CENTRE_HEIGHT:height+0.02,z);
    for(let i=0;i<footprint.length;i++){
      const j=(i+1)%footprint.length;
      b.quad(bottom[j],bottom[i],top[i],top[j],2,width*0.55,height);
      b.triangle(top[j],top[i],centre,2,[[0,0],[width*0.55,0],[width*0.28,depth*0.3]]);
    }
    // A fallen thin bedding plate at the foot breaks up the long wall.
    if(index%2===0)b.box(x+0.25,0.15,z+depth*0.54,width*0.65,0.45,0.7,2);
  }
  return b.build();
}

/** A low mat of flat sage lichen lobes, with exposed gaps rather than a rounded bush. */
export function lichenGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  for(let lobe=0;lobe<17;lobe++){
    const angle=lobe*2.3999632297;
    const radius=Math.sqrt(lobe/17)*0.95;
    const centre=new Vector3(Math.cos(angle)*radius,0.05+(lobe%4)*0.026,Math.sin(angle)*radius);
    const width=0.24+(lobe%3)*0.06;
    const ring=Array.from({length:7},(_,i)=>{
      const a=i*Math.PI*2/7;
      return centre.clone().add(new Vector3(Math.cos(a)*width,0.02+0.04*Math.sin(a*2+lobe),Math.sin(a)*width*0.75));
    });
    for(let i=0;i<7;i++)b.triangle(centre,ring[i],ring[(i+1)%7],8,[[0.5,0.5],[0,0],[1,0]]);
  }
  return b.build();
}
