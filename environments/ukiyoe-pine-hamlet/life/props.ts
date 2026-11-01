import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

/** All dimensions are cottage-local metres; +z faces the water. */
export const FLOOR = 0.72;
export const COTTAGE = { halfX: 4.1, halfZ: 2.4, wall: 3.5, thickness: 0.18, overhang: 0.65, pitch: Math.atan(2.05 / 3.14) } as const;
export const FACE = 2.49;
export const SIDE = 4.19;
export const ROOF = { ex: 4.84, ez: 3.14, eave: 3.5, rise: 2.05, ridge: 4.84, slope: Math.hypot(3.14, 2.05), top: 5.55 } as const;
export const TERRACE = { x0: -4.4, x1: 4.4, z0: FACE, z1: 4.15 } as const;
/** Compatibility with Muse's deck interface: this home has no extra masonry pier. */
export const PIER = TERRACE;
export const STEPS = { x0: -1, x1: 1, count: 3, rise: FLOOR / 3, tread: 0.4 } as const;
export const BENCH = { x: -2.5, z: 2.80, half: 0.65, depth: 0.19, seat: 0.46 } as const;
export const CHAIR = { x: 3.3, z: 2.88, turn: 0.22 } as const;
/** Legacy reflection fields remain exported; this timber home has no culvert/chimney. */
export const ARCH = { x: 12, spring: 0, half: 0, depth: 0 } as const;
export const CHIMNEY = { x: 0, z: -0.6, half: 0 } as const;
export const BRIDGE = { x0: 8, x1: 16, z0: 9, z1: 11, foot: 0.10, rise: 0.55, rail: 0.85 } as const;

export function bridgeDeckHeight(x: number): number {
  const u = Math.min(1, Math.max(0, (x - BRIDGE.x0) / (BRIDGE.x1 - BRIDGE.x0)));
  return BRIDGE.foot + BRIDGE.rise * Math.sin(Math.PI * u);
}

/** Supported y above cottageGround, or null outside the constructed walking surfaces. */
export function walkableHeightAt(x: number, z: number): number | null {
  if (x >= BRIDGE.x0 && x <= BRIDGE.x1 && z >= BRIDGE.z0 && z <= BRIDGE.z1) return bridgeDeckHeight(x);
  if (x >= TERRACE.x0 && x <= TERRACE.x1 && z >= TERRACE.z0 && z <= TERRACE.z1) return FLOOR;
  if (x >= STEPS.x0 && x <= STEPS.x1 && z > TERRACE.z1 && z <= TERRACE.z1 + STEPS.count * STEPS.tread) {
    return FLOOR - Math.min(STEPS.count, Math.floor((z - TERRACE.z1) / STEPS.tread) + 1) * STEPS.rise;
  }
  return null;
}

type Kind = 'wall' | 'roof' | 'wood' | 'ink' | 'shoji' | 'stone' | 'snow';
const KINDS: readonly Kind[] = ['wall', 'roof', 'wood', 'ink', 'shoji', 'stone', 'snow'];
type Point = readonly [number, number, number];

/** A compact subdivided surface builder: curvature is applied only by props.vert. */
class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly paint: number[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly n = new Vector3();

  private vertex(p: Vector3, n: Vector3, u: number, v: number, edge: number, flag: number): void {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.paint.push(edge, 0, p.y, flag);
  }

  quad(p0: Point, p1: Point, p2: Point, p3: Point, flag = 0, density = 0.6): void {
    const q = [p0, p1, p2, p3].map(p => new Vector3(...p));
    const width = q[0].distanceTo(q[1]);
    const height = q[0].distanceTo(q[3]);
    const nx = Math.max(1, Math.ceil(width / density));
    const ny = Math.max(1, Math.ceil(height / density));
    const at = (u: number, v: number): Vector3 => q[0].clone().lerp(q[1], u).lerp(q[3].clone().lerp(q[2], u), v);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const uv = [[x / nx, y / ny], [(x + 1) / nx, y / ny], [(x + 1) / nx, (y + 1) / ny], [x / nx, (y + 1) / ny]];
      const points = uv.map(([u, v]) => at(u, v));
      for (const indices of [[0, 1, 2], [0, 2, 3]]) {
        this.a.subVectors(points[indices[1]], points[indices[0]]);
        this.b.subVectors(points[indices[2]], points[indices[0]]);
        this.n.crossVectors(this.a, this.b).normalize();
        for (const i of indices) {
          const [u, v] = uv[i];
          this.vertex(points[i], this.n, u * width, v * height, Math.min(u * width, (1 - u) * width, v * height, (1 - v) * height), flag);
        }
      }
    }
  }

  triangle(a: Point, b: Point, c: Point): void {
    this.a.set(...a); this.b.set(...b); this.c.set(...c);
    this.n.crossVectors(this.b.clone().sub(this.a), this.c.clone().sub(this.a)).normalize();
    this.vertex(this.a, this.n, 0, 0, 1, 0);
    this.vertex(this.b, this.n, 1, 0, 1, 0);
    this.vertex(this.c, this.n, 0, 1, 1, 0);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, flag = 0, faces = 'xXyYzZ'): void {
    if (flag === 0) flag = x1-x0 > Math.max(y1-y0,z1-z0) ? 3 : z1-z0 > y1-y0 ? 4 : 0;
    if (faces.includes('Y')) this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],flag);
    if (faces.includes('y')) this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],flag);
    if (faces.includes('X')) this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],flag);
    if (faces.includes('x')) this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],flag);
    if (faces.includes('Z')) this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],flag);
    if (faces.includes('z')) this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],flag);
  }

  beam(a: Point, b: Point, width: number, depth = width): void {
    const from = new Vector3(...a), to = new Vector3(...b);
    const along = to.clone().sub(from).normalize();
    const side = new Vector3().crossVectors(along, Math.abs(along.y) > 0.9 ? new Vector3(0,0,1) : new Vector3(0,1,0)).normalize().multiplyScalar(width / 2);
    const up = new Vector3().crossVectors(side, along).normalize().multiplyScalar(depth / 2);
    const p = (origin: Vector3, s: number, u: number): Point => origin.clone().addScaledVector(side,s).addScaledVector(up,u).toArray();
    this.quad(p(from,-1,-1),p(to,-1,-1),p(to,1,-1),p(from,1,-1));
    this.quad(p(from,1,1),p(to,1,1),p(to,-1,1),p(from,-1,1));
    this.quad(p(from,-1,1),p(to,-1,1),p(to,-1,-1),p(from,-1,-1));
    this.quad(p(from,1,-1),p(to,1,-1),p(to,1,1),p(from,1,1));
    this.quad(p(from,1,1),p(from,-1,1),p(from,-1,-1),p(from,1,-1));
    this.quad(p(to,-1,1),p(to,1,1),p(to,1,-1),p(to,-1,-1));
  }

  build(scale: number): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aPaint', new Float32BufferAttribute(this.paint, 4));
    if (scale !== 1) g.scale(scale,scale,scale);
    g.computeBoundingSphere();
    return g;
  }
}

type Builders = Record<Kind, Builder>;
export interface HouseOptions { bridge?: boolean; furniture?: boolean; scale?: number }

/** Single-owned connected floor: interior and veranda share an edge, never a cap. */
function floor(b: Builders): void {
  b.wood.box(-SIDE,SIDE,FLOOR-0.14,FLOOR,-FACE,FACE,1,'YxXz');
  b.wood.box(TERRACE.x0,TERRACE.x1,FLOOR-0.14,FLOOR,FACE,TERRACE.z1,1,'YxXZ');
  b.stone.box(-SIDE,SIDE,-0.18,FLOOR-0.14,-FACE,FACE,0,'xXzZ');
  // The veranda has slim actual supports; it is not a solid rectangular stage.
  for (const x of [-4.1,-2.1,2.1,4.1]) {
    b.wood.box(x-0.095,x+0.095,-0.1,FLOOR-0.14,3.75,3.94);
    b.stone.box(x-0.16,x+0.16,-0.16,0.04,3.68,4.01);
  }
  for (let i=0;i<STEPS.count;i++) {
    const z0=TERRACE.z1+i*STEPS.tread, z1=z0+STEPS.tread;
    const y=FLOOR-(i+1)*STEPS.rise;
    b.stone.box(STEPS.x0,STEPS.x1,-0.14,y,z0,z1,0,'YxXZ');
    // Thin snow fringe leaves the walking centre swept clear.
    for (const [x0,x1] of [[-1,-0.65],[0.65,1]]) b.snow.box(x0,x1,y+0.006,y+0.035,z0+0.02,z1-0.01,0,'YxXZ');
  }
}

function house(b: Builders): void {
  floor(b);
  // Front openings are real holes in the timber/plaster wall, occupied only by shoji.
  for (const [x0,x1] of [[-SIDE,-3.7],[-1.5,-0.82],[0.82,1.4],[3.7,SIDE]]) b.wall.box(x0,x1,FLOOR,3.5,FACE-0.15,FACE,0,'Z');
  for (const [x0,x1] of [[-3.7,-1.5],[1.4,3.7]]) {
    b.wood.box(x0,x1,FLOOR,1.28,FACE-0.14,FACE,0,'Z');
    b.wall.box(x0,x1,3.11,3.5,FACE-0.14,FACE,0,'Z');
    b.shoji.quad([x0,1.28,FACE-0.035],[x1,1.28,FACE-0.035],[x1,3.11,FACE-0.035],[x0,3.11,FACE-0.035]);
    for (let i=0;i<=4;i++) { const x=x0+(x1-x0)*i/4; b.wood.box(x-0.028,x+0.028,1.28,3.11,FACE-0.02,FACE+0.025); }
    for (let i=0;i<=5;i++) { const y=1.28+(3.11-1.28)*i/5; b.wood.box(x0,x1,y-0.023,y+0.023,FACE-0.02,FACE+0.025); }
  }
  // A recessed dark open doorway and short interior floor preserve entrance depth.
  b.ink.quad([-0.82,FLOOR,1.75],[0.82,FLOOR,1.75],[0.82,3.11,1.75],[-0.82,3.11,1.75]);
  b.wood.box(-0.82,0.82,3.11,3.5,FACE-0.15,FACE);
  b.wood.box(-SIDE,SIDE,FLOOR,3.5,-FACE-0.03,-FACE+0.12,0,'z');
  // Side elevations: a cream infill field, structural timber and one inset window.
  for (const side of [-1,1]) {
    const x=side*SIDE;
    b.wall.quad([x,FLOOR,FACE],[x,FLOOR,-FACE],[x,3.5,-FACE],[x,3.5,FACE]);
    b.wall.triangle([x,3.5,-FACE],[x,3.5,FACE],[x,5.12,0]);
    const panelX=x+side*0.012;
    b.shoji.quad([panelX,1.40,0.95],[panelX,1.40,-0.95],[panelX,2.96,-0.95],[panelX,2.96,0.95]);
    for (const z of [-0.95,-0.48,0,0.48,0.95]) b.wood.box(x-0.045,x+0.045,1.38,2.98,z-0.027,z+0.027);
    for (const y of [1.40,1.79,2.18,2.57,2.96]) b.wood.box(x-0.045,x+0.045,y-0.025,y+0.025,-0.95,0.95);
    for (const z of [-FACE,0,FACE]) b.wood.box(x-0.09,x+0.09,FLOOR,3.5,z-0.085,z+0.085);
    b.wood.box(x-0.09,x+0.09,3.32,3.50,-FACE,FACE);
    b.wood.box(x-0.07,x+0.07,1.16,1.30,-FACE,FACE);
    b.wood.beam([x,3.49,-FACE],[x,5.13,0],0.16);
    b.wood.beam([x,5.13,0],[x,3.49,FACE],0.16);
    b.wood.box(x-0.085,x+0.085,3.5,5.13,-0.085,0.085);
  }
  for (const x of [-4.1,-1.35,1.24,4.1]) b.wood.box(x-0.10,x+0.10,FLOOR,3.62,FACE-0.09,FACE+0.11);
  b.wood.box(-SIDE-0.1,SIDE+0.1,3.28,3.52,FACE-0.11,FACE+0.12);
  for (const z of [-2.9,2.9]) b.wood.box(-4.8,4.8,3.38,3.52,z-0.075,z+0.075);
  for (let x=-4.6;x<=4.61;x+=0.48) {
    b.wood.beam([x,3.35,-3.05],[x,5.40,0],0.085,0.11);
    b.wood.beam([x,5.40,0],[x,3.35,3.05],0.085,0.11);
  }
  // Two genuinely gabled tile planes. Tile courses are carved lines in the material.
  for (const side of [-1,1]) {
    const z=side*ROOF.ez;
    b.roof.quad([-ROOF.ex,ROOF.eave,z],[ROOF.ex,ROOF.eave,z],[ROOF.ex,ROOF.top,0],[-ROOF.ex,ROOF.top,0]);
    b.roof.quad([-ROOF.ex,ROOF.eave-0.13,z],[ROOF.ex,ROOF.eave-0.13,z],[ROOF.ex,ROOF.eave,z],[-ROOF.ex,ROOF.eave,z]);
    for (const x of [-ROOF.ex,ROOF.ex]) b.roof.quad([x,ROOF.eave,z],[x,ROOF.eave-0.13,z],[x,ROOF.top-0.13,0],[x,ROOF.top,0]);
    // One connected accumulation melts back from the eave. An enclosed tile
    // opening read as a decorative eye in the app; the lower tile courses now
    // stay exposed across the roof under this irregular, restrained boundary.
    const retreat=(x:number):number=>Math.min(0.36,Math.max(0.18,0.28+0.065*Math.sin(x*0.74+side)+0.023*Math.sin(x*2.6+0.3)+0.018*Math.sin(x*4.7)));
    const roofY=(z:number):number=>ROOF.eave+ROOF.rise*(1-Math.abs(z)/ROOF.ez);
    const snowBand=(bottom:(x:number)=>number,top:(x:number)=>number):void=>{
      const nx=36,nz=5;
      const p=(i:number,j:number):Point=>{
        const x=-ROOF.ex+2*ROOF.ex*i/nx;
        const f=bottom(x)+(top(x)-bottom(x))*j/nz;
        const edge=Math.sin(x*3.1)*0.018+Math.cos(x*5.7)*0.012;
        return [x,ROOF.eave+ROOF.rise*f+0.11+0.065*Math.sin(Math.PI*f)+edge,side*ROOF.ez*(1-f)];
      };
      for(let j=0;j<nz;j++) for(let i=0;i<nx;i++) b.snow.quad(p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1));
      for(let i=0;i<nx;i++)for(const j of [0,nz]){
        const a=p(i,j),c=p(i+1,j);
        // The skirt meets the roof plane; a fixed thickness left daylight underneath.
        b.snow.quad([a[0],roofY(a[2]),a[2]],[c[0],roofY(c[2]),c[2]],c,a);
      }
      for(const i of [0,nx])for(let j=0;j<nz;j++){
        const a=p(i,j),c=p(i,j+1);
        b.snow.quad([a[0],roofY(a[2]),a[2]],[c[0],roofY(c[2]),c[2]],c,a);
      }
    };
    snowBand(retreat,()=>1);

  }
  b.roof.beam([-4.95,5.58,0],[4.95,5.58,0],0.23,0.23);
  for(let x=-4.8;x<4.9;x+=0.53) b.roof.box(x-0.055,x+0.055,5.58,5.72,-0.16,0.16);
  // Slightly broken ridge accumulation follows the capped ridge without a box silhouette.
  for(let i=0;i<36;i++) {
    const x0=-4.98+9.96*i/36,x1=-4.98+9.96*(i+1)/36;
    const y0=5.84+0.025*Math.sin(x0*2.3),y1=5.84+0.025*Math.sin(x1*2.3);
    b.snow.quad([x0,y0-0.045,0.20],[x1,y1-0.045,0.20],[x1,y1,0],[x0,y0,0]);
    b.snow.quad([x0,y0,0],[x1,y1,0],[x1,y1-0.045,-0.20],[x0,y0-0.045,-0.20]);
  }
}

function furniture(b: Builders): void {
  const y=FLOOR+BENCH.seat;
  b.wood.box(BENCH.x-BENCH.half,BENCH.x+BENCH.half,y-0.08,y,BENCH.z-BENCH.depth,BENCH.z+BENCH.depth,1);
  for(const x of [BENCH.x-0.5,BENCH.x+0.5]) b.wood.box(x-0.055,x+0.055,FLOOR,y-0.08,BENCH.z-0.15,BENCH.z+0.15);
  // Low small chair in the corner, clear of the central porch route.
  b.wood.box(CHAIR.x-0.24,CHAIR.x+0.24,FLOOR+0.36,FLOOR+0.44,CHAIR.z-0.22,CHAIR.z+0.22,1);
  for(const x of [CHAIR.x-0.18,CHAIR.x+0.18]) for(const z of [CHAIR.z-0.16,CHAIR.z+0.16]) b.wood.box(x-0.04,x+0.04,FLOOR,FLOOR+0.38,z-0.04,z+0.04);
  b.wood.box(CHAIR.x-0.24,CHAIR.x+0.24,FLOOR+0.44,FLOOR+0.89,CHAIR.z-0.24,CHAIR.z-0.18);
}

function bridge(b: Builders): void {
  const n=32;
  for(let i=0;i<n;i++){
    const x0=BRIDGE.x0+(BRIDGE.x1-BRIDGE.x0)*i/n, x1=BRIDGE.x0+(BRIDGE.x1-BRIDGE.x0)*(i+1)/n;
    const y0=bridgeDeckHeight(x0),y1=bridgeDeckHeight(x1);
    b.wood.quad([x0,y0,BRIDGE.z1],[x1,y1,BRIDGE.z1],[x1,y1,BRIDGE.z0],[x0,y0,BRIDGE.z0],2);
    for(const z of [BRIDGE.z0,BRIDGE.z1]) {
      b.wood.quad([x0,y0-0.2,z],[x1,y1-0.2,z],[x1,y1,z],[x0,y0,z]);
      for(const h of [0.40,BRIDGE.rail]) b.wood.beam([x0,y0+h,z],[x1,y1+h,z],0.09,0.12);
      b.snow.quad([x0,y0+BRIDGE.rail+0.07,z-0.055],[x1,y1+BRIDGE.rail+0.07,z-0.055],[x1,y1+BRIDGE.rail+0.10,z+0.055],[x0,y0+BRIDGE.rail+0.10,z+0.055]);
    }
  }
  for(const x of [8,10,12,14,16]) for(const z of [BRIDGE.z0,BRIDGE.z1]) {
    const y=bridgeDeckHeight(x);
    b.wood.box(x-0.11,x+0.11,y-0.27,y+1.02,z-0.11,z+0.11);
    b.snow.box(x-0.13,x+0.13,y+1.03,y+1.10,z-0.13,z+0.13,0,'YxXzZ');
  }
  for(const x of [8,16])for(const z of [9,11]){
    // Chamfered, slightly unequal mineral faces; broad bottom rests in the bank.
    const ring=[[-0.22,-0.34],[0.19,-0.33],[0.34,-0.19],[0.32,0.20],[0.18,0.34],[-0.20,0.31],[-0.34,0.17],[-0.33,-0.16]];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length];
      const pa:Point=[x+a[0]*0.92,0.08,z+a[1]*0.92],pc:Point=[x+c[0]*0.92,0.08,z+c[1]*0.92];
      b.stone.quad([x+a[0],-0.35,z+a[1]],[x+c[0],-0.35,z+c[1]],pc,pa);
      b.stone.triangle([x,0.08,z],pa,pc);
    }
  }
}

/** Inspectable geometry factory also used by CPU contact/coverage tests. */
export function createHouseGeometry(options: HouseOptions = {}): ReadonlyMap<Kind, BufferGeometry> {
  const b=Object.fromEntries(KINDS.map(kind=>[kind,new Builder()])) as Builders;
  house(b);
  if(options.furniture!==false) furniture(b);
  if(options.bridge!==false) bridge(b);
  return new Map(KINDS.map(kind=>[kind,b[kind].build(options.scale??1)]));
}

const axisX=new Vector3(),axisZ=new Vector3();
export class Homestead {
  readonly group=new Object3D();
  private readonly materials:ShaderMaterial[]=[];
  private readonly geometry:BufferGeometry[]=[];
  constructor(shared:Record<string,IUniform>,_seed:number,options:HouseOptions={}) {
    for(const [kind,geometry] of createHouseGeometry(options)) {
      const material=new ShaderMaterial({name:`ukiyoe-${kind}`,vertexShader,fragmentShader,uniforms:{...shared,uKind:{value:KINDS.indexOf(kind)},uSnowAmount:shared.uSnowAmount??{value:1}},side:DoubleSide});
      this.materials.push(material);this.geometry.push(geometry);
      const mesh=new Mesh(geometry,material);mesh.frustumCulled=false;
      mesh.name=`ukiyoe-house-${kind}`;this.group.add(mesh);
    }
    this.group.matrixAutoUpdate=false;
  }
  place(origin:Vector3,up:Vector3,toward:Vector3):void {
    const x=axisX.crossVectors(up,toward).normalize(),z=axisZ.crossVectors(x,up).normalize();
    this.group.matrix.makeBasis(x,up,z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate=true;this.group.updateMatrixWorld(true);
  }
  dispose():void {this.geometry.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.group.clear();}
}
