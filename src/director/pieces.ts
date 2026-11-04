import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { POT } from '../life/museRig';
import { tangentToward, travel } from '../planet/geo';
import fragmentShader from './piece.frag.glsl?raw';
import vertexShader from './piece.vert.glsl?raw';
import type { Piece, Vec3 } from './scene';
import type { PieceSpot } from './timeline';

// The director's set pieces (director.ts): what a Muse sits on or cooks at where there is none of the planet's own.
// Copies of the meadow's: the bench against its hut's front (props.ts BENCH, its boxes in their weathered tan, the
// palette's ROOF row), and the little stove that stood on its porch before the hut took its cooking in (museProps.ts
// before d0c0544: an iron box on short legs, its fire's window to the front, a pipe, a pot of soup). Each stands on the
// ground at its mark, square to the planet there, its front the mark's arrow; lit as Muse's things are, in each
// world's own light (piece.frag.glsl, on the world's shaders' chunks).

/** The bench (m): its seat's half length and half depth and its top over the ground (props.ts BENCH), its legs' and rail's boxes. */
export const BENCH = { half: 0.74, depth: 0.19, seat: 0.485 } as const;
/** The stove's footprint's half width and half depth (m), for keeping clear of it. */
export const STOVE = { half: 0.27, depth: 0.23 } as const;
/** The weathered tan of the meadow's bench (palette ROOF 12, #AE8748) and the stove's iron (as the porch's). */
const TAN = 0xae8748;
const IRON = 0x3c3a3a;

type Part = [geometry: BufferGeometry, colour: number, at?: Matrix4, glow?: boolean];

/** One geometry from parts, each painted its colour (aColour, linear) and glowing or not (aGlow). */
function build(parts: Part[]): BufferGeometry {
  const pieces = parts.map(([g, colour, at, glow]) => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    if (at) p.applyMatrix4(at);
    p.deleteAttribute('uv');
    const n = p.getAttribute('position').count;
    const c = new Color(colour);
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
    p.setAttribute('aColour', new BufferAttribute(rgb, 3));
    p.setAttribute('aGlow', new BufferAttribute(new Float32Array(n).fill(glow ? 1 : 0), 1));
    return p;
  });
  const merged = mergeGeometries(pieces);
  if (!merged) throw new Error('director pieces: parts could not be merged');
  return merged;
}

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));
/** A box by its middle and half sizes (as props.ts's builder takes them). */
const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, colour: number): Part => [new BoxGeometry(2 * hx, 2 * hy, 2 * hz), colour, at(x, y, z)];

let geometries: { bench: BufferGeometry; stove: BufferGeometry } | null = null;
function shapes(): { bench: BufferGeometry; stove: BufferGeometry } {
  if (geometries) return geometries;
  // the bench (props.ts fittings): the seat, two legs, the rail between them; local x along it, z its front
  const bench = build([
    box(0, BENCH.seat - 0.035, 0, BENCH.half, 0.035, BENCH.depth, TAN),
    box(-0.62, 0.23, 0, 0.05, 0.21, 0.16, TAN),
    box(0.62, 0.23, 0, 0.05, 0.21, 0.16, TAN),
    box(0, 0.14, 0, 0.62, 0.025, 0.02, TAN),
  ]);
  // the stove (the porch's): its box on four short legs, its top, the fire's window to the front, the pipe, the pot of soup
  const pot = [new Vector2(0, -0.2), new Vector2(0.15, -0.195), new Vector2(0.19, -0.13), new Vector2(0.195, -0.03), new Vector2(0.18, 0), new Vector2(0.2, 0.008), new Vector2(0.195, 0.022)];
  const stove = build([
    [new BoxGeometry(0.5, 0.38, 0.42), IRON, at(0, 0.24, 0)],
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz): Part => [new BoxGeometry(0.05, 0.06, 0.05), IRON, at(sx * 0.21, 0.03, sz * 0.17)])),
    [new BoxGeometry(0.54, 0.03, 0.46), 0x2e2c2c, at(0, 0.445, 0)],
    [new BoxGeometry(0.2, 0.12, 0.012), 0xff9a50, at(0, 0.21, 0.212), true],
    [new CylinderGeometry(0.05, 0.05, 0.8, 10), IRON, at(0.17, 0.82, -0.15)],
    [new LatheGeometry(pot, 20), 0x46413f, at(-0.04, 0.66, 0)],
    [new CircleGeometry(0.18, 20), 0xd9893f, at(-0.04, 0.64, 0, -Math.PI / 2)],
  ]);
  geometries = { bench, stove };
  return geometries;
}

const v = (a: Vec3, out = new Vector3()): Vector3 => out.set(a[0], a[1], a[2]);

/** The set pieces on the planet: one mesh each, placed at its mark on the ground, and where Muses use them. */
export class Pieces {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly glow = new Vector3(1.4, 0.8, 0.35);
  private readonly meshes = new Map<string, Mesh>();
  private readonly spots = new Map<string, PieceSpot>();

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'director pieces', vertexShader, fragmentShader, uniforms: { ...shared, uGlow: { value: this.glow } }, side: DoubleSide });
    this.group.name = 'director pieces';
  }

  /**
   * Put the pieces where the scene has them, on the ground as it is (R: the planet's radius; ground: its height over R
   * at a place, m), and work out where Muses stand at them (H: their height).
   */
  set(pieces: readonly Piece[], R: number, H: number, ground: (dir: Vector3) => number): void {
    const keep = new Set(pieces.map((p) => p.id));
    for (const [id, mesh] of this.meshes) {
      if (keep.has(id)) continue;
      this.group.remove(mesh);
      this.meshes.delete(id);
    }
    this.spots.clear();
    const s = shapes();
    for (const p of pieces) {
      let mesh = this.meshes.get(p.id);
      if (!mesh || mesh.userData.kind !== p.kind) {
        if (mesh) this.group.remove(mesh);
        mesh = new Mesh(p.kind === 'bench' ? s.bench : s.stove, this.material);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.userData.kind = p.kind;
        this.meshes.set(p.id, mesh);
        this.group.add(mesh);
      }
      const dir = v(p.at.dir).normalize();
      const front = tangentToward(dir, v(p.at.facing).add(dir), new Vector3());
      const left = new Vector3().crossVectors(dir, front).normalize();
      const height = R + ground(dir);
      mesh.matrix.makeBasis(left, dir, front).setPosition(dir.clone().multiplyScalar(height));
      mesh.matrixWorldNeedsUpdate = true;
      if (p.kind === 'bench') {
        // sat on its front edge, facing out from it (museRoam.ts bench): hopping up onto it from a step in front
        const seat = travel(dir, front, (BENCH.depth + 0.02 * H) / R, new Vector3());
        const stand = travel(dir, front, (BENCH.depth + 0.47 * H) / R, new Vector3());
        this.spots.set(p.id, { stand, facing: tangentToward(stand, stand.clone().add(front), new Vector3()), seat, seatHeight: BENCH.seat });
      } else {
        // behind it, looking over it the way its fire faces, the pot to its right ahead (museRig.ts POT: as at the porch's)
        const back = travel(dir, front, (-POT[2] * H) / R, new Vector3());
        const stand = travel(back, left, (-POT[0] * H) / R, new Vector3());
        const pot = dir.clone().multiplyScalar(height + POT[1] * H);
        this.spots.set(p.id, { stand, facing: tangentToward(stand, stand.clone().add(front), new Vector3()), pot });
      }
    }
  }

  spot(id: string): PieceSpot | null {
    return this.spots.get(id) ?? null;
  }

  /** Once a frame: the stoves' fire flickering, brighter while one is cooked at. */
  update(time: number, cooking: boolean): void {
    const flicker = 0.85 + 0.15 * Math.sin(time * 9.1) * Math.sin(time * 5.3 + 1.3);
    this.glow.set(1.4, 0.8, 0.35).multiplyScalar((0.35 + 0.65 * (cooking ? 1 : 0)) * flicker);
  }

  dispose(): void {
    this.material.dispose();
  }
}
