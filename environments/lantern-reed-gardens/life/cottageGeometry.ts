import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

type UV = readonly [number, number];
export const point = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Independent hard-edged mesh builder for timber, cut stone and thick leaves. */
export class CottageGeometry {
  variation = 0.5;
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly kinds: number[] = [];
  private readonly variations: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly UV[] = [[0, 0], [1, 0], [0, 1]]): void {
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const [i, p] of [a, b, c].entries()) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(...uv[i]);
      this.kinds.push(kind);
      this.variations.push(this.variation);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, kind: number, width = 1, height = 1): void {
    this.triangle(a, b, c, kind, [[0, 0], [width, 0], [width, height]]);
    this.triangle(a, c, d, kind, [[0, 0], [width, height], [0, height]]);
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, kind: number): void {
    const x0 = x - width / 2, x1 = x + width / 2, y0 = y - height / 2, y1 = y + height / 2, z0 = z - depth / 2, z1 = z + depth / 2;
    this.quad(point(x0,y0,z1),point(x1,y0,z1),point(x1,y1,z1),point(x0,y1,z1),kind,width,height);
    this.quad(point(x1,y0,z0),point(x0,y0,z0),point(x0,y1,z0),point(x1,y1,z0),kind,width,height);
    this.quad(point(x0,y0,z0),point(x0,y0,z1),point(x0,y1,z1),point(x0,y1,z0),kind,depth,height);
    this.quad(point(x1,y0,z1),point(x1,y0,z0),point(x1,y1,z0),point(x1,y1,z1),kind,depth,height);
    this.quad(point(x0,y1,z1),point(x1,y1,z1),point(x1,y1,z0),point(x0,y1,z0),kind,width,depth);
    this.quad(point(x0,y0,z0),point(x1,y0,z0),point(x1,y0,z1),point(x0,y0,z1),kind,width,depth);
  }

  tube(path: Vector3[], radii: number[], kind: number, sides = 6): void {
    const rings = path.map((p, i) => {
      const direction = path[Math.min(i + 1, path.length - 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
      const x = direction.clone().cross(Math.abs(direction.z) < 0.9 ? point(0,0,1) : point(1,0,0)).normalize();
      const y = direction.clone().cross(x).normalize();
      return Array.from({ length: sides }, (_, k) => p.clone().addScaledVector(x, Math.cos(k / sides * Math.PI * 2) * radii[i]).addScaledVector(y, Math.sin(k / sides * Math.PI * 2) * radii[i]));
    });
    let length = 0;
    for (let i = 0; i < rings.length - 1; i++) {
      const end = length + path[i].distanceTo(path[i + 1]);
      for (let k = 0; k < sides; k++) {
        const j = (k + 1) % sides;
        this.triangle(rings[i][k],rings[i][j],rings[i+1][j],kind,[[k/sides,length],[j/sides,length],[j/sides,end]]);
        this.triangle(rings[i][k],rings[i+1][j],rings[i+1][k],kind,[[k/sides,length],[j/sides,end],[k/sides,end]]);
      }
      length = end;
    }
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      this.triangle(path[0],rings[0][j],rings[0][k],kind);
      this.triangle(path[path.length-1],rings[rings.length-1][k],rings[rings.length-1][j],kind);
    }
  }

  /** A chipped slab with a level upper face, so the existing walking surface remains exact. */
  stone(x0: number, x1: number, z0: number, z1: number, bottom: number, top: number, seed: number): void {
    const chip = Math.min(x1 - x0, z1 - z0) * 0.12;
    const xs = [x0+chip,x1-chip*0.6,x1,x1-chip*0.3,x1-chip,x0+chip*0.7,x0,x0+chip*0.3];
    const zs = [z0,z0,z0+chip,z1-chip,z1,z1,z1-chip*0.8,z0+chip];
    const center = point((x0+x1)/2,top,(z0+z1)/2);
    this.variation = seed;
    const rim = xs.map((x,i) => point(x,top,zs[i]));
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      this.triangle(center,rim[j],rim[i],2,[[center.x,center.z],[rim[j].x,rim[j].z],[rim[i].x,rim[i].z]]);
      const lowerA = point(xs[i]+(center.x-xs[i])*0.055,bottom,zs[i]+(center.z-zs[i])*0.055);
      const lowerB = point(xs[j]+(center.x-xs[j])*0.055,bottom,zs[j]+(center.z-zs[j])*0.055);
      this.quad(rim[i],rim[j],lowerB,lowerA,2,rim[i].distanceTo(rim[j]),top-bottom);
      this.tube([rim[i].clone().add(point(0,0.004,0)),rim[j].clone().add(point(0,0.004,0))],[0.008,0.008],11,4);
    }
  }

  /** A leaf has a top, a shaded underside, closed edge thickness and an inked perimeter. */
  leaf(surface: (across: number, along: number) => Vector3, variation: number, kind = 1, thickness = 0.055): void {
    this.variation = variation;
    const rows = 14, columns = 4;
    const sample = (u: number,t: number,lower: boolean): Vector3 => surface(u,t).add(point(0,lower ? -thickness : 0,0));
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const u0 = -1 + column / columns * 2, u1 = -1 + (column + 1) / columns * 2, t0 = row / rows, t1 = (row + 1) / rows;
      for (const lower of [false,true]) {
        const a = sample(u0,t0,lower), c = sample(u1,t0,lower), d = sample(u1,t1,lower), e = sample(u0,t1,lower);
        const uv: UV[] = [[(u0+1)/2,t0],[(u1+1)/2,t0],[(u1+1)/2,t1],[(u0+1)/2,t1]];
        this.triangle(a,c,d,lower ? 3 : kind,[uv[0],uv[1],uv[2]]);
        this.triangle(a,d,e,lower ? 3 : kind,[uv[0],uv[2],uv[3]]);
      }
    }
    for (const side of [-1,1]) {
      const edge = Array.from({length:rows+1},(_,i) => surface(side,i/rows));
      for (let i=0;i<rows;i++) this.quad(edge[i],edge[i+1],edge[i+1].clone().add(point(0,-thickness,0)),edge[i].clone().add(point(0,-thickness,0)),3);
      this.tube(edge,edge.map(() => 0.009),11,4);
    }
    const rib = Array.from({length:rows+1},(_,i) => surface(0,i/rows).add(point(0,0.012,0)));
    this.tube(rib,rib.map((_,i) => 0.015-i*0.0005),6,5);
  }

  build(): BufferGeometry {
    const result = new BufferGeometry();
    result.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    result.setAttribute('normal',new Float32BufferAttribute(this.normals,3));
    result.setAttribute('uv',new Float32BufferAttribute(this.uvs,2));
    result.setAttribute('aKind',new Float32BufferAttribute(this.kinds,1));
    result.setAttribute('aVariation',new Float32BufferAttribute(this.variations,1));
    result.computeBoundingSphere();
    return result;
  }
}
