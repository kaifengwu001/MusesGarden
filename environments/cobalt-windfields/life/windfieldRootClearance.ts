import type { BufferGeometry, Vector3 } from 'three';

interface RockGeometry {
  /** Unique local xyz positions and support-foot weights. */
  vertices: Float64Array;
  indices: Uint32Array;
  x0: number; x1: number; y1: number; z0: number; z1: number;
  minimumGround: number; maximumGround: number;
}
interface RockVolume {
  geometry: RockGeometry;
  upX: number; upY: number; upZ: number;
  xX: number; xY: number; xZ: number;
  zX: number; zY: number; zZ: number;
  minimumCosine: number; outerRadius: number;
  x0: number; x1: number; z0: number; z1: number;
  anchorHeight: number; scale: number; footDepth: number;
  /** Built only if a query survives the projected footprint checks. */
  triangles?: Float64Array;
}

// Rock positions are immutable; changing instance transforms or growing the
// planet can reuse this topology without retaining disposed geometry objects.
const geometryCache=new WeakMap<BufferGeometry,RockGeometry>();
function rockGeometry(geometry: BufferGeometry): RockGeometry {
  const cached=geometryCache.get(geometry);if(cached)return cached;
  const positions=geometry.getAttribute('position'),ground=geometry.getAttribute('aGround'),index=geometry.index;
  const lookup=new Map<string,number>(),coordinates:number[]=[],vertexIndices=new Uint32Array(positions.count);
  let x0=Infinity,x1=-Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity,minimumGround=Infinity,maximumGround=-Infinity;
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),weight=ground?.getX(i)??0;
    const key=`${x},${y},${z},${weight}`;
    let vertex=lookup.get(key);
    if(vertex===undefined) {
      vertex=coordinates.length/4;lookup.set(key,vertex);coordinates.push(x,y,z,weight);
      x0=Math.min(x0,x);x1=Math.max(x1,x);y1=Math.max(y1,y);z0=Math.min(z0,z);z1=Math.max(z1,z);
      minimumGround=Math.min(minimumGround,weight);maximumGround=Math.max(maximumGround,weight);
    }
    vertexIndices[i]=vertex;
  }
  const indices=Uint32Array.from({length:index?.count??positions.count},(_,i)=>vertexIndices[index?.getX(i)??i]);
  const result={vertices:new Float64Array(coordinates),indices,x0,x1,y1,z0,z1,minimumGround,maximumGround};
  geometryCache.set(geometry,result);return result;
}

/** Excludes roots covered by any active rock, including neighbouring formations.
 * Coordinates follow the scenery vertex shader before the presentation warp. */
export class WindfieldRootClearance {
  private readonly cells=new Map<string,RockVolume[]>();
  private readonly cellSize=16;

  constructor(private readonly radius: number) {}

  add(geometry: BufferGeometry, dir: Vector3, across: Vector3, anchorHeight: number, scale: number, footDepth: number): void {
    if(scale<=0)return;
    const data=rockGeometry(geometry);if(!data.indices.length)return;
    const upLength=Math.sqrt(dir.x*dir.x+dir.y*dir.y+dir.z*dir.z),acrossLength=Math.sqrt(across.x*across.x+across.y*across.y+across.z*across.z);
    const ux=dir.x/upLength,uy=dir.y/upLength,uz=dir.z/upLength;
    const xx=across.x/acrossLength,xy=across.y/acrossLength,xz=across.z/acrossLength;
    let zx=xy*uz-xz*uy,zy=xz*ux-xx*uz,zz=xx*uy-xy*ux;
    const forwardLength=Math.sqrt(zx*zx+zy*zy+zz*zz);zx/=forwardLength;zy/=forwardLength;zz/=forwardLength;
    const extentX=Math.max(Math.abs(data.x0),Math.abs(data.x1))*scale,extentZ=Math.max(Math.abs(data.z0),Math.abs(data.z1))*scale;
    const sine=Math.min(Math.sqrt(extentX*extentX+extentZ*extentZ)/this.radius,.9),cosine=Math.sqrt(1-sine*sine);
    const projectedScale=scale/cosine;
    const rock:RockVolume={geometry:data,upX:ux,upY:uy,upZ:uz,xX:xx,xY:xy,xZ:xz,zX:zx,zY:zy,zZ:zz,
      minimumCosine:cosine-1e-8,outerRadius:this.radius+anchorHeight+data.y1*scale+Math.max(0,-data.minimumGround*footDepth,-data.maximumGround*footDepth),
      // Including zero also covers the shader's contraction beyond asin(.9).
      x0:Math.min(0,data.x0)*projectedScale-1e-5,x1:Math.max(0,data.x1)*projectedScale+1e-5,
      z0:Math.min(0,data.z0)*projectedScale-1e-5,z1:Math.max(0,data.z1)*projectedScale+1e-5,
      anchorHeight,scale,footDepth};
    const chord=this.radius*Math.sqrt(2*(1-cosine))+1e-5,cx=this.radius*ux,cy=this.radius*uy,cz=this.radius*uz;
    for(let z=Math.floor((cz-chord)/this.cellSize);z<=Math.floor((cz+chord)/this.cellSize);z++)
      for(let y=Math.floor((cy-chord)/this.cellSize);y<=Math.floor((cy+chord)/this.cellSize);y++)
        for(let x=Math.floor((cx-chord)/this.cellSize);x<=Math.floor((cx+chord)/this.cellSize);x++) {
          const key=`${x},${y},${z}`,bucket=this.cells.get(key);
          if(bucket)bucket.push(rock);else this.cells.set(key,[rock]);
        }
  }

  private worldTriangles(rock: RockVolume): Float64Array {
    if(rock.triangles)return rock.triangles;
    const local=rock.geometry.vertices,indices=rock.geometry.indices;
    const vertices=new Float64Array(local.length/4*3),triangles=new Float64Array(indices.length*3);
    for(let i=0;i<local.length;i+=4) {
      const x=local[i]*rock.scale,y=local[i+1]*rock.scale-local[i+3]*rock.footDepth,z=local[i+2]*rock.scale;
      const distance=Math.sqrt(x*x+z*z),q=Math.min(distance/this.radius,.9),cosine=Math.sqrt(1-q*q),sine=distance>1e-5?q/distance:0;
      const r=this.radius+rock.anchorHeight+y,v=i/4*3;
      vertices[v]=(rock.upX*cosine+(rock.xX*x+rock.zX*z)*sine)*r;
      vertices[v+1]=(rock.upY*cosine+(rock.xY*x+rock.zY*z)*sine)*r;
      vertices[v+2]=(rock.upZ*cosine+(rock.xZ*x+rock.zZ*z)*sine)*r;
    }
    for(let i=0;i<indices.length;i+=3) {
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
      for(let axis=0;axis<3;axis++) {
        triangles[i*3+axis]=vertices[a+axis];triangles[i*3+3+axis]=vertices[b+axis]-vertices[a+axis];triangles[i*3+6+axis]=vertices[c+axis]-vertices[a+axis];
      }
    }
    rock.triangles=triangles;return triangles;
  }

  blocked(dir: Vector3, groundHeight: number): boolean {
    const length=Math.sqrt(dir.x*dir.x+dir.y*dir.y+dir.z*dir.z),dx=dir.x/length,dy=dir.y/length,dz=dir.z/length;
    const surface=this.radius+groundHeight+.02,ox=dx*surface,oy=dy*surface,oz=dz*surface;
    const bucket=this.cells.get(`${Math.floor(dx*this.radius/this.cellSize)},${Math.floor(dy*this.radius/this.cellSize)},${Math.floor(dz*this.radius/this.cellSize)}`);
    if(!bucket)return false;
    for(const rock of bucket) {
      const forward=dx*rock.upX+dy*rock.upY+dz*rock.upZ;
      if(rock.outerRadius<=surface||forward<rock.minimumCosine)continue;
      const x=this.radius*(dx*rock.xX+dy*rock.xY+dz*rock.xZ)/forward,z=this.radius*(dx*rock.zX+dy*rock.zY+dz*rock.zZ)/forward;
      if(x<rock.x0||x>rock.x1||z<rock.z0||z>rock.z1)continue;
      const triangles=this.worldTriangles(rock);
      for(let i=0;i<triangles.length;i+=9) {
        const ax=triangles[i],ay=triangles[i+1],az=triangles[i+2];
        const ex=triangles[i+3],ey=triangles[i+4],ez=triangles[i+5];
        const fx=triangles[i+6],fy=triangles[i+7],fz=triangles[i+8];
        const px=dy*fz-dz*fy,py=dz*fx-dx*fz,pz=dx*fy-dy*fx;
        const determinant=ex*px+ey*py+ez*pz;
        if(Math.abs(determinant)<1e-12)continue;
        const inverse=1/determinant,tx=ox-ax,ty=oy-ay,tz=oz-az;
        const u=(tx*px+ty*py+tz*pz)*inverse;
        if(u< -1e-9||u>1+1e-9)continue;
        const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex;
        const v=(dx*qx+dy*qy+dz*qz)*inverse;
        if(v< -1e-9||u+v>1+1e-9)continue;
        if((fx*qx+fy*qy+fz*qz)*inverse>=0)return true;
      }
    }
    return false;
  }
}
