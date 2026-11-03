import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute, FloatType, IcosahedronGeometry, Matrix4, Mesh, Quaternion, RedFormat, ShaderMaterial, Vector3, Vector4, type Group, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { PART } from './build/construct';
import fragmentShader from './model.frag.glsl?raw';
import vertexShader from './hut.vert.glsl?raw';

// Muse's hut on the terraces (Kai, 2026-11-03: "the Muse's house from Tracy's rice paddy planet", "in the spot specified
// by the ref image as the main Muse hut on this planet"; its place, size and turn his mockup's, give or take, its colours
// the planet's light): Tracy's Hui courtyard cottage, as Xinran Li builds it on her rice terraces
// (environments/rice-terraces/life/huiCottageGeometry.ts and huiCottage.ts on main): a tall two-storey hall, a lower
// west wing opening onto a walled yard, a gate in its wall, a bench and two planted jars, in her seven colours. Here it
// stands on a footing of its own: its yard paved level at the middle of the ground under it, coursed stone round it
// down to the terraces where they are lower, holding them back where they are higher (sunk under its paving); rocks
// heaped along its foot and trees by it (Kai: "a huge rectangular block looks ugly"), stone steps down from its gate
// and a path from them, a widened dam stepping with the terraces, to the nearest track (Kai: "stairs / a winding path
// leading from the front door to the main path"). Drawn as Kai's models are (model.frag.glsl, by its vertex colours: lit as the terraces,
// hazed, warped); the rice, the trees and the village houses kept off its footing.

/**
 * Where it stands: the middle of its footing (unit), its x way (along its hall, tangent there), its size (× Tracy's),
 * and where its floor stands among the heights of the ground under its paving (0 its lowest … 1 its highest).
 */
export interface HutSite {
  readonly centre: Vector3;
  readonly xWay: Vector3;
  readonly scale: number;
  readonly level: number;
  /** Its path's way from the foot of its gate's steps to the nearest track (m, its frame), the track's nearest point last. */
  readonly path: ReadonlyArray<readonly [number, number]>;
  /** Trees round it: where (m, its frame) and each one's seed (its size and its height: tree.vert.glsl). */
  readonly trees: ReadonlyArray<readonly [number, number, number]>;
}

type Surface = 'plaster' | 'tile' | 'timber' | 'stone' | 'shadow' | 'clay' | 'leaf';
interface Opening {
  left: number;
  right: number;
  bottom: number;
  top: number;
}
interface Rect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

const PALETTE: Record<Surface, string> = { plaster: '#eeede2', tile: '#263b3d', timber: '#574336', stone: '#929488', shadow: '#242b24', clay: '#8c6750', leaf: '#627b3e' };
const STONE = new Color('#89918a');
const MORTAR = new Color('#69756c');
const UP = new Vector3(0, 1, 0);

/** The hall, and the yard with its wing (m, Tracy's frame: x along the hall, y up, z out to the gate). */
const FOOTPRINT = [
  { x0: -4.58, x1: 4.58, z0: -5.1, z1: -0.04 },
  { x0: -6.55, x1: 5.36, z0: -0.04, z1: 6.68 },
] as const;
/** The paving: a 40 cm border of stone round the walls, two rectangles meeting along the hall's front. */
const BORDER = 0.4;
const PAVING: readonly Rect[] = [
  { x0: FOOTPRINT[0].x0 - BORDER, x1: FOOTPRINT[0].x1 + BORDER, z0: FOOTPRINT[0].z0 - BORDER, z1: FOOTPRINT[1].z0 - BORDER },
  { x0: FOOTPRINT[1].x0 - BORDER, x1: FOOTPRINT[1].x1 + BORDER, z0: FOOTPRINT[1].z0 - BORDER, z1: FOOTPRINT[1].z1 + BORDER },
];
/** Its edge, round it counter-clockwise (outward faces). */
const EDGE: ReadonlyArray<readonly [number, number]> = [
  [PAVING[0].x0, PAVING[0].z0],
  [PAVING[0].x1, PAVING[0].z0],
  [PAVING[0].x1, PAVING[0].z1],
  [PAVING[1].x1, PAVING[1].z0],
  [PAVING[1].x1, PAVING[1].z1],
  [PAVING[1].x0, PAVING[1].z1],
  [PAVING[1].x0, PAVING[1].z0],
  [PAVING[0].x0, PAVING[0].z1],
];
/** The middle of the footing (Tracy's frame). */
const MIDDLE = [(PAVING[1].x0 + PAVING[1].x1) / 2, (PAVING[0].z0 + PAVING[1].z1) / 2] as const;

class Batch {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colours: number[] = [];
}

/** Tracy's cottage (huiCottageGeometry.ts), in her metres, one batch of triangles in her colours. */
function cottage(out: Batch): void {
  const boxTemplate = new BoxGeometry(1, 1, 1).toNonIndexed();
  const circleTemplate = new CylinderGeometry(1, 1, 1, 10).toNonIndexed();
  const transform = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const point = new Vector3();
  const normal = new Vector3();
  const colour = new Color();
  const addGeometry = (surface: Surface, geometry: BufferGeometry, matrix: Matrix4, tint = 1): void => {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const normalRotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(matrix));
    colour.set(PALETTE[surface]).multiplyScalar(tint);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      normal.fromBufferAttribute(normals, i).applyQuaternion(normalRotation).normalize();
      out.positions.push(point.x, point.y, point.z);
      out.normals.push(normal.x, normal.y, normal.z);
      out.colours.push(colour.r, colour.g, colour.b);
    }
  };
  const box = (surface: Surface, x: number, y: number, z: number, w: number, h: number, d: number, tint = 1, turn = 0): void => {
    rotation.setFromAxisAngle(UP, turn);
    transform.compose(new Vector3(x, y, z), rotation, scale.set(w, h, d));
    addGeometry(surface, boxTemplate, transform, tint);
  };
  const beam = (surface: Surface, a: Vector3, b: Vector3, width: number, depth = width, tint = 1): void => {
    const delta = b.clone().sub(a);
    rotation.setFromUnitVectors(UP, delta.clone().normalize());
    transform.compose(a.clone().add(b).multiplyScalar(0.5), rotation, scale.set(width, delta.length(), depth));
    addGeometry(surface, boxTemplate, transform, tint);
  };
  const cylinder = (surface: Surface, x: number, y: number, z: number, r: number, h: number, tint = 1): void => {
    transform.makeScale(r, h, r).setPosition(x, y, z);
    addGeometry(surface, circleTemplate, transform, tint);
  };
  const quad = (surface: Surface, a: Vector3, b: Vector3, c: Vector3, d: Vector3, tint = 1): void => {
    colour.set(PALETTE[surface]).multiplyScalar(tint);
    for (const vertices of [
      [a, b, c],
      [a, c, d],
    ]) {
      const n = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
      for (const p of vertices) {
        out.positions.push(p.x, p.y, p.z);
        out.normals.push(n.x, n.y, n.z);
        out.colours.push(colour.r, colour.g, colour.b);
      }
    }
  };
  const facade = (width: number, height: number, openings: Opening[], cx: number, cz: number, turn = 0): void => {
    const xs = [-width / 2, width / 2, ...openings.flatMap((o) => [o.left, o.right])].sort((a, b) => a - b);
    const ys = [0, height, ...openings.flatMap((o) => [o.bottom, o.top])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < ys.length - 1; j++) {
        const x = (xs[i] + xs[i + 1]) / 2;
        const y = (ys[j] + ys[j + 1]) / 2;
        if (xs[i + 1] - xs[i] < 1e-8 || ys[j + 1] - ys[j] < 1e-8 || openings.some((o) => x > o.left && x < o.right && y > o.bottom && y < o.top)) continue;
        const p = new Vector3(x, y, -0.14).applyAxisAngle(UP, turn).add(new Vector3(cx, 0, cz));
        box('plaster', p.x, p.y, p.z, xs[i + 1] - xs[i], ys[j + 1] - ys[j], 0.28, 1, turn);
      }
  };
  const windowFrame = (x: number, y: number, z: number, width: number, height: number, turn = 0): void => {
    const at = (dx: number, dy: number, dz: number): Vector3 => new Vector3(dx, dy, dz).applyAxisAngle(UP, turn).add(new Vector3(x, y, z));
    const part = (surface: Surface, dx: number, dy: number, dz: number, w: number, h: number, d: number, tint = 1): void => {
      const p = at(dx, dy, dz);
      box(surface, p.x, p.y, p.z, w, h, d, tint, turn);
    };
    part('shadow', 0, 0, -0.2, width, height, 0.035);
    part('timber', -width / 2, 0, 0.015, 0.1, height + 0.16, 0.13);
    part('timber', width / 2, 0, 0.015, 0.1, height + 0.16, 0.13);
    part('timber', 0, height / 2, 0.015, width, 0.1, 0.13);
    part('stone', 0, -height / 2 - 0.04, 0.055, width + 0.22, 0.12, 0.26);
    for (const fraction of [-0.25, 0, 0.25]) part('timber', fraction * width, 0, -0.015, 0.04, height, 0.07, 0.92);
    for (const fraction of [-0.23, 0.18]) part('timber', 0, fraction * height, -0.015, width, 0.045, 0.07, 0.92);
    // (small tilted shutters give the windows depth at oblique views)
    const shutter = at(-width / 2 - 0.19, 0, 0.04);
    box('timber', shutter.x, shutter.y, shutter.z, 0.25, height, 0.09, 1.12, turn - 0.16);
  };
  const roof = (cx: number, cz: number, length: number, halfDepth: number, eave: number, ridge: number, turn = 0): void => {
    const columns = Math.ceil(length / 0.28);
    const rows = 10;
    const w = length / columns;
    const at = (x: number, t: number, side: number, lift = 0): Vector3 => {
      const y = ridge - (ridge - eave + 0.16) * t + 0.16 * t * t * t + lift;
      return new Vector3(x, y, side * t * halfDepth).applyAxisAngle(UP, turn).add(new Vector3(cx, 0, cz));
    };
    for (const side of [-1, 1])
      for (let column = 0; column < columns; column++)
        for (let row = 0; row < rows; row++) {
          const x = -length / 2 + column * w;
          const t0 = row / rows;
          const t1 = (row + 1) / rows;
          const tint = 0.88 + ((column * 13 + row * 7) % 11) * 0.021;
          // (three facets across each tile make its shallow channel; a row's raised nose is part of its surface)
          for (let facet = 0; facet < 3; facet++) {
            const u0 = facet / 3;
            const u1 = (facet + 1) / 3;
            const arc0 = Math.sin(u0 * Math.PI) * 0.045;
            const arc1 = Math.sin(u1 * Math.PI) * 0.045;
            const a = at(x + w * u0, t0, side, arc0);
            const b = at(x + w * u1, t0, side, arc1);
            const c = at(x + w * u1, t1, side, arc1 + 0.025);
            const d = at(x + w * u0, t1, side, arc0 + 0.025);
            if (side === 1) quad('tile', b, a, d, c, tint);
            else quad('tile', a, b, c, d, tint);
            const c0 = at(x + w * u1, t1, side, arc1);
            const d0 = at(x + w * u0, t1, side, arc0);
            if (side === 1) quad('tile', d, c, c0, d0, tint * 0.8);
            else quad('tile', c, d, d0, c0, tint * 0.8);
          }
        }
    const ridgeA = new Vector3(-length / 2 - 0.04, ridge + 0.09, 0).applyAxisAngle(UP, turn).add(new Vector3(cx, 0, cz));
    const ridgeB = new Vector3(length / 2 + 0.04, ridge + 0.09, 0).applyAxisAngle(UP, turn).add(new Vector3(cx, 0, cz));
    beam('tile', ridgeA, ridgeB, 0.2, 0.22, 1.15);
    for (const side of [-1, 1]) beam('timber', at(-length / 2, 1, side, -0.07), at(length / 2, 1, side, -0.07), 0.13, 0.13, 0.8);
  };
  const gable = (x: number, z: number, base: number, width: number, peak: number, turn = 0): void => {
    // (the white fire wall rising in three steps over the tiled roof)
    const bounds = [-0.5, -0.32, -0.17, 0.17, 0.32, 0.5].map((v) => v * width);
    const drop = Math.min(1.55, (peak - base) * 0.68);
    const tops = [peak - drop, peak - drop * 0.53, peak, peak - drop * 0.53, peak - drop];
    for (let i = 0; i < 5; i++) {
      const middle = (bounds[i] + bounds[i + 1]) * 0.5;
      const length = bounds[i + 1] - bounds[i];
      const local = new Vector3(0, 0, middle).applyAxisAngle(UP, turn);
      box('plaster', x + local.x, (base + tops[i]) / 2, z + local.z, 0.26, tops[i] - base, length, 1, turn);
      box('tile', x + local.x, tops[i] + 0.055, z + local.z, 0.43, 0.11, length + 0.05, 1.03, turn);
      const end = new Vector3(0, 0, bounds[i] + 0.045).applyAxisAngle(UP, turn);
      box('tile', x + end.x, tops[i] + 0.12, z + end.z, 0.43, 0.12, 0.1, 0.92, turn);
    }
  };

  // the tall hall: its door and windows real holes, thick white walls on a low stone base
  const openings: Opening[] = [{ left: -0.9, right: 0.9, bottom: 0, top: 2.65 }];
  for (const x of [-2.8, 2.8]) openings.push({ left: x - 0.7, right: x + 0.7, bottom: 1.2, top: 2.5 });
  for (const x of [-2.8, 0, 2.8]) openings.push({ left: x - 0.7, right: x + 0.7, bottom: 3.55, top: 4.65 });
  facade(9, 5.2, openings, 0, 0);
  box('plaster', 0, 2.6, -4.88, 9, 5.2, 0.24);
  for (const x of [-4.38, 4.38]) box('plaster', x, 2.6, -2.5, 0.24, 5.2, 5);
  box('stone', 0, 0.17, -5.01, 9.1, 0.34, 0.16, 0.85);
  for (const x of [-4.52, 4.52]) box('stone', x, 0.17, -2.5, 0.14, 0.34, 5.1, 0.85);
  for (const x of [-2.8, 2.8]) windowFrame(x, 1.85, 0, 1.4, 1.3);
  for (const x of [-2.8, 0, 2.8]) windowFrame(x, 4.1, 0, 1.4, 1.1);
  box('shadow', 0, 1.3, -0.35, 1.8, 2.6, 0.06);
  for (const x of [-0.96, 0.96]) box('stone', x, 1.37, 0.02, 0.18, 2.74, 0.38, 0.95);
  box('stone', 0, 2.78, 0.03, 2.25, 0.25, 0.46, 1.1);
  box('timber', 0, 2.55, -0.035, 1.8, 0.13, 0.19);
  for (const side of [-1, 1]) {
    const x = side * 0.46;
    box('timber', x, 1.28, -0.23, 0.86, 2.48, 0.12, side === 1 ? 1.04 : 0.95, side === 1 ? -0.075 : 0);
    for (let i = 0; i < 4; i++) box('timber', x - 0.31 + i * 0.2, 1.28, -0.151, 0.025, 2.38, 0.025, 1.2);
    box('timber', x, 0.72, -0.13, 0.72, 0.065, 0.05, 0.8);
    box('timber', x, 1.93, -0.13, 0.72, 0.065, 0.05, 0.8);
    cylinder('stone', side * 0.14, 1.28, -0.09, 0.055, 0.1, 0.6);
  }
  box('stone', 0, 0.055, 0.2, 2.1, 0.11, 0.65, 1.08);
  roof(0, -2.5, 8.76, 2.82, 5.27, 7.06);
  gable(-4.5, -2.5, 5.15, 5.28, 7.48);
  gable(4.5, -2.5, 5.15, 5.28, 7.48);
  // a shallow awning over the door on two slender posts, under the main eaves
  for (const x of [-1.55, 1.55]) {
    box('timber', x, 1.42, 0.98, 0.12, 2.84, 0.12, 0.9);
    box('stone', x, 0.13, 0.98, 0.28, 0.26, 0.28, 0.92);
    beam('timber', new Vector3(x, 2.78, 0.92), new Vector3(x, 2.42, 0.52), 0.075, 0.075);
  }
  box('timber', 0, 2.82, 0.98, 3.32, 0.16, 0.14, 0.9);
  for (let i = 0; i < 12; i++) {
    const x = -1.72 + i * 0.286;
    quad('tile', new Vector3(x, 3.18, 0.1), new Vector3(x + 0.286, 3.18, 0.1), new Vector3(x + 0.286, 2.91, 1.23), new Vector3(x, 2.91, 1.23), 0.9 + (i % 3) * 0.06);
    beam('tile', new Vector3(x, 3.2, 0.1), new Vector3(x, 2.93, 1.23), 0.045, 0.045, 1.1);
  }

  // the lower west wing, opening onto the yard, its roof across the hall's
  const wingTurn = Math.PI / 2;
  facade(
    6,
    2.92,
    [
      { left: -1.95, right: -0.75, bottom: 1.1, top: 2.2 },
      { left: 0.45, right: 1.65, bottom: 0, top: 2.35 },
    ],
    -3,
    3,
    wingTurn,
  );
  box('plaster', -6.37, 1.46, 3, 0.24, 2.92, 6);
  for (const z of [0.12, 5.88]) box('plaster', -4.75, 1.46, z, 3.5, 2.92, 0.24);
  windowFrame(-3, 1.65, 4.35, 1.2, 1.1, wingTurn);
  box('shadow', -3.22, 1.12, 1.95, 0.04, 2.24, 1.2);
  box('timber', -3.12, 1.12, 1.95, 0.1, 2.24, 1.1, 1.06);
  for (const z of [1.35, 2.55]) box('timber', -2.99, 1.2, z, 0.13, 2.4, 0.1);
  box('timber', -2.99, 2.4, 1.95, 0.13, 0.12, 1.32);
  box('stone', -4.75, 0.16, 6.03, 3.6, 0.32, 0.13, 0.84);
  roof(-4.75, 3, 6.12, 1.78, 3.0, 4.18, wingTurn);
  gable(-4.75, 6.04, 2.92, 3.5, 4.58, wingTurn);

  // the yard's wall and its gate, two meters wide
  box('plaster', 5.18, 0.68, 3.2, 0.24, 1.36, 6.4, 0.97);
  box('tile', 5.18, 1.4, 3.2, 0.4, 0.13, 6.5, 0.94);
  box('plaster', 4.83, 0.68, 0.12, 0.7, 1.36, 0.24, 0.97);
  box('tile', 4.83, 1.4, 0.12, 0.75, 0.13, 0.4, 0.94);
  for (const [left, right] of [
    [-2.9, 1],
    [3, 5.3],
  ]) {
    box('plaster', (left + right) / 2, 0.68, 6.4, right - left, 1.36, 0.28, 0.97);
    box('tile', (left + right) / 2, 1.4, 6.4, right - left + 0.06, 0.13, 0.43, 0.98);
  }
  for (const x of [0.86, 3.14]) {
    box('plaster', x, 1.26, 6.4, 0.32, 2.52, 0.47, 1.02);
    box('stone', x, 0.15, 6.4, 0.42, 0.3, 0.56, 0.87);
  }
  box('plaster', 2, 2.45, 6.4, 2.1, 0.32, 0.42, 1.02);
  box('timber', 2, 2.27, 6.39, 2, 0.1, 0.25);
  roof(2, 6.4, 2.82, 0.57, 2.67, 3.02);
  // (its leaves opened inward, so the gate reads open from the fields)
  box('timber', 1.18, 1.06, 5.92, 0.12, 2.06, 0.95, 0.97, -0.12);
  box('timber', 2.83, 1.06, 5.92, 0.12, 2.06, 0.95, 1.05, 0.12);

  // a bench and two planted jars
  box('stone', 3.9, 0.56, 2.2, 1.6, 0.18, 0.52, 1.04);
  for (const x of [3.35, 4.45]) box('stone', x, 0.25, 2.2, 0.23, 0.5, 0.4, 0.87);
  for (const [x, z, r, h] of [
    [4.45, 5.25, 0.3, 0.56],
    [-2.25, 0.82, 0.24, 0.46],
  ]) {
    const pot = new CylinderGeometry(r, r * 0.62, h, 10, 1, true).toNonIndexed();
    transform.makeTranslation(x, h * 0.5, z);
    addGeometry('clay', pot, transform);
    pot.dispose();
    cylinder('clay', x, h - 0.025, z, r * 1.08, 0.09, 1.1);
    cylinder('shadow', x, h + 0.025, z, r * 0.82, 0.012, 0.85);
    for (let leaf = 0; leaf < 7; leaf++) {
      const angle = leaf * 2.399963;
      const reach = r * (1.2 + (leaf % 3) * 0.2);
      const top = h + 0.35 + (leaf % 3) * 0.09;
      const a = new Vector3(x, h + 0.03, z);
      const b = new Vector3(x + Math.cos(angle) * reach, top, z + Math.sin(angle) * reach);
      const side = new Vector3(-Math.sin(angle) * 0.075, 0, Math.cos(angle) * 0.075);
      quad('leaf', a, b.clone().add(side), b.clone().add(new Vector3(0, 0.15, 0)), b.clone().sub(side), 0.88 + (leaf % 3) * 0.09);
    }
  }
  boxTemplate.dispose();
  circleTemplate.dispose();
}

/**
 * Its footing (huiCottage.ts's courtyardFoundation, on the terraces' ground): the yard's paving (stones a meter square
 * of Tracy's, mortar between) at its floor, and round its edge stone courses down to the ground where it is lower and
 * up to it where it is higher. ground(x, z): the ground under a point of its frame, from its floor (m, Tracy's).
 */
function footing(out: Batch, ground: (x: number, z: number) => number, seed: number): void {
  const start = out.positions.length;
  const triangle = (a: Vector3, b: Vector3, c: Vector3, colour: Color): void => {
    out.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) out.colours.push(colour.r, colour.g, colour.b);
  };
  const cap = (x0: number, x1: number, z0: number, z1: number, colour: Color): void => {
    const a = new Vector3(x0, 0, z0);
    const b = new Vector3(x0, 0, z1);
    const c = new Vector3(x1, 0, z1);
    const d = new Vector3(x1, 0, z0);
    triangle(a, b, c, colour);
    triangle(a, c, d, colour);
  };
  const clip = (polygon: Vector3[], height: number, above: boolean): Vector3[] => {
    const result: Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      const pv = (p.y - height) * (above ? 1 : -1);
      const qv = (q.y - height) * (above ? 1 : -1);
      if (pv >= 0) result.push(p);
      if (pv * qv < 0) result.push(p.clone().lerp(q, pv / (pv - qv)));
    }
    return result;
  };
  const side = (x0: number, z0: number, x1: number, z1: number, colour: Color): void => {
    // (where the ground is lower than the floor, the yard's skirt down to it; where higher, a wall holding it back, up
    // to it: the terraces cut back to the footing's edge)
    const g0 = ground(x0, z0);
    const g1 = ground(x1, z1);
    const a = new Vector3(x0, Math.max(0, g0 + 0.05), z0);
    const b = new Vector3(x1, Math.max(0, g1 + 0.05), z1);
    const c = new Vector3(x1, Math.min(-0.1, g1 - 0.08), z1);
    const d = new Vector3(x0, Math.min(-0.1, g0 - 0.08), z0);
    const bottom = Math.min(c.y, d.y);
    const top = Math.max(a.y, b.y);
    const course = 0.32;
    for (let row = Math.floor(bottom / course); row < Math.ceil(top / course - 1e-9); row++) {
      const lo = row * course;
      const hi = Math.min(top, (row + 1) * course);
      const seam = Math.min(hi, lo + 0.018);
      const value = unit(hash32((seed ^ hash32(Math.round(x0 * 19 + z0 * 31) + row * 731)) >>> 0));
      for (const [low, high, tint] of [
        [lo, seam, 0.72],
        [seam, hi, 0.94 + value * 0.09],
      ]) {
        if (high - low < 1e-7) continue;
        const polygon = clip(clip([a, b, c, d], low, true), high, false);
        const stone = colour.clone().multiplyScalar(tint);
        for (let i = 1; i < polygon.length - 1; i++) triangle(polygon[0], polygon[i], polygon[i + 1], stone);
      }
    }
  };
  for (const { x0, x1, z0, z1 } of PAVING) {
    const columns = Math.ceil(x1 - x0);
    const rows = Math.ceil(z1 - z0);
    const width = (x1 - x0) / columns;
    const depth = (z1 - z0) / rows;
    const gap = 0.018;
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = x0 + column * width;
        const z = z0 + row * depth;
        const tint = unit(hash32((seed ^ hash32(row * 731 + column * 353)) >>> 0));
        cap(x + gap, x + width - gap, z + gap, z + depth - gap, STONE.clone().multiplyScalar(0.88 + tint * 0.17));
        cap(x, x + gap, z, z + depth, MORTAR);
        cap(x + width - gap, x + width, z, z + depth, MORTAR);
        cap(x + gap, x + width - gap, z, z + gap, MORTAR);
        cap(x + gap, x + width - gap, z + depth - gap, z + depth, MORTAR);
      }
  }
  // (the skirt sampled every half meter of the edge, so its foot follows the terraces' steps)
  for (let e = 0; e < EDGE.length; e++) {
    const [ax, az] = EDGE[e];
    const [bx, bz] = EDGE[(e + 1) % EDGE.length];
    const count = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    for (let i = 0; i < count; i++) {
      const t0 = i / count;
      const t1 = (i + 1) / count;
      side(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, STONE.clone().multiplyScalar(0.82));
    }
  }
  // (flat faces: each triangle's own normal)
  const p = out.positions;
  for (let i = start; i < p.length; i += 9) {
    const n = new Vector3(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]).cross(new Vector3(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2])).normalize();
    for (let k = 0; k < 3; k++) out.normals.push(n.x, n.y, n.z);
  }
}

/** The built terraces' highest surface along a direction near a place (a ray in from over them; triangles binned by where they lie). */
class Ground {
  private readonly bins = new Map<number, number[]>();
  private readonly tris: Array<[Float32Array | ArrayLike<number>, number, number, number]> = [];
  private readonly e1: Vector3;
  private readonly e2: Vector3;

  constructor(
    terraces: Group,
    private readonly centre: Vector3,
    private readonly R: number,
    reach: number,
  ) {
    this.e1 = new Vector3(0, 1, 0).cross(centre);
    if (this.e1.lengthSq() < 1e-8) this.e1.set(1, 0, 0);
    this.e1.normalize();
    this.e2 = centre.clone().cross(this.e1);
    for (const child of terraces.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      const g = mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere!;
      if (bs.center.clone().normalize().angleTo(centre) * R - bs.radius > reach) continue;
      const P = g.getAttribute('position').array;
      const index = g.index!.array;
      for (let i = 0; i < index.length; i += 3) {
        const [ax, ay] = this.flat(P, index[i]);
        const [bx, by] = this.flat(P, index[i + 1]);
        const [cx, cy] = this.flat(P, index[i + 2]);
        const x0 = Math.min(ax, bx, cx);
        const x1 = Math.max(ax, bx, cx);
        const y0 = Math.min(ay, by, cy);
        const y1 = Math.max(ay, by, cy);
        if (x1 < -reach || x0 > reach || y1 < -reach || y0 > reach) continue;
        const t = this.tris.length;
        this.tris.push([P, index[i], index[i + 1], index[i + 2]]);
        for (let X = Math.floor(x0 * 2); X <= Math.floor(x1 * 2); X++)
          for (let Y = Math.floor(y0 * 2); Y <= Math.floor(y1 * 2); Y++) {
            const k = (X + 4096) * 8192 + (Y + 4096);
            const bin = this.bins.get(k);
            if (bin) bin.push(t);
            else this.bins.set(k, [t]);
          }
      }
    }
  }

  /** A vertex's place on the plane tangent at the middle (m, gnomonic). */
  private flat(P: ArrayLike<number>, i: number): [number, number] {
    const x = P[3 * i];
    const y = P[3 * i + 1];
    const z = P[3 * i + 2];
    const f = (x * this.centre.x + y * this.centre.y + z * this.centre.z) / this.R;
    return [(x * this.e1.x + y * this.e1.y + z * this.e1.z) / f, (x * this.e2.x + y * this.e2.y + z * this.e2.z) / f];
  }

  /** The highest surface's height over the radius along a direction (m; −Infinity if none). */
  heightAt(d: Vector3): number {
    const f = d.dot(this.centre);
    const k = (Math.floor(((d.dot(this.e1) * this.R) / f) * 2) + 4096) * 8192 + (Math.floor(((d.dot(this.e2) * this.R) / f) * 2) + 4096);
    let top = Number.NEGATIVE_INFINITY;
    const o = d.clone().multiplyScalar(this.R + 100);
    const a = new Vector3();
    const e1 = new Vector3();
    const e2 = new Vector3();
    const p = new Vector3();
    const s = new Vector3();
    const q = new Vector3();
    const dir = d.clone().negate();
    for (const t of this.bins.get(k) ?? []) {
      const [P, i, j, l] = this.tris[t];
      a.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
      e1.set(P[3 * j] - a.x, P[3 * j + 1] - a.y, P[3 * j + 2] - a.z);
      e2.set(P[3 * l] - a.x, P[3 * l + 1] - a.y, P[3 * l + 2] - a.z);
      p.crossVectors(dir, e2);
      const det = e1.dot(p);
      if (Math.abs(det) < 1e-12) continue;
      s.subVectors(o, a);
      const u = s.dot(p) / det;
      if (u < 0 || u > 1) continue;
      q.crossVectors(s, e1);
      const v = dir.dot(q) / det;
      if (v < 0 || u + v > 1) continue;
      top = Math.max(top, 100 - e2.dot(q) / det);
    }
    return top;
  }
}

/** Its gate's opening in its yard's wall (Tracy's frame), and the steps down from it (m): each tread's depth, each step's rise at most. */
const GATE = { x0: 0.91, x1: 3.09, tread: 0.32, rise: 0.17 } as const;
/** Its path (m): its width, how high its top stands over the highest ground it crosses, the least step it takes, a point every so far. */
const PATH = { width: 1, over: 0.05, step: 0.1, every: 0.25 } as const;
/**
 * Its knoll (m): how far out from its footing's bounding rectangle it reaches (from … to, its outline wandering), how
 * far out it stays just under its floor (× that), how far under its floor it starts, how far under the terraces its
 * edge goes, its lip down under them at its edge, how much under it the terraces are sunk where it stands over them;
 * rays out from its middle and rings along them; its rocks.
 */
const KNOLL = { reach: [1.6, 3.2], shoulder: 0.22, below: 0.1, under: 0.2, lip: 0.45, sink: 0.06, rays: 192, rings: 10, rocks: 9 } as const;
/** The knoll's paint in the terraces' shader (terrace.frag.glsl): grass, its own part. */
const KNOLL_PART = 9;
const SINK = 128;
const ROCK_STONE = new Color('#878c83');
const ROCK_MOSS = new Color('#66784f');

/** A rock (Tracy's frame): a jittered twenty-sided stone, faceted, mossy on top. */
function rock(out: Batch, at: Vector3, size: Vector3, turn: number, seed: number): void {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  const key = (v: Vector3): number => hash32((Math.round(v.x * 1000) * 73856093) ^ (Math.round(v.y * 1000) * 19349663) ^ (Math.round(v.z * 1000) * 83492791) ^ seed) >>> 0;
  const v = new Vector3();
  const q = new Quaternion().setFromAxisAngle(UP, turn);
  const pts: Vector3[] = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = key(v);
    // (its foot flat and a little under the ground, its top rounded)
    const r = 0.78 + 0.34 * unit(k);
    const y = Math.max(v.y, -0.35);
    pts.push(new Vector3(v.x * r * size.x, (y + 0.35) * r * size.y, v.z * r * size.z).applyQuaternion(q).add(at));
  }
  g.dispose();
  const colour = new Color();
  for (let i = 0; i < pts.length; i += 3) {
    const [a, b, c] = [pts[i], pts[i + 1], pts[i + 2]];
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    colour.copy(ROCK_STONE).lerp(ROCK_MOSS, Math.min(Math.max((n.y - 0.45) / 0.35, 0), 1)).multiplyScalar(0.86 + 0.24 * unit(hash32((seed + i * 7919) >>> 0)));
    for (const w of [a, b, c]) {
      out.positions.push(w.x, w.y, w.z);
      out.normals.push(n.x, n.y, n.z);
      out.colours.push(colour.r, colour.g, colour.b);
    }
  }
}

/** A box of stone (Tracy's frame), from its bottom (y0) to its top (y1). */
function stoneBox(out: Batch, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, tint: number): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed().translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const colour = STONE.clone().multiplyScalar(tint);
  for (let i = 0; i < p.count; i++) {
    out.positions.push(p.getX(i), p.getY(i), p.getZ(i));
    out.normals.push(n.getX(i), n.getY(i), n.getZ(i));
    out.colours.push(colour.r, colour.g, colour.b);
  }
  g.dispose();
}

/** A smooth way through points (centripetal Catmull–Rom), a point every `every` m along it. */
function smoothWay(points: ReadonlyArray<readonly [number, number]>, every: number): Array<[number, number]> {
  const P = [points[0], ...points, points[points.length - 1]];
  const dense: Array<[number, number]> = [];
  for (let i = 1; i + 2 < P.length; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-4);
    const t1 = t(p0, p1);
    const t2 = t1 + t(p1, p2);
    const t3 = t2 + t(p2, p3);
    for (let k = 0; k < 24; k++) {
      const u = t1 + ((t2 - t1) * k) / 24;
      const lerp = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number): [number, number] => {
        const w = tb - ta < 1e-9 ? 0 : (u - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
      };
      const a1 = lerp(p0, p1, 0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      dense.push(lerp(b1, b2, t1, t2));
    }
  }
  dense.push([points[points.length - 1][0], points[points.length - 1][1]]);
  // (evenly along it)
  const out: Array<[number, number]> = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1];
    const [bx, bz] = dense[i];
    const l = Math.hypot(bx - ax, bz - az);
    let d = every - carry;
    while (d <= l) {
      out.push([ax + ((bx - ax) * d) / l, az + ((bz - az) * d) / l]);
      d += every;
    }
    carry = l - (d - every);
  }
  return out;
}

/**
 * The ground round its footing raised to it (Kai: as though the building grew from the land, not set on it): on rays
 * out from its footing's middle, from its bounding rectangle out to an outline that wanders, a shoulder just under its
 * floor and then a slope down under the terraces round it, a little uneven, so it shows where it stands over them and
 * the paddies and their dams come up round it where they are higher; the corners of the rectangle its footing leaves
 * (behind its wing, beside its hall) the shoulder's height. All in its frame (m).
 */
class Knoll {
  private readonly r0: Float64Array;
  private readonly w: Float64Array;
  /** Per ray, per ring: its height over R (m). */
  private readonly h: Float64Array;
  private readonly base: number;

  constructor(
    private readonly mx: number,
    private readonly mz: number,
    private readonly rect: Rect,
    private readonly paving: readonly Rect[],
    floor: number,
    ground: (x: number, z: number) => number,
    seed: number,
  ) {
    const K = KNOLL.rays;
    const J = KNOLL.rings;
    this.base = floor - KNOLL.below;
    this.r0 = new Float64Array(K);
    this.w = new Float64Array(K);
    this.h = new Float64Array(K * (J + 1));
    // (its outline: a few slow waves round it, each its own phase)
    const phase = [1, 2, 3, 5].map((k) => unit(hash32((seed + k * 7477) >>> 0)) * 6.2832);
    const amp = [0.5, 0.8, 0.5, 0.3];
    const wave = (t: number): number => [1, 2, 3, 5].reduce((sum, k, i) => sum + amp[i] * Math.sin(k * t + phase[i]), 0) / amp.reduce((a, b) => a + b, 0);
    // (the terraces' height smoothed: the middle of five a little apart, so its foot meets the paddies, not each dam)
    const smooth = (x: number, z: number): number => {
      const v = [ground(x, z), ground(x + 0.6, z), ground(x - 0.6, z), ground(x, z + 0.6), ground(x, z - 0.6)].sort((a, b) => a - b);
      return v[2];
    };
    const bump = (x: number, z: number): number => {
      const cx = Math.floor(x / 0.9);
      const cz = Math.floor(z / 0.9);
      const fx = x / 0.9 - cx;
      const fz = z / 0.9 - cz;
      const at = (i: number, j: number): number => unit(hash32((Math.imul(cx + i, 73856093) ^ Math.imul(cz + j, 19349663) ^ seed) >>> 0)) - 0.5;
      const sx = fx * fx * (3 - 2 * fx);
      const sz = fz * fz * (3 - 2 * fz);
      return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sz) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sz;
    };
    for (let k = 0; k < K; k++) {
      const t = (k / K) * 2 * Math.PI;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      this.r0[k] = this.exit(c, sn);
      this.w[k] = KNOLL.reach[0] + (KNOLL.reach[1] - KNOLL.reach[0]) * (0.5 + 0.5 * wave(t));
      // (its edge under the terraces there, so it goes down under them where it meets them, as a mound in the fields)
      const ex = mx + c * (this.r0[k] + this.w[k]);
      const ez = mz + sn * (this.r0[k] + this.w[k]);
      const end = Math.min(smooth(ex, ez), ground(ex, ez), ground(ex - c * 0.5, ez - sn * 0.5)) - KNOLL.under;
      for (let j = 0; j <= J; j++) {
        const u = j / J;
        const r = this.r0[k] + this.w[k] * u;
        const x = mx + c * r;
        const z = mz + sn * r;
        const e = u <= KNOLL.shoulder ? 0 : smoothstep01((u - KNOLL.shoulder) / (1 - KNOLL.shoulder));
        this.h[k * (J + 1) + j] = j === 0 ? this.base : this.base + (end - this.base) * e + 0.08 * bump(x, z) * 4 * e * (1 - e);
      }
    }
  }

  /** How far from its middle a ray (its way) leaves the bounding rectangle. */
  private exit(c: number, sn: number): number {
    const r = this.rect;
    let t = Number.POSITIVE_INFINITY;
    if (c > 1e-9) t = Math.min(t, (r.x1 - this.mx) / c);
    if (c < -1e-9) t = Math.min(t, (r.x0 - this.mx) / c);
    if (sn > 1e-9) t = Math.min(t, (r.z1 - this.mz) / sn);
    if (sn < -1e-9) t = Math.min(t, (r.z0 - this.mz) / sn);
    return t;
  }

  /** Its height at a point of its frame (m over R): its floor's on its paving, the shoulder's in the corners it leaves, its own out to its outline; null past it. */
  heightAt(x: number, z: number, floor: number): number | null {
    if (this.paving.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) return floor;
    const r = this.rect;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return this.base;
    const K = KNOLL.rays;
    const J = KNOLL.rings;
    const dx = x - this.mx;
    const dz = z - this.mz;
    let t = Math.atan2(dz, dx);
    if (t < 0) t += 2 * Math.PI;
    const fk = (t / (2 * Math.PI)) * K;
    const k0 = Math.floor(fk) % K;
    const k1 = (k0 + 1) % K;
    const a = fk - Math.floor(fk);
    const dist = Math.hypot(dx, dz);
    const at = (k: number): number | null => {
      const u = (dist - this.r0[k]) / this.w[k];
      if (u > 1) return null;
      const fj = Math.max(u, 0) * J;
      const j0 = Math.min(Math.floor(fj), J - 1);
      const b = fj - j0;
      return this.h[k * (J + 1) + j0] * (1 - b) + this.h[k * (J + 1) + j0 + 1] * b;
    };
    const h0 = at(k0);
    const h1 = at(k1);
    if (h0 === null || h1 === null) return null;
    return h0 * (1 - a) + h1 * a;
  }

  /** The highest the terraces may stand under its footing and where it stands over them, on a raster round it (m over R; far over the land elsewhere), and the raster's frame: its middle (x, z) and half its side (m). */
  sink(floor: number, ground: (x: number, z: number) => number): { data: Float32Array; frame: Vector4 } {
    let reach = 0;
    for (let k = 0; k < KNOLL.rays; k++) reach = Math.max(reach, this.r0[k] + this.w[k]);
    const half = reach + 0.5;
    const data = new Float32Array(SINK * SINK);
    for (let j = 0; j < SINK; j++)
      for (let i = 0; i < SINK; i++) {
        const x = this.mx + ((i + 0.5) / SINK - 0.5) * 2 * half;
        const z = this.mz + ((j + 0.5) / SINK - 0.5) * 2 * half;
        const onPaving = this.paving.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
        const h = this.heightAt(x, z, floor);
        // (the terraces sunk under its paving, and under it where it stands over them; where they are higher, theirs)
        data[j * SINK + i] = onPaving ? floor - 0.25 : h === null || h < ground(x, z) ? 1e4 : h - KNOLL.sink;
      }
    return { data, frame: new Vector4(this.mx, this.mz, half, 0) };
  }

  /** It as the terraces' build draws its ground (their attributes; its own paint, grass): its rays and rings, its lip down under the terraces round it, the two corners. */
  mesh(dirAt: (x: number, z: number) => Vector3, R: number): BufferGeometry {
    const K = KNOLL.rays;
    const J = KNOLL.rings;
    const positions: number[] = [];
    const parts: number[] = [];
    const floors: number[] = [];
    const index: number[] = [];
    const vertex = (x: number, z: number, h: number, part: number, slope: number): number => {
      const v = dirAt(x, z).multiplyScalar(R + h);
      positions.push(v.x, v.y, v.z);
      parts.push(part);
      floors.push(h, slope, 0, 0);
      return positions.length / 3 - 1;
    };
    const ring: number[][] = [];
    for (let k = 0; k < K; k++) {
      const t = (k / K) * 2 * Math.PI;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const row: number[] = [];
      for (let j = 0; j <= J; j++) {
        const r = this.r0[k] + this.w[k] * (j / J);
        const a = this.h[k * (J + 1) + Math.max(j - 1, 0)];
        const b = this.h[k * (J + 1) + Math.min(j + 1, J)];
        const slope = Math.abs(b - a) / ((Math.min(j + 1, J) - Math.max(j - 1, 0)) * (this.w[k] / J));
        row.push(vertex(this.mx + c * r, this.mz + sn * r, this.h[k * (J + 1) + j], KNOLL_PART, slope));
      }
      // (its lip: its edge again, and down under the terraces)
      const r = this.r0[k] + this.w[k];
      row.push(vertex(this.mx + c * r, this.mz + sn * r, this.h[k * (J + 1) + J], PART.earth, 1));
      row.push(vertex(this.mx + c * r, this.mz + sn * r, this.h[k * (J + 1) + J] - KNOLL.lip, PART.earth, 1));
      ring.push(row);
    }
    for (let k = 0; k < K; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % K];
      for (let j = 0; j < J; j++) index.push(a[j], b[j], b[j + 1], a[j], b[j + 1], a[j + 1]);
      index.push(a[J + 1], b[J + 1], b[J + 2], a[J + 1], b[J + 2], a[J + 2]);
    }
    // the two corners its footing leaves in its rectangle, at the shoulder's height
    const r = this.rect;
    const p0 = this.paving[0];
    for (const [x0, x1] of [
      [r.x0, p0.x0],
      [p0.x1, r.x1],
    ]) {
      if (x1 - x0 < 1e-3) continue;
      const q = [vertex(x0, r.z0, this.base, KNOLL_PART, 0), vertex(x1, r.z0, this.base, KNOLL_PART, 0), vertex(x1, p0.z1, this.base, KNOLL_PART, 0), vertex(x0, p0.z1, this.base, KNOLL_PART, 0)];
      index.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('aPart', new Float32BufferAttribute(parts, 1));
    g.setAttribute('aPaddy', new BufferAttribute(new Uint8Array((positions.length / 3) * 4), 4, true));
    g.setAttribute('aFloor', new Float32BufferAttribute(floors, 4));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function smoothstep01(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
}

export class MuseHut {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** For the rice (riceData.frag.glsl): its site's up and its floor's radius (0: none), its x and z ways, its footing's two rectangles (m). */
  readonly uniforms: { uHutSite: IUniform<Vector4>; uHutX: IUniform<Vector4>; uHutZ: IUniform<Vector4>; uHutRects: IUniform<Vector4[]>; uHutSink: IUniform<DataTexture>; uHutSinkFrame: IUniform<Vector4> };
  /** The highest the terraces may stand round it (terrace.vert.glsl: under its footing and its knoll; m over R). */
  private readonly sink = new DataTexture(new Float32Array(SINK * SINK).fill(1e4), SINK, SINK, RedFormat, FloatType);
  private site: { up: Vector3; x: Vector3; z: Vector3; radius: number; scale: number } | null = null;
  /** Its path's points (directions), to keep trees off it. */
  private pathDirs: Vector3[] = [];

  constructor(shared: Record<string, IUniform>) {
    this.uniforms = {
      uHutSite: { value: new Vector4(0, 1, 0, 0) },
      uHutX: { value: new Vector4(1, 0, 0, 0) },
      uHutZ: { value: new Vector4(0, 0, 1, 0) },
      uHutRects: { value: [new Vector4(), new Vector4()] },
      uHutSink: { value: this.sink },
      uHutSinkFrame: { value: new Vector4(0, 0, 1, 0) },
    };
    this.sink.needsUpdate = true;
    const material = new ShaderMaterial({ name: 'Muse hut', vertexShader, fragmentShader, uniforms: { ...shared, uMap: { value: null } }, vertexColors: true, side: DoubleSide });
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = 'Muse’s hut';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /**
   * Stand it on its site over the built terraces (planet radius R), or take it away (null). Out come its knoll and its
   * path (meshes of the terraces' own kind, for their build to draw: the knoll the woods' own ground; the path's top a
   * track's, its sides a dam's, its steps earth) and the trees by it (per tree: direction, ground, seed).
   */
  place(at: HutSite | null, terraces: Group, R: number, seed: number): { meshes: BufferGeometry[]; trees: Float32Array } {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new BufferGeometry();
    this.mesh.visible = false;
    this.site = null;
    this.pathDirs = [];
    this.uniforms.uHutSite.value.w = 0;
    const none = { meshes: [], trees: new Float32Array(0) };
    if (!at) return none;
    const s = at.scale;
    const middle = at.centre.clone().normalize();
    const x = at.xWay.clone().addScaledVector(middle, -at.xWay.dot(middle)).normalize();
    const z = x.clone().cross(middle);
    // (its own origin, the hall's front, from the footing's middle; its up the footing's)
    const up = middle.clone().multiplyScalar(R).addScaledVector(x, -MIDDLE[0] * s).addScaledVector(z, -MIDDLE[1] * s).normalize();
    x.addScaledVector(up, -x.dot(up)).normalize();
    z.crossVectors(x, up);
    const surface = new Ground(terraces, up, R, 30);
    // (a point of its frame, in meters, as a direction, on the plane over its floor as its mesh is laid; the built
    // ground's height there over R)
    let level = R;
    const dirAt = (mx: number, mz: number): Vector3 => up.clone().multiplyScalar(level).addScaledVector(x, mx).addScaledVector(z, mz).normalize();
    const terrain = (mx: number, mz: number): number => {
      const h = surface.heightAt(dirAt(mx, mz));
      return Number.isFinite(h) ? h : 0;
    };
    // its floor: the ground under its paving at its level among its heights (what is higher sunk under the paving:
    // terrace.vert.glsl; what is lower under its knoll), and a little
    const heights: number[] = [];
    for (const r of PAVING)
      for (let lx = r.x0; lx <= r.x1 + 1e-6; lx += 0.5 / s)
        for (let lz = r.z0; lz <= r.z1 + 1e-6; lz += 0.5 / s) {
          const h = surface.heightAt(dirAt(lx * s, lz * s));
          if (Number.isFinite(h)) heights.push(h);
        }
    if (heights.length === 0) return none;
    heights.sort((a, b) => a - b);
    const floor = heights[Math.floor(at.level * (heights.length - 1))] + 0.03;
    level = R + floor;
    // (a height over R in its frame, Tracy's meters from its floor)
    const lift = (h: number): number => (h - floor) / s;

    // its knoll: the ground round it raised to it, out to the terraces; the ground there, its own where it reaches
    const paving = PAVING.map((r) => ({ x0: r.x0 * s, x1: r.x1 * s, z0: r.z0 * s, z1: r.z1 * s }));
    const rect = { x0: paving[1].x0, x1: Math.max(paving[0].x1, paving[1].x1), z0: paving[0].z0, z1: paving[1].z1 };
    const knoll = new Knoll(MIDDLE[0] * s, MIDDLE[1] * s, rect, paving, floor, terrain, seed);
    // (what shows: the knoll where it stands over the terraces, theirs where they come up round it)
    const groundAt = (mx: number, mz: number): number => Math.max(knoll.heightAt(mx, mz, floor) ?? Number.NEGATIVE_INFINITY, terrain(mx, mz));
    const batch = new Batch();
    cottage(batch);
    // (its skirt now a stone plinth over the knoll's shoulder)
    footing(batch, (lx, lz) => lift(groundAt(lx * s, lz * s)), seed);

    // the steps down from its gate to its path, as many as its drop asks for (none, where the knoll comes up to it)
    const gx = ((GATE.x0 + GATE.x1) / 2) * s;
    const edge = PAVING[1].z1 * s;
    const front = groundAt(gx, edge + 0.8) + PATH.over;
    const drop = floor - front;
    const steps = drop > 0.06 ? Math.ceil(drop / GATE.rise) - 1 : 0;
    const rise = drop / (steps + 1);
    for (let k = 1; k <= steps; k++) {
      const z0 = edge + (k - 1) * GATE.tread;
      const z1 = z0 + GATE.tread;
      const base = Math.min(groundAt(gx, z0), groundAt(gx, z1)) - 0.12;
      stoneBox(batch, GATE.x0 - 0.15, GATE.x1 + 0.15, z0 / s, z1 / s, lift(base), lift(floor - k * rise), 0.9 + 0.08 * unit(hash32((seed + k * 131) >>> 0)));
    }

    // its path: from the foot of its steps along its way to the nearest track (its nearest point to the way's end)
    const start: [number, number] = [gx, edge + steps * GATE.tread + 0.1];
    const way: Array<readonly [number, number]> = [start, ...at.path];
    const track = this.nearestTrack(terraces, up, x, z, level, way[way.length - 1]);
    if (track) way.push(track);
    const route = smoothWay(way, PATH.every);
    const path = this.pathMesh(route, dirAt, groundAt, R);
    const offPath = (px: number, pz: number, margin: number): boolean => route.every(([qx, qz]) => Math.hypot(px - qx, pz - qz) > PATH.width / 2 + margin);

    // rocks in clusters over the knoll, half buried, a few at its foot where it meets the paddies; none on its path
    let h = hash32((seed ^ 0x2f5a) >>> 0);
    const rnd = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
    const middle2 = [MIDDLE[0] * s, MIDDLE[1] * s];
    for (let c = 0; c < KNOLL.rocks; c++) {
      const t = rnd() * 2 * Math.PI;
      const foot = c < 3;
      const n = 1 + Math.floor(rnd() * (foot ? 2 : 4));
      for (let i = 0; i < n; i++) {
        const tt = t + (rnd() - 0.5) * 0.3;
        const cx = Math.cos(tt);
        const cz = Math.sin(tt);
        // (how far out, as a share of the knoll there: it reaches from its rectangle's edge to its outline)
        let lo = 0;
        let hi = 30;
        for (let it = 0; it < 30; it++) {
          const mid = (lo + hi) / 2;
          if (knoll.heightAt(middle2[0] + cx * mid, middle2[1] + cz * mid, floor) === null) hi = mid;
          else lo = mid;
        }
        const r0 = this.rectExit(middle2[0], middle2[1], rect, cx, cz);
        const share = foot ? 0.82 + 0.16 * rnd() : 0.3 + 0.45 * rnd();
        const dist = r0 + (lo - r0) * share;
        const px = middle2[0] + cx * dist;
        const pz = middle2[1] + cz * dist;
        if (!offPath(px, pz, 0.4)) continue;
        const w = foot ? 0.25 + 0.3 * rnd() : 0.18 + 0.42 * rnd();
        const tall = w * (0.55 + 0.35 * rnd());
        const g = groundAt(px, pz);
        rock(batch, new Vector3(px / s, lift(g - tall * 0.4), pz / s), new Vector3(w / s, tall / s, (w * (0.7 + 0.5 * rnd())) / s), rnd() * 6.283, (h = hash32(h + 17)));
      }
    }

    const g = this.mesh.geometry;
    g.setAttribute('position', new Float32BufferAttribute(batch.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(batch.normals, 3));
    g.setAttribute('color', new Float32BufferAttribute(batch.colours, 3));
    g.computeBoundingSphere();
    this.mesh.matrix.makeBasis(x, up, z).scale(new Vector3(s, s, s)).setPosition(up.clone().multiplyScalar(R + floor));
    this.mesh.matrixWorldNeedsUpdate = true;
    this.mesh.visible = true;
    this.site = { up, x, z, radius: R + floor, scale: s };
    this.uniforms.uHutSite.value.set(up.x, up.y, up.z, R + floor);
    this.uniforms.uHutX.value.set(x.x, x.y, x.z, 0);
    this.uniforms.uHutZ.value.set(z.x, z.y, z.z, 0);
    PAVING.forEach((r, i) => this.uniforms.uHutRects.value[i].set(r.x0 * s, r.x1 * s, r.z0 * s, r.z1 * s));
    const sink = knoll.sink(floor, terrain);
    (this.sink.image.data as Float32Array).set(sink.data);
    this.sink.needsUpdate = true;
    this.uniforms.uHutSinkFrame.value.copy(sink.frame);

    const trees: number[] = [];
    for (const [tx, tz, look] of at.trees) {
      const d = dirAt(tx, tz);
      trees.push(d.x, d.y, d.z, groundAt(tx, tz), look);
    }
    return { meshes: path ? [knoll.mesh(dirAt, R), path] : [knoll.mesh(dirAt, R)], trees: Float32Array.from(trees) };
  }

  /** How far from a point a ray leaves a rectangle (m). */
  private rectExit(mx: number, mz: number, r: Rect, c: number, sn: number): number {
    let t = Number.POSITIVE_INFINITY;
    if (c > 1e-9) t = Math.min(t, (r.x1 - mx) / c);
    if (c < -1e-9) t = Math.min(t, (r.x0 - mx) / c);
    if (sn > 1e-9) t = Math.min(t, (r.z1 - mz) / sn);
    if (sn < -1e-9) t = Math.min(t, (r.z0 - mz) / sn);
    return t;
  }

  /** The point of the nearest track to a point of its frame (m, its frame: its plane at radius `level`), within 30 m. */
  private nearestTrack(terraces: Group, up: Vector3, x: Vector3, z: Vector3, level: number, to: readonly [number, number]): [number, number] | null {
    const target = up.clone().multiplyScalar(level).addScaledVector(x, to[0]).addScaledVector(z, to[1]);
    let best = 30;
    let at: [number, number] | null = null;
    const v = new Vector3();
    for (const child of terraces.children) {
      const g = (child as Mesh).geometry;
      if (!g?.boundingSphere || g.boundingSphere.center.distanceTo(target) > g.boundingSphere.radius + best) continue;
      const P = g.getAttribute('position')?.array;
      const part = g.getAttribute('aPart')?.array;
      if (!P || !part) continue;
      for (let i = 0; i < part.length; i++) {
        if (part[i] !== PART.track) continue;
        v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
        const d = v.distanceTo(target);
        if (d >= best) continue;
        best = d;
        // (where it meets its frame's plane, as dirAt has it)
        const dn = v.clone().normalize();
        const t = level / dn.dot(up);
        at = [dn.dot(x) * t, dn.dot(z) * t];
      }
    }
    return at;
  }

  /**
   * Its path as the terraces' build draws a dam (its attributes): along its way (m, its frame, a point every
   * PATH.every), its top a little over the highest ground across it, held level until the ground has left it by a
   * step and then stepping to it; its sides down to the ground.
   */
  private pathMesh(way: Array<[number, number]>, dirAt: (mx: number, mz: number) => Vector3, groundAt: (mx: number, mz: number) => number, R: number): BufferGeometry | null {
    const n = way.length;
    if (n < 2) return null;
    const half = PATH.width / 2;
    const left = way.map((_, i) => {
      const a = way[Math.max(i - 1, 0)];
      const b = way[Math.min(i + 1, n - 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] as const;
    });
    const top: number[] = [];
    const foot: number[] = [];
    for (let i = 0; i < n; i++) {
      const [cx, cz] = way[i];
      const [lx, lz] = left[i];
      const tx = -lz;
      const tz = lx;
      let high = Number.NEGATIVE_INFINITY;
      let low = Number.POSITIVE_INFINITY;
      for (const a of [-1, -0.5, 0, 0.5, 1])
        for (const b of [-0.35, 0, 0.35]) {
          const g = groundAt(cx + lx * a * half + tx * b, cz + lz * a * half + tz * b);
          high = Math.max(high, g);
          if (b === 0 && Math.abs(a) === 1) low = Math.min(low, g);
        }
      const want = high + PATH.over;
      top.push(i > 0 && Math.abs(want - top[i - 1]) <= PATH.step ? top[i - 1] : want);
      foot.push(low - 0.12);
    }
    const positions: number[] = [];
    const parts: number[] = [];
    const corner = (i: number, side: number, height: number): Vector3 => {
      const [cx, cz] = way[i];
      const [lx, lz] = left[i];
      return dirAt(cx + lx * side * half, cz + lz * side * half).multiplyScalar(R + height);
    };
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, part: number): void => {
      for (const v of [a, b, c, a, c, d]) positions.push(v.x, v.y, v.z);
      for (let k = 0; k < 6; k++) parts.push(part);
    };
    for (let i = 0; i + 1 < n; i++) {
      const t = top[i];
      // its top, then its two sides down to the ground, at this point's height
      quad(corner(i, 1, t), corner(i, -1, t), corner(i + 1, -1, t), corner(i + 1, 1, t), PART.track);
      quad(corner(i, 1, t), corner(i + 1, 1, t), corner(i + 1, 1, foot[i + 1]), corner(i, 1, foot[i]), PART.riser);
      quad(corner(i, -1, t), corner(i, -1, foot[i]), corner(i + 1, -1, foot[i + 1]), corner(i + 1, -1, t), PART.riser);
      // (a step where the next point's height is another)
      if (top[i + 1] !== t) quad(corner(i + 1, 1, t), corner(i + 1, -1, t), corner(i + 1, -1, top[i + 1]), corner(i + 1, 1, top[i + 1]), PART.earth);
      this.pathDirs.push(dirAt(way[i][0], way[i][1]));
    }
    this.pathDirs.push(dirAt(way[n - 1][0], way[n - 1][1]));
    const count = positions.length / 3;
    const normals = new Float32Array(positions.length);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i < count; i += 3) {
      a.fromArray(positions, 3 * i);
      b.fromArray(positions, 3 * i + 3);
      c.fromArray(positions, 3 * i + 6);
      const nn = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      for (let k = 0; k < 3; k++) nn.toArray(normals, 3 * (i + k));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('aPart', new Float32BufferAttribute(parts, 1));
    geometry.setAttribute('aPaddy', new BufferAttribute(new Uint8Array(count * 4), 4, true));
    geometry.setAttribute('aFloor', new Float32BufferAttribute(new Float32Array(count * 4), 4));
    geometry.setIndex(Array.from({ length: count }, (_, i) => i));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Whether a direction lies on its footing, or within `margin` m of it. */
  covers(d: Vector3, margin: number): boolean {
    const site = this.site;
    if (!site) return false;
    const f = d.dot(site.up);
    if (f < 0.9) return false;
    // (where it meets the floor's plane, in Tracy's meters, the margin with them)
    const lx = (site.radius * d.dot(site.x)) / f / site.scale;
    const lz = (site.radius * d.dot(site.z)) / f / site.scale;
    const m = margin / site.scale;
    return PAVING.some((r) => lx > r.x0 - m && lx < r.x1 + m && lz > r.z0 - m && lz < r.z1 + m);
  }

  /** Records (each `stride` numbers, its direction first) less those within `margin` m of its footing, and of its path (unless `path` is false). */
  clear(records: Float32Array, stride: number, margin: number, R: number, path = true): Float32Array {
    if (!this.site) return records;
    const keep: number[] = [];
    const d = new Vector3();
    const near = Math.cos((margin + PATH.width / 2) / R);
    for (let i = 0; i < records.length; i += stride) {
      d.set(records[i], records[i + 1], records[i + 2]);
      if (this.covers(d, margin) || (path && this.pathDirs.some((p) => p.dot(d) > near))) continue;
      for (let k = 0; k < stride; k++) keep.push(records[i + k]);
    }
    return Float32Array.from(keep);
  }
}
