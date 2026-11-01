import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, MeshBasicMaterial, Vector3 } from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

/** Small non-indexed mesh builder. Hard faces remain hard; foliage is genuinely thin geometry. */
export class WindGeometry {
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

/** An asymmetric papery kite leaf, with a continuous central rib and mapped veins. */
export function sailLeaf(b: WindGeometry, origin: Vector3, height: number, width: number, turn = 0, kind = 1, profile: 0 | 1 | 2 = 0): void {
  const at = (side: number, v: number): Vector3 => {
    const arch = Math.max(0, Math.sin(Math.PI * v));
    // The wind draws the tip sideways. Each edge has its own rounded shoulder;
    // neither side is a straight triangle or a mirrored kite.
    const spread = profile === 1
      ? (side < 0 ? Math.pow(arch,.72)*(.62+.12*v) : Math.pow(arch,1.12)*(.88+.24*v))
      : profile === 2
        ? (side < 0 ? Math.pow(arch,.68)*(.94-.30*v) : Math.pow(arch,2.05)*(.50+1.15*v))
        : (side < 0 ? Math.pow(arch,.88)*(.95-.38*v+.12*Math.sin(3*Math.PI*v)) : Math.pow(arch,1.55)*(.42+1.15*v));
    const lean = profile === 1 ? .24 : profile === 2 ? .56 : .42;
    const ribX = -height * lean * Math.pow(v,2.2) + width * .20 * arch;
    const x = ribX + side * width * spread;
    const z = Math.abs(side) * width * 0.19 * arch + height * 0.055 * Math.sin(v * Math.PI * 0.7);
    return origin.clone().add(new Vector3(x * Math.cos(turn) + z * Math.sin(turn), height * v, z * Math.cos(turn) - x * Math.sin(turn)));
  };
  const segments = 24;
  for (let k = 0; k < segments; k++) {
    const v0 = k / segments, v1 = (k + 1) / segments;
    for (const side of [-1, 1]) {
      const a = at(0, v0), c = at(side, v1), d = at(0, v1), edge = at(side, v0);
      if (k > 0) b.triangle(a, edge, c, kind, [[0,v0],[side,v0],[side,v1]]);
      if (k < segments-1) b.triangle(a, c, d, kind, [[0,v0],[side,v1],[0,v1]]);
    }
  }
  const rib = Array.from({length:9}, (_, i) => at(0, i/8));
  b.tube(rib, rib.map((_, i) => 0.012 * (1 - i/10)), 0, 5);
}

/** Three distinct sparse sail habits: paired kite, tall fork, and broad wind flag. */
export function seedSailGeometry(variant = 0): BufferGeometry {
  const b = new WindGeometry();
  const v = Math.abs(variant) % 3;
  const stemPath = (points: readonly (readonly [number,number,number])[], radius: number): Vector3[] => {
    const curve = new CatmullRomCurve3(points.map(([x,y,z]) => new Vector3(x,y,z)));
    const path = curve.getPoints(10);
    b.tube(path,path.map((_,i)=>radius*(1-i/14)),0,7);
    return path;
  };
  if (v === 0) {
    const main = stemPath([[0,0,0],[.06,.85,.01],[.22,1.65,.055],[.42,2.30,.10]],.038);
    sailLeaf(b,main[10],1.72,.69,-.20,1,0);
    const side = stemPath([[.09,1.05,.02],[-.16,1.34,.04],[-.48,1.65,.06]],.025);
    sailLeaf(b,side[10],1.13,.48,.36,1,1);
  } else if (v === 1) {
    const main = stemPath([[0,0,0],[-.04,1.05,-.02],[.16,1.96,.02],[.27,2.75,.06]],.035);
    sailLeaf(b,main[10],1.52,.46,.08,1,1);
    const fork = stemPath([[.02,1.32,-.01],[-.24,1.70,.01],[-.58,2.06,.08]],.026);
    sailLeaf(b,fork[10],1.35,.55,-.43,1,0);
    const low = stemPath([[-.03,.80,-.01],[.29,1.04,-.12],[.52,1.33,-.18]],.019);
    sailLeaf(b,low[10],.67,.30,.52,1,2);
  } else {
    const main = stemPath([[0,0,0],[.20,.70,-.03],[.42,1.31,-.02],[.74,1.97,.03]],.041);
    sailLeaf(b,main[10],1.91,.91,-.42,1,2);
    const side = stemPath([[.21,.74,-.03],[-.09,1.03,.08],[-.30,1.26,.13]],.023);
    sailLeaf(b,side[10],.89,.36,.45,1,1);
  }
  return b.build();
}

/** A fracture slab with sharp bedding planes and a sloping crest. */
export function ribGeometry(): BufferGeometry {
  const b = new WindGeometry();
  const front = [new Vector3(-2.4,-0.22,0.57),new Vector3(2.1,-0.16,0.6),new Vector3(3.25,3.4,0.15),new Vector3(0.2,2.65,0.46),new Vector3(-1.5,1.12,0.62)];
  const back = front.map((p,i) => p.clone().add(new Vector3(i===2?0.1:-0.08,i===2?0.17:0.04,-(i===2?0.45:1.15))));
  const mid = new Vector3(0.2,1.1,0.59);
  const rear = new Vector3(0.15,1.2,-0.58);
  for (let i=0;i<front.length;i++) {
    const n=(i+1)%front.length;
    b.triangle(front[i],front[n],mid,2,[[front[i].x,front[i].y],[front[n].x,front[n].y],[mid.x,mid.y]]);
    b.triangle(back[n],back[i],rear,2,[[back[n].x,back[n].y],[back[i].x,back[i].y],[rear.x,rear.y]]);
    b.quad(front[n],front[i],back[i],back[n],2,front[i].distanceTo(front[n]),1.1);
  }
  return b.build();
}

type CoralNode = readonly [x: number, y: number, radius: number];
type CoralPath = readonly CoralNode[];

// These are open, authored branch skeletons, rather than recursive radial
// bushes: a spreading fan, a narrow upright crown, and a low windswept fan.
// Shared nodes join the branches. All terminal radii remain blunt.
const CORAL_FANS: readonly (readonly CoralPath[])[] = [
  [
    [[0,.05,.049],[-.025,.24,.045],[.025,.47,.036],[0,.69,.027],[.045,.88,.024]],
    [[-.025,.24,.043],[-.18,.36,.038],[-.32,.54,.031],[-.40,.73,.025],[-.43,.83,.023]],
    [[-.32,.54,.029],[-.49,.63,.025],[-.56,.76,.023]],
    [[-.18,.36,.034],[-.37,.37,.028],[-.50,.49,.024],[-.55,.57,.022]],
    [[-.37,.37,.027],[-.40,.50,.024],[-.39,.59,.022]],
    [[.025,.47,.033],[.20,.51,.032],[.33,.66,.026],[.39,.85,.023]],
    [[.20,.51,.030],[.42,.53,.027],[.55,.67,.023]],
    [[.42,.53,.025],[.49,.42,.023],[.58,.47,.022]],
    [[0,.69,.026],[-.12,.76,.024],[-.15,.87,.022]],
    [[.33,.66,.025],[.23,.76,.023],[.24,.86,.022]],
  ],
  [
    [[0,.05,.052],[.035,.27,.047],[.01,.52,.037],[.07,.76,.029],[.02,1.02,.024]],
    [[.035,.27,.039],[-.13,.42,.034],[-.20,.66,.028],[-.27,.86,.023]],
    [[-.20,.66,.027],[-.35,.73,.024],[-.39,.88,.022]],
    [[-.13,.42,.030],[-.29,.46,.025],[-.35,.59,.022]],
    [[.01,.52,.034],[.18,.64,.030],[.28,.85,.025],[.27,.98,.022]],
    [[.18,.64,.028],[.34,.65,.025],[.42,.77,.022]],
    [[.07,.76,.027],[-.07,.88,.024],[-.11,1.04,.022]],
    [[.035,.27,.033],[.20,.32,.028],[.30,.47,.023]],
    [[.20,.32,.026],[.34,.34,.023],[.39,.44,.021]],
  ],
  [
    [[0,.05,.052],[.015,.21,.047],[.16,.36,.038],[.33,.49,.030],[.42,.66,.024]],
    [[.015,.21,.043],[-.20,.29,.036],[-.41,.40,.029],[-.59,.58,.024]],
    [[-.20,.29,.033],[-.26,.47,.028],[-.38,.63,.023]],
    [[-.41,.40,.027],[-.56,.39,.025],[-.65,.47,.023]],
    [[-.26,.47,.026],[-.14,.55,.024],[-.12,.65,.022]],
    [[.16,.36,.035],[.38,.32,.031],[.56,.43,.026],[.64,.56,.023]],
    [[.38,.32,.028],[.43,.47,.026],[.53,.62,.023]],
    [[.33,.49,.027],[.21,.55,.025],[.19,.67,.022]],
    [[.015,.21,.034],[-.05,.40,.028],[.01,.55,.023]],
  ],
];

interface CoralSegment { a: Vector3; dx: number; dy: number; dz: number; length2: number; radius: number; taper: number; }

/**
 * A closed, gently rounded union of branches. Meshing the joined distance
 * field removes open tube ends and overlapping fork rings. The fan has real
 * shallow depth, smoothly changing normals and broad negative spaces.
 */
export function coralGeometry(variant = 0): BufferGeometry {
  const paths = CORAL_FANS[Math.abs(variant) % CORAL_FANS.length];
  const segments: CoralSegment[] = [];
  const bend = (x: number, y: number): number => .045 * Math.sin(x * 3.2 + variant * .6) * Math.sin(y * 2.7) + .018 * x;
  for (const path of paths) {
    const curve = new CatmullRomCurve3(path.map(([x,y]) => new Vector3(x,y,bend(x,y))));
    const steps = (path.length - 1) * 3;
    for (let i=0; i<steps; i++) {
      const a = curve.getPoint(i/steps), next = curve.getPoint((i+1)/steps);
      const radius = (t: number): number => {
        const n = t * (path.length - 1), k = Math.min(path.length - 2, Math.floor(n));
        return path[k][2] + (path[k+1][2] - path[k][2]) * (n - k);
      };
      const delta = next.clone().sub(a);
      segments.push({a,dx:delta.x,dy:delta.y,dz:delta.z,length2:delta.lengthSq(),radius:radius(i/steps),taper:radius((i+1)/steps)-radius(i/steps)});
    }
  }
  const resolution = 64, span = 1.65, centreY = .53;
  const material = new MeshBasicMaterial();
  const surface = new MarchingCubes(resolution,material,false,false,12000);
  surface.isolation = 0;
  surface.field.fill(-1);
  const smooth = .013;
  // Bin nearby branch segments in XY. Evaluating the shallow fan only near
  // its skeleton keeps construction cheap without changing the surface.
  const bins: CoralSegment[][] = Array.from({length:resolution*resolution},()=>[]);
  const grid = (value: number, centre: number): number => Math.floor(((value-centre)/span+.5)*resolution);
  for (const segment of segments) {
    const margin = segment.radius + .07;
    const x0 = Math.max(1,grid(Math.min(segment.a.x,segment.a.x+segment.dx)-margin,0));
    const x1 = Math.min(resolution-2,grid(Math.max(segment.a.x,segment.a.x+segment.dx)+margin,0)+1);
    const y0 = Math.max(1,grid(Math.min(segment.a.y,segment.a.y+segment.dy)-margin,centreY));
    const y1 = Math.min(resolution-2,grid(Math.max(segment.a.y,segment.a.y+segment.dy)+margin,centreY)+1);
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) bins[x+y*resolution].push(segment);
  }
  // A closed field keeps every tip rounded and eliminates uncapped tube holes.
  for (let z=1; z<resolution-1; z++) {
    const pz = (z/resolution-.5)*span;
    if (Math.abs(pz) > .16) continue;
    for (let y=1; y<resolution-1; y++) {
      const py = (y/resolution-.5)*span+centreY;
      for (let x=1; x<resolution-1; x++) {
        const px = (x/resolution-.5)*span;
        let distance = .07;
        for (const s of bins[x+y*resolution]) {
          const dx=px-s.a.x,dy=py-s.a.y,dz=pz-s.a.z;
          const t=Math.max(0,Math.min(1,(dx*s.dx+dy*s.dy+dz*s.dz)/s.length2));
          const qx=dx-s.dx*t,qy=dy-s.dy*t,qz=dz-s.dz*t;
          const branch=Math.sqrt(qx*qx+qy*qy+qz*qz)-s.radius-s.taper*t;
          const h=Math.max(smooth-Math.abs(distance-branch),0)/smooth;
          distance=Math.min(distance,branch)-h*h*smooth*.25;
        }
        surface.field[x+y*resolution+z*resolution*resolution] = -distance;
      }
    }
  }
  surface.update();
  const positions = surface.positionArray.slice(0,surface.count*3);
  const normals = surface.normalArray.slice(0,surface.count*3);
  const uv = new Float32Array(surface.count*2), kinds = new Float32Array(surface.count).fill(3);
  for (let i=0; i<surface.count; i++) {
    positions[i*3] *= span*.5;
    positions[i*3+1] = positions[i*3+1]*span*.5+centreY;
    positions[i*3+2] *= span*.5;
    const length = Math.hypot(normals[i*3],normals[i*3+1],normals[i*3+2]);
    for (let k=0;k<3;k++) normals[i*3+k] /= Math.max(length,1e-8);
    uv[i*2] = positions[i*3];
    uv[i*2+1] = positions[i*3+1];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
  geometry.setAttribute('aKind',new Float32BufferAttribute(kinds,1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  surface.geometry.dispose();
  material.dispose();
  return geometry;
}

function ellipsoid(b: WindGeometry, centre: Vector3, size: Vector3, kind: number): void {
  const rows=8, columns=12;
  const at=(u:number,v:number):Vector3=>new Vector3(Math.cos(u)*Math.sin(v)*size.x,Math.cos(v)*size.y,Math.sin(u)*Math.sin(v)*size.z).add(centre);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)b.quad(at(x/columns*Math.PI*2,y/rows*Math.PI),at((x+1)/columns*Math.PI*2,y/rows*Math.PI),at((x+1)/columns*Math.PI*2,(y+1)/rows*Math.PI),at(x/columns*Math.PI*2,(y+1)/rows*Math.PI),kind);
}

/** A compact four-footed animal with two ivory sails and a friendly blunt muzzle. */
export function sailbackGeometry(): BufferGeometry {
  const b=new WindGeometry();
  ellipsoid(b,new Vector3(0,0.24,0),new Vector3(0.2,0.16,0.38),10);
  ellipsoid(b,new Vector3(0,0.24,0.39),new Vector3(0.16,0.13,0.16),8);
  for(const x of [-0.15,0.15])for(const z of [-0.22,0.2]){
    b.tube([new Vector3(x,0.22,z),new Vector3(x*1.28,0.08,z+0.025)],[0.06,0.045],10,6);
    ellipsoid(b,new Vector3(x*1.28,0.055,z+0.065),new Vector3(0.065,0.055,0.075),8);
  }
  for(const x of [-0.098,0.098])ellipsoid(b,new Vector3(x,0.29,0.505),new Vector3(0.022,0.028,0.018),9);
  for(const z of [-0.2,0.12])sailLeaf(b,new Vector3(0,0.32,z),0.53,0.19,Math.PI/2,11);
  return b.build();
}

/** Four diamond wings surround a tiny cream spindle: the windfields' pollinator. */
export function kiteletGeometry(): BufferGeometry {
  const b=new WindGeometry();
  ellipsoid(b,new Vector3(0,0,0),new Vector3(0.025,0.03,0.11),8);
  for(const s of [-1,1])for(const z of [-1,1]){
    const root=new Vector3(s*0.01,0,z*0.02),tip=new Vector3(s*0.2,0.025,z*0.18),front=new Vector3(s*0.075,0.02,z*0.19),back=new Vector3(s*0.17,0.03,z*0.04);
    b.quad(root,front,tip,back,12);
  }
  return b.build();
}

/** A light dry seed sail: two crossing thin diamonds remain visible as they turn. */
export function driftingSeedGeometry(): BufferGeometry {
  const b = new WindGeometry();
  for (const turn of [0, Math.PI / 2]) {
    const point = (x: number, y: number): Vector3 => new Vector3(x * Math.cos(turn), y, x * Math.sin(turn));
    b.quad(point(0,-0.09),point(0.045,0),point(0,0.12),point(-0.045,0),1);
  }
  return b.build();
}
