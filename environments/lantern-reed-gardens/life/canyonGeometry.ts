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

/** Long, thin botanical leaf with a central fold and a pointed, drooping tip. */
export function addReedLeaf(b: CanyonGeometry, origin: Vector3, length: number, turn: number, width = 0.55, kind = 1): void {
  const rows = 16;
  const point = (u: number, t: number): Vector3 => {
    const spread = width * Math.pow(Math.sin(Math.PI * t), 0.72);
    const x = length * (0.15 * t + 0.82 * t * t);
    const y = length * (1.06 * t - 1.04 * t * t) + 0.08 * spread * (1 - Math.abs(u));
    const z = spread * u;
    return origin.clone().add(new Vector3(x * Math.cos(turn) + z * Math.sin(turn), y, z * Math.cos(turn) - x * Math.sin(turn)));
  };
  for (let row = 0; row < rows; row++) for (const [a, c] of [[-1, 0], [0, 1]]) {
    const t0 = row / rows, t1 = (row + 1) / rows;
    const p0 = point(a, t0), p1 = point(c, t0), p2 = point(c, t1), p3 = point(a, t1);
    b.triangle(p0, p1, p2, kind, [[(a + 1) / 2, t0], [(c + 1) / 2, t0], [(c + 1) / 2, t1]]);
    b.triangle(p0, p2, p3, kind, [[(a + 1) / 2, t0], [(c + 1) / 2, t1], [(a + 1) / 2, t1]]);
  }
}

/** Six crisp paper facets surrounding a warm seed core. */
export function addSeedLantern(b: CanyonGeometry, centre: Vector3, size: number): void {
  const top = centre.clone().add(new Vector3(0, size * 0.78, 0));
  const bottom = centre.clone().add(new Vector3(0, -size * 0.65, 0));
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, c = (i + 1) * Math.PI / 3;
    const p = centre.clone().add(new Vector3(Math.cos(a) * size * 0.32, size * 0.1, Math.sin(a) * size * 0.32));
    const q = centre.clone().add(new Vector3(Math.cos(c) * size * 0.32, size * 0.1, Math.sin(c) * size * 0.32));
    b.triangle(bottom, q, p, 7, [[0.5, 0], [1, 0.55], [0, 0.55]]);
    b.triangle(p, q, top, 7, [[0, 0.55], [1, 0.55], [0.5, 1]]);
    b.tube([bottom, p, top], [size * 0.009, size * 0.008, size * 0.006], 8, 4);
  }
}

/** Three stems sharing one root, with separate seed cases and a few broad leaves. */
export function fanTreeGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  for (let i = 0; i < 3; i++) {
    const turn = i * 2.4;
    const height = [5.4, 4.1, 3.3][i];
    const side = new Vector3(Math.cos(turn), 0, Math.sin(turn));
    const stem = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8;
      return side.clone().multiplyScalar(0.2 + 0.65 * t * t).setY(height * t);
    });
    b.tube(stem, stem.map((_, k) => 0.045 - k * 0.0035), 8, 6);
    addSeedLantern(b, stem[8].clone().add(new Vector3(0, 0.42, 0)), 0.74 - i * 0.09);
    addReedLeaf(b, stem[4], 2.9 - i * 0.35, turn + 0.3, 0.43);
    if (i === 0) addReedLeaf(b, stem[6], 3.65, turn + 2.0, 0.63);
    addReedLeaf(b, stem[3], 2.1 - i * 0.2, turn + 2.8, 0.31);
    // Reddish sepals hold the case, slender and separate from its seed paper.
    for (let k = 0; k < 4; k++) {
      const angle = k * Math.PI / 2;
      const at = stem[8].clone();
      const tip = at.clone().add(new Vector3(Math.cos(angle) * 0.22, 0.38, Math.sin(angle) * 0.22));
      b.tube([at, tip], [0.025, 0.008], 3, 4);
    }
  }
  return b.build();
}

/** A flat mineral paving fragment, with chipped planes and a sloping fracture edge. */
export function chalkGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  const lower = [[-1.1,-0.12,-0.7],[0.85,-0.1,-0.8],[1.16,-0.12,0.2],[0.55,-0.14,0.8],[-1.0,-0.12,0.6]].map(p => new Vector3(...p as [number,number,number]));
  const upper = [[-0.98,0.25,-0.61],[0.77,0.23,-0.7],[1.02,0.22,0.2],[0.48,0.24,0.7],[-0.91,0.26,0.53]].map(p => new Vector3(...p as [number,number,number]));
  const top = new Vector3(-0.05,0.26,-0.02);
  for (let i = 0; i < 5; i++) {
    const n = (i + 1) % 5;
    b.quad(lower[i],lower[n],upper[n],upper[i],2,1.8,0.4);
    b.triangle(upper[i],upper[n],top,2,[[0,0],[1.4,0],[0.7,0.8]]);
  }
  return b.build();
}

/** Violet shore plants have tiny dry leaves, with large gaps between each sprig. */
export function fernGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  for (let f = 0; f < 5; f++) {
    const turn = f * Math.PI * 2 / 5;
    const height = 0.32 + (f % 3) * 0.08;
    const side = new Vector3(Math.cos(turn), 0, Math.sin(turn));
    const tip = side.clone().multiplyScalar(0.26).setY(height);
    b.tube([new Vector3(),tip],[0.016,0.005],3,4);
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const mid = tip.clone().multiplyScalar(t);
      addReedLeaf(b, mid, 0.19, turn + Math.PI / 2, 0.055, 3);
      addReedLeaf(b, mid, 0.16, turn - Math.PI / 2, 0.05, 3);
    }
  }
  return b.build();
}

/** Four thin ivory petal wings around one small gold thorax. */
export function lampPetalGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  b.tube([new Vector3(0,-0.015,-0.08),new Vector3(0,0.015,0.07),new Vector3(0,0,0.13)],[0.018,0.025,0.014],11,6);
  for (let wing = 0; wing < 4; wing++) {
    const side = wing < 2 ? -1 : 1;
    const forward = wing % 2 === 0 ? 1 : -1;
    const root = new Vector3(side * 0.018,0,forward * 0.024);
    const tip = new Vector3(side * 0.23,0.015,forward * 0.16);
    const a = new Vector3(side * 0.13,0.025,forward * 0.005);
    const c = new Vector3(side * 0.065,-0.003,forward * 0.15);
    b.triangle(root,a,tip,10,[[0.5,0],[0,0.5],[0.5,1]]);
    b.triangle(root,tip,c,10,[[0.5,0],[0.5,1],[1,0.5]]);
  }
  return b.build();
}
