import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, type IUniform } from 'three';
import fragmentShader from './house.frag.glsl?raw';
import vertexShader from './house.vert.glsl?raw';
import { MAX_HOUSES, type Village } from './villages';

// The villages' houses (villages.ts places them): white plaster on a grey
// stone plinth under a dark tiled gable roof, its eaves out over the walls,
// as the ink paintings lay them (reference/terraces 1, 8). One instanced
// draw. Each house is bent round the planet (house.vert.glsl), so its walls
// stand square to the ground under it.

/** The roof's pitch (rise over half the depth), and how far the eaves stand out (m). */
export const ROOF = { pitch: 0.62, eaves: 0.4 } as const;

/**
 * A house template: x along its length and z across its depth (front +z),
 * both in [-0.5, 0.5] of its size; y 0 at the floor, 1 at the eaves; roof
 * vertices carry their rise (0 at the eaves, 1 at the ridge) and the eaves'
 * outward reach (m) apart. aPart: 0 walls, 1 roof, 2 gable ends, 3 plinth.
 */
function houseGeometry(): InstancedBufferGeometry {
  const pos: number[] = [];
  const out: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const quad = (p: number, n: number[], ...v: number[][]): void => {
    // v: four corners [x, y, z, ox, oy, oz] counter-clockwise from outside
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(v[k][0], v[k][1], v[k][2]);
      out.push(v[k][3], v[k][4], v[k][5]);
      nrm.push(...n);
      part.push(p);
    }
  };
  const tri = (p: number, n: number[], ...v: number[][]): void => {
    for (const c of v) {
      pos.push(c[0], c[1], c[2]);
      out.push(c[3], c[4], c[5]);
      nrm.push(...n);
      part.push(p);
    }
  };
  const lo = -0.25; // the walls go down into the ground, whatever the terrace under them does
  // walls: front (+z), back (-z), ends (±x)
  quad(0, [0, 0, 1], [-0.5, lo, 0.5, 0, 0, 0], [0.5, lo, 0.5, 0, 0, 0], [0.5, 1, 0.5, 0, 0, 0], [-0.5, 1, 0.5, 0, 0, 0]);
  quad(0, [0, 0, -1], [0.5, lo, -0.5, 0, 0, 0], [-0.5, lo, -0.5, 0, 0, 0], [-0.5, 1, -0.5, 0, 0, 0], [0.5, 1, -0.5, 0, 0, 0]);
  quad(0, [1, 0, 0], [0.5, lo, 0.5, 0, 0, 0], [0.5, lo, -0.5, 0, 0, 0], [0.5, 1, -0.5, 0, 0, 0], [0.5, 1, 0.5, 0, 0, 0]);
  quad(0, [-1, 0, 0], [-0.5, lo, -0.5, 0, 0, 0], [-0.5, lo, 0.5, 0, 0, 0], [-0.5, 1, 0.5, 0, 0, 0], [-0.5, 1, -0.5, 0, 0, 0]);
  // gable ends: triangles from the eaves to the ridge (y > 1 is the roof's rise, scaled in the shader)
  tri(2, [1, 0, 0], [0.5, 1, 0.5, 0, 0, 0], [0.5, 1, -0.5, 0, 0, 0], [0.5, 2, 0, 0, 0, 0]);
  tri(2, [-1, 0, 0], [-0.5, 1, -0.5, 0, 0, 0], [-0.5, 1, 0.5, 0, 0, 0], [-0.5, 2, 0, 0, 0, 0]);
  // the roof: two slopes from the eaves (out over the walls) to the ridge, with the eaves out at the ends too
  const e = ROOF.eaves;
  quad(1, [0, 1, 1], [-0.5, 1, 0.5, -e, -0.12, e], [0.5, 1, 0.5, e, -0.12, e], [0.5, 2, 0, e, 0, 0], [-0.5, 2, 0, -e, 0, 0]);
  quad(1, [0, 1, -1], [0.5, 1, -0.5, e, -0.12, -e], [-0.5, 1, -0.5, -e, -0.12, -e], [-0.5, 2, 0, -e, 0, 0], [0.5, 2, 0, e, 0, 0]);
  // the roof's underside, so it is not see-through from below
  quad(1, [0, -1, 0], [0.5, 1, 0.5, e, -0.12, e], [-0.5, 1, 0.5, -e, -0.12, e], [-0.5, 1, -0.5, -e, -0.12, -e], [0.5, 1, -0.5, e, -0.12, -e]);
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aOut', new BufferAttribute(new Float32Array(out), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  return g;
}

export class Houses {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Per house: its middle (direction) and floor (m); its length's way and length; its front's way and depth; walls' height, seed, -, -. */
  private readonly a = new InstancedBufferAttribute(new Float32Array(MAX_HOUSES * 4), 4);
  private readonly b = new InstancedBufferAttribute(new Float32Array(MAX_HOUSES * 4), 4);
  private readonly c = new InstancedBufferAttribute(new Float32Array(MAX_HOUSES * 4), 4);
  private readonly d = new InstancedBufferAttribute(new Float32Array(MAX_HOUSES * 4), 4);

  constructor(shared: Record<string, IUniform>) {
    const g = houseGeometry();
    for (const [name, attr] of [
      ['aHouse', this.a],
      ['aAlong', this.b],
      ['aFront', this.c],
      ['aSize', this.d],
    ] as const) {
      attr.setUsage(DynamicDrawUsage);
      g.setAttribute(name, attr);
    }
    g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'houses', vertexShader, fragmentShader, uniforms: { ...shared, uRoof: { value: ROOF.pitch } }, side: DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  set(villages: readonly Village[]): void {
    let n = 0;
    const a = this.a.array as Float32Array;
    const b = this.b.array as Float32Array;
    const c = this.c.array as Float32Array;
    const d = this.d.array as Float32Array;
    for (const v of villages) {
      for (const h of v.houses) {
        if (n >= MAX_HOUSES) break;
        a.set([h.dir.x, h.dir.y, h.dir.z, h.floor], n * 4);
        b.set([h.along.x, h.along.y, h.along.z, h.length], n * 4);
        c.set([h.front.x, h.front.y, h.front.z, h.depth], n * 4);
        d.set([h.wall, (h.seed >>> 8) / 16777216, 0, 0], n * 4);
        n++;
      }
    }
    for (const attr of [this.a, this.b, this.c, this.d]) attr.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
  }
}
