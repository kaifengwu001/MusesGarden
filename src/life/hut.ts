import {
  Box3,
  BufferGeometry,
  Matrix3,
  CustomBlending,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  Object3D,
  OneFactor,
  OneMinusSrcColorFactor,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  Vector4,
  type IUniform,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import rugUrl from '../assets/interior/rug.webp';
import { geometryBytes, gpuMemory } from '../core/gpuMemory';
import { Builder, COTTAGE, CUT, FLOOR, OUTER, wallAt, type Paint, type WallFace } from './props';
import fragmentShader from './hut.frag.glsl?raw';
import vertexShader from './hut.vert.glsl?raw';
import dotFragment from './hutDot.frag.glsl?raw';
import dotVertex from './hutDot.vert.glsl?raw';

// Muse's hut, inside (Kai's brief, 2026-11-01): a cozy, lived-in room under
// the cottage's roof, seen through the cutaway (view/cutaway.ts) with the
// roof lifted off and the walls cut, the front lower than the back. Dark
// plank floor and warm plaster walls (the room's shell, built here in the
// homestead's local meters and fitted to the walls as props.ts built them),
// the cut through the walls showing their rubble stone, the timber plates
// along their tops and the lintels over the door and the window; the
// furniture Kai made in Tripo (src/assets/interior: each model scaled to its
// height in meters, set square and stood in its place, against a wall or out
// on the floor), the rug from Kai's picture, the stove's fire and two small
// lamps lighting it (hut.frag.glsl). Along the left wall stands Muse's
// showpiece, a big display cabinet holding its favourites: a glowing dot
// (hutDot.vert.glsl) there opens the shelf's view, where a small white dot
// on each favourite opens its card as a find's does. Nothing here is drawn,
// or even loaded, before the cutaway first opens: the meadow outside draws
// exactly as before.

/** The room inside the walls (local m): half its width and depth (to the walls' inner faces), its floor and the walls' tops. */
export const ROOM = { x: COTTAGE.halfX - COTTAGE.thickness / 2, z: COTTAGE.halfZ - COTTAGE.thickness / 2, floor: FLOOR, top: COTTAGE.wall } as const;

type Wall = 'back' | 'left' | 'right' | 'front';
/** Which way a piece against each wall faces (rad about up: 0 faces the front, +z). */
const FACING: Record<Wall, number> = { back: 0, left: Math.PI / 2, right: -Math.PI / 2, front: Math.PI };

/** A light on a piece, where its model has one (a fraction of its box, as made: x across its front, y up, z from back to front), and how bright. */
interface Glow {
  at: readonly [number, number, number];
  strength: number;
}

export interface Piece {
  name: string;
  url: string;
  /** Its whole height (m): the model is scaled to it. */
  height: number;
  /** Its width across its front and its depth (m), when it is drawn out to them (else they follow its height). */
  width?: number;
  depth?: number;
  /** Mirrored across its front. */
  mirror?: boolean;
  /** A turn about up that sets it square first (rad): Tripo made a few askew. */
  square?: number;
  /**
   * Where it stands: its back against a wall, its middle `along` it (m from
   * the room's middle, +x or +z) and `gap` off it; turned (rad) into a corner,
   * against both its walls; or its footprint's middle (local m), turned.
   */
  place: { wall: Wall; along: number; gap?: number } | { corner: readonly [Wall, Wall]; turn: number; gap?: number } | { x: number; z: number; turn: number };
  /** Its foot over the floor (m): a shelf hung on the wall. */
  lift?: number;
  /** Its fire or its flame. */
  glow?: Glow & { kind: 'fire' | 'lamp' };
  /** Stands on the floor (it darkens the floor round its foot); not a shelf on a wall. */
  rests?: boolean;
  /** Muse's showpiece: its shelves hold the favourites, and it is never dissolved while you look at it. */
  showpiece?: boolean;
}

const model = (name: string): string => new URL(`../assets/interior/${name}.glb`, import.meta.url).href;

/** Degrees, as Kai's layout gives turns. */
const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * The furniture (Kai's Tripo models), as Kai laid it out in the layout
 * editor (2026-11-01; ui/garden/hutEditor.ts): each piece's foot's middle in
 * the room (m), its turn as it faces and its size. The hearth, big, in the
 * back wall left of the middle, the dish cabinet beyond it; the low shelf to
 * its right with the pots and pans hung over it; Muse's showpiece, a tall
 * display cabinet, along the left wall; the bed in the back corner on the
 * right, its head against the back wall; the table, low and wide, on the rug
 * in the middle of the room; the desk under the front window; the armchair
 * by the fire.
 */
export const PIECES: readonly Piece[] = [
  { name: 'wood-stove', url: model('wood-stove'), height: 2.69, place: { x: -0.55, z: -1.91, turn: 0 }, rests: true, glow: { kind: 'fire', at: [0.56, 0.2, 0.75], strength: 2.1 } },
  { name: 'wall-shelf', url: model('wall-shelf'), height: 1.32, place: { x: 1.9, z: -2.15, turn: 0 }, lift: 1.28 },
  { name: 'dish-cabinet', url: model('dish-cabinet'), height: 1.95, place: { x: -2.65, z: -1.95, turn: 0 }, rests: true },
  { name: 'display-shelf', url: model('display-shelf'), height: 1.62, place: { x: 1.9, z: -2.05, turn: 0 }, rests: true },
  { name: 'display-cabinet', url: model('display-cabinet'), height: 3.24, width: 2.75, place: { x: -3.64, z: -0.4, turn: deg(90) }, rests: true, showpiece: true },
  { name: 'dining-table', url: model('dining-table'), height: 1.03, width: 1.67, depth: 1.64, square: -0.133, place: { x: -1.2, z: 0, turn: 0 }, rests: true, glow: { kind: 'lamp', at: [0.5, 0.72, 0.5], strength: 0.55 } },
  { name: 'single-bed', url: model('single-bed'), height: 1.73, square: 0.538, place: { x: 3.05, z: -0.75, turn: 0 }, rests: true },
  { name: 'work-desk', url: model('work-desk'), height: 1.44, place: { x: -2.4, z: 1.6, turn: deg(180) }, rests: true, glow: { kind: 'lamp', at: [0.86, 0.86, 0.3], strength: 0.35 } },
  { name: 'woven-armchair', url: model('woven-armchair'), height: 1.0, place: { x: 1.65, z: -0.95, turn: deg(-127.2) }, lift: -0.02, rests: true },
];

/** The rug from Kai's picture (its fringe included), under the table, as Kai laid it: its middle, its length and width (m), its turn. */
const RUG = { x: -0.76, z: 0.01, length: 3.92, width: 2.11, turn: deg(7.3) } as const;
/** The pot on the hearth's stove (a fraction of the stove's box as made: across its front, up, back to front): Muse cooks at it. */
const POT_ON_STOVE = [0.47, 0.45, 0.6] as const;
/** The middle of the bed's mattress, on top (a fraction of the bed's box as made: Tripo made it askew, so not the box's middle): Muse sleeps there. */
const ON_THE_BED = [0.38, 0.47, 0.624] as const;
/** The favourites' places on the showpiece, as fractions of its front as made (x across, y up): three shelves of five. */
const COLUMNS = [0.14, 0.32, 0.5, 0.68, 0.86] as const;
const SLOTS: ReadonlyArray<readonly [number, number]> = [0.8, 0.59, 0.37].flatMap((y) => COLUMNS.map((x) => [x, y] as const));
/** How far the dots stand out in front of the shelves (m); the showpiece's own dot, how high on it (a share of its height). */
const DOT_OUT = 0.05;
const BEACON = { out: 0.12, up: 0.55 } as const;
/** The stove's fire as bright as it burns steady (it flickers about this). */
const FIRE = PIECES.find((p) => p.glow?.kind === 'fire')?.glow?.strength ?? 1;
/** At most this many things darken the floor round their feet (hut.frag.glsl RESTS). */
const RESTS = 12;
/** The models' pictures are drawn at this size (texels a side): plenty for the cutaway's distance. */
const TEXTURE_SIZE = 1024;
/** Which of the cottage's walls (props.ts walls(): the front, the right end, the back, the left end) is the back. */
const BACK = 2;
/** The timber in the cut (m): the plates along the tops of the back and end walls (width, height), the lintels over the front's door and window (depth, and how far each bears on the wall either side). */
const PLATE = { width: 0.17, height: 0.13 } as const;
const LINTEL = { depth: 0.15, bearing: 0.22 } as const;

/** The room's shell: the floor, the walls' inner faces (their openings cut through), the walls' cut tops, and the timber in the cut. */
function shell(faces: readonly WallFace[]): { floor: BufferGeometry; walls: BufferGeometry; tops: BufferGeometry; timber: BufferGeometry } {
  const t = COTTAGE.thickness;
  const up = new Vector3(0, 1, 0);
  // the floor, facing up: u along +x, v along -z from the front-left corner
  const floor = new Builder();
  const fx = new Vector3(1, 0, 0);
  const fz = new Vector3(0, 0, -1);
  const corner = new Vector3(-ROOM.x, ROOM.floor, ROOM.z);
  floor.face(fx, fz, 2 * ROOM.x, 2 * ROOM.z, (u, v, out) => out.copy(corner).addScaledVector(fx, u).addScaledVector(fz, v), (u, v): Paint => [Math.min(u, 2 * ROOM.x - u, v, 2 * ROOM.z - v), 0, 0, 0]);
  // the walls inside: facing in, from the floor to the top (hut.frag.glsl cuts them where the walls are cut), the
  // openings cut through (their reveals are props.ts's)
  const walls = new Builder();
  const tops = new Builder();
  const height = ROOM.top - ROOM.floor;
  faces.forEach((f, index) => {
    const inward = f.out.clone().negate();
    const back = f.along.clone().negate();
    const length = f.length - 2 * t;
    // u' runs from the inner right end (seen from outside) back toward its left: the face is wound to face in
    const toOuter = (u: number): number => f.length - t - u;
    const origin = f.start.clone().addScaledVector(f.along, f.length - t).addScaledVector(inward, t).setY(ROOM.floor);
    // (the back window is closed from inside: the hearth stands in front of it, as in Kai's mock-up; outside it stays a window)
    const openings = (index === BACK ? [] : f.openings).map((o) => ({ from: toOuter(o.to), to: toOuter(o.from), bottom: o.bottom - ROOM.floor, top: o.top - ROOM.floor }));
    const at = (u: number, v: number, out: Vector3): Vector3 => out.copy(origin).addScaledVector(back, u).addScaledVector(up, v);
    const paint = (u: number, v: number): Paint => {
      let edge = Math.min(u, length - u, v, height - v);
      for (const o of openings) edge = Math.min(edge, Math.hypot(Math.max(o.from - u, 0, u - o.to), Math.max(o.bottom - v, 0, v - o.top)));
      return [Math.max(edge, 0), Math.min(u, length - u), v, index];
    };
    const inside = (u: number, v: number): boolean => openings.some((o) => u > o.from && u < o.to && v > o.bottom && v < o.top);
    walls.face(back, up, length, height, at, paint, openings.flatMap((o) => [o.from, o.to]), openings.flatMap((o) => [o.bottom, o.top]), inside);
    // the cut, level at the wall's own height (props.ts CUT), from its outer face (as it leans and wobbles) in to the
    // room: the whole back takes both its corners, the whole left end its front one, the low front its right one
    const high = index >= 2;
    const y = high ? CUT.back : CUT.front;
    const ends = [index === BACK ? 0 : t, index === 1 ? f.length - t : f.length];
    const cols = Math.max(2, Math.ceil((ends[1] - ends[0]) / 0.2));
    tops.grid(cols, 1, (s, g) => {
      const u = ends[0] + (ends[1] - ends[0]) * s;
      const outer = wallAt(f, u, y, new Vector3());
      const inner = f.start.clone().addScaledVector(f.along, u).addScaledVector(inward, t).setY(y);
      return { p: outer.lerp(inner, g), n: up, u, v: g * t, paint: [0, 0, 0, 0] };
    });
  });
  // where a whole wall meets a low one, the whole one's end stands upright, cut through: the left end's over the
  // front, the back's over the right end (uv: up it, and in from the outer face)
  const step = CUT.back - CUT.front;
  const upright = (origin: Vector3, inward: Vector3, normal: Vector3): void => {
    // (the grid faces its first direction × its second: in, then up, or up, then in, whichever faces out)
    const inFirst = new Vector3().crossVectors(inward, up).dot(normal) > 0;
    tops.grid(2, 2, (a, b) => {
      const [across, rise] = inFirst ? [a, b] : [b, a];
      return { p: origin.clone().addScaledVector(inward, across * t).setY(CUT.front + rise * step), n: normal, u: rise * step, v: across * t, paint: [0, 0, 0, 1] };
    });
  };
  upright(new Vector3(-ROOM.x, 0, OUTER.z), new Vector3(0, 0, -1), new Vector3(1, 0, 0));
  upright(new Vector3(OUTER.x, 0, -ROOM.z), new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
  // the timber: a plate along the inner edge of each wall's cut top (the back's and the left end's high, the right
  // end's low), and a lintel over each of the front's openings, its top in the cut
  const timber = new Builder();
  const plate = (centre: Vector3, half: Vector3): void => timber.box(centre, half, null, ROOM.floor, 1);
  const w = PLATE.width / 2;
  const h = PLATE.height / 2;
  plate(new Vector3(0, CUT.back + h, -ROOM.z - w - 0.01), new Vector3(ROOM.x + 0.03, h, w));
  const leftRun = [-ROOM.z - PLATE.width, OUTER.z - 0.03];
  plate(new Vector3(-ROOM.x - w - 0.01, CUT.back + h, (leftRun[0] + leftRun[1]) / 2), new Vector3(w, h, (leftRun[1] - leftRun[0]) / 2));
  plate(new Vector3(ROOM.x + w + 0.01, CUT.front + h, 0), new Vector3(w, h, ROOM.z));
  const front = faces[0];
  for (const o of front.openings) {
    const x0 = front.start.x + o.from - LINTEL.bearing;
    const x1 = front.start.x + o.to + LINTEL.bearing;
    const top = CUT.front + 0.006;
    const zOut = OUTER.z - 0.02;
    const zIn = ROOM.z + 0.012;
    timber.box(new Vector3((x0 + x1) / 2, (o.top + top) / 2, (zOut + zIn) / 2), new Vector3((x1 - x0) / 2, (top - o.top) / 2, (zOut - zIn) / 2), null, ROOM.floor, 2);
  }
  return { floor: floor.build(), walls: walls.build(), tops: tops.build(), timber: timber.build() };
}

/** A model's geometry and picture, as loaded: one mesh, its parts merged, only what the room's shader reads. */
async function loadModel(url: string): Promise<{ geometry: BufferGeometry; map: Texture | null }> {
  const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/BufferGeometryUtils.js')]);
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  let map: Texture | null = null;
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh<BufferGeometry, MeshStandardMaterial>;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    g.applyMatrix4(mesh.matrixWorld);
    parts.push(g);
    map ??= mesh.material.map;
  });
  if (parts.length === 0) throw new Error(`${url} holds no mesh`);
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return { geometry, map: map ? await smaller(map) : null };
}

/** A picture drawn at TEXTURE_SIZE (Tripo's are 2048²), mipmapped, kept sharp at a slant. */
async function smaller(map: Texture): Promise<Texture> {
  const image = map.image as ImageBitmap | HTMLImageElement;
  if (typeof createImageBitmap === 'function' && image && image.width > TEXTURE_SIZE) {
    const bitmap = await createImageBitmap(image, { resizeWidth: TEXTURE_SIZE, resizeHeight: TEXTURE_SIZE, resizeQuality: 'high' });
    if ('close' in image) image.close();
    map.image = bitmap;
  }
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

/**
 * Fit a model to its piece: scaled to its height (drawn out to its width,
 * mirrored), set square, turned and stood in its place (local m). Returns the
 * transform, and the footprint it stands on (local m: middle x, z and half
 * sizes, square to the room).
 */
export function fit(piece: Piece, geometry: BufferGeometry): { matrix: Matrix4; footprint: Vector4 } {
  geometry.computeBoundingBox();
  const raw = geometry.boundingBox!.clone();
  const scale = piece.height / (raw.max.y - raw.min.y);
  const across = piece.width ? piece.width / (raw.max.x - raw.min.x) : scale;
  const deep = piece.depth ? piece.depth / (raw.max.z - raw.min.z) : scale;
  const turn = 'wall' in piece.place ? FACING[piece.place.wall] : piece.place.turn;
  const centre = raw.getCenter(new Vector3());
  const matrix = new Matrix4()
    .makeRotationY(turn + (piece.square ?? 0))
    .multiply(new Matrix4().makeScale(piece.mirror ? -across : across, scale, deep))
    .multiply(new Matrix4().makeTranslation(-centre.x, -raw.min.y, -centre.z));
  // where it lands once turned: stand it in its place
  const box = turnedBox(geometry, matrix);
  const p = piece.place;
  let x: number;
  let z: number;
  if ('corner' in p) {
    const gap = p.gap ?? 0;
    x = p.corner.includes('left') ? -ROOM.x + gap - box.min.x : ROOM.x - gap - box.max.x;
    z = p.corner.includes('back') ? -ROOM.z + gap - box.min.z : ROOM.z - gap - box.max.z;
  } else if ('wall' in p) {
    const gap = p.gap ?? 0;
    const mid = box.getCenter(new Vector3());
    if (p.wall === 'back') [x, z] = [p.along - mid.x, -ROOM.z + gap - box.min.z];
    else if (p.wall === 'front') [x, z] = [p.along - mid.x, ROOM.z - gap - box.max.z];
    else if (p.wall === 'left') [x, z] = [-ROOM.x + gap - box.min.x, p.along - mid.z];
    else [x, z] = [ROOM.x - gap - box.max.x, p.along - mid.z];
  } else {
    const mid = box.getCenter(new Vector3());
    [x, z] = [p.x - mid.x, p.z - mid.z];
  }
  matrix.premultiply(new Matrix4().makeTranslation(x, ROOM.floor + (piece.lift ?? 0), z));
  box.translate(new Vector3(x, ROOM.floor + (piece.lift ?? 0), z));
  const footprint = new Vector4((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, (box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2);
  return { matrix, footprint };
}

/** The box of a geometry's vertices under a transform (exact, not the turned box of its box). */
function turnedBox(geometry: BufferGeometry, matrix: Matrix4): Box3 {
  const box = new Box3();
  const p = new Vector3();
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) box.expandByPoint(p.fromBufferAttribute(position, i).applyMatrix4(matrix));
  return box;
}

/** A mirrored model's triangles wound the other way round, so its faces still face out. */
function rewind(geometry: BufferGeometry): void {
  const index = geometry.index;
  if (!index) return;
  for (let i = 0; i + 2 < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
}

/** A point given as a fraction of a model's box as made (x across its front, y up, z back to front), where the fitted model puts it (local m). */
function onModel(raw: Box3, matrix: Matrix4, at: readonly [number, number, number], out: Vector3): Vector3 {
  return out.set(raw.min.x + (raw.max.x - raw.min.x) * at[0], raw.min.y + (raw.max.y - raw.min.y) * at[1], raw.min.z + (raw.max.z - raw.min.z) * at[2]).applyMatrix4(matrix);
}

/** A set of glowing dots (hutDot.vert.glsl): how big on screen (a share of the view's height) and how bright. */
function dotMaterial(shared: Record<string, IUniform>, size: number, gain: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hut dots',
    vertexShader: dotVertex,
    fragmentShader: dotFragment,
    uniforms: { ...shared, uShown: { value: 0 }, uDotSize: { value: size }, uDotGain: { value: gain } },
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcColorFactor,
  });
}

export class HutInterior {
  /** In the homestead's frame (props.ts Homestead.group is its parent: world.ts). */
  readonly group = new Object3D();
  private readonly uniforms: Record<string, IUniform>;
  private readonly shellMeshes: Mesh[] = [];
  /** The showpiece's own dot (seen from the room), and a white dot on each favourite (seen at the shelf). */
  private readonly beacon: Points<BufferGeometry, ShaderMaterial>;
  private readonly dots: Points<BufferGeometry, ShaderMaterial>;
  private loading: Promise<void> | null = null;
  /** Every model in its place, once loaded. */
  loaded = false;
  /** The showpiece's cases as fitted: each box as made and its transform (the favourites' places are read off them). */
  private readonly showpiece: Array<{ raw: Box3; matrix: Matrix4 }> = [];
  /** The favourites' places on the shelves, in order along them (local m), once the showpiece is in. */
  private places: Vector3[] = [];
  /** Every piece and the rug as stood, with its handle for the layout editor. */
  private readonly placed: Placed[] = [];
  private favourites: readonly Favourite[] = [];
  private hovered = -1;
  private opened = -1;
  /** How open the cutaway is, 0 (not drawn) … 1. */
  private amount = 0;

  constructor(shared: Record<string, IUniform>, faces: readonly WallFace[]) {
    this.uniforms = {
      ...shared,
      uFire: { value: new Vector4(0, ROOM.floor + 0.35, -1.6, 0) },
      uLamps: { value: [new Vector4(0, ROOM.floor + 1, 0, 0), new Vector4(0, ROOM.floor + 1, 0, 0)] },
      uRest: { value: Array.from({ length: RESTS }, () => new Vector4()) },
      uRests: { value: 0 },
    };
    const parts = shell(faces);
    for (const [geometry, kind] of [
      [parts.floor, 0],
      [parts.walls, 1],
      [parts.tops, 2],
      [parts.timber, 5],
    ] as const) {
      const mesh = new Mesh(geometry, this.material(kind, null, { SHELL: '' }));
      mesh.frustumCulled = false;
      this.shellMeshes.push(mesh);
      this.group.add(mesh);
    }
    gpuMemory.set('hut room', this.shellMeshes.reduce((sum, m) => sum + geometryBytes(m.geometry), 0));
    this.beacon = new Points(new BufferGeometry(), dotMaterial(shared, 0.026, 1.0));
    this.dots = new Points(new BufferGeometry(), dotMaterial(shared, 0.011, 0.5));
    for (const p of [this.beacon, this.dots]) {
      p.frustumCulled = false;
      p.renderOrder = 2;
      this.group.add(p);
    }
    this.group.visible = false;
  }

  /** Fit the room to another cottage's walls (another seed's house leans and wobbles its own way). */
  refit(faces: readonly WallFace[]): void {
    const parts = shell(faces);
    [parts.floor, parts.walls, parts.tops, parts.timber].forEach((geometry, k) => {
      this.shellMeshes[k].geometry.dispose();
      this.shellMeshes[k].geometry = geometry;
    });
  }

  private material(kind: number, map: Texture | null, defines: Record<string, string> = {}, showpiece = false): ShaderMaterial {
    return new ShaderMaterial({
      name: `hut ${kind}`,
      vertexShader,
      fragmentShader,
      uniforms: { ...this.uniforms, uKind: { value: kind }, uMap: { value: map }, uShowpiece: { value: showpiece ? 1 : 0 }, uPlace: { value: new Matrix4() }, uPlaceNormal: { value: new Matrix3() } },
      defines: {
        RESTS,
        ROOM_X: ROOM.x.toFixed(4),
        ROOM_Z: ROOM.z.toFixed(4),
        CUT_FRONT: CUT.front.toFixed(4),
        CUT_BACK: CUT.back.toFixed(4),
        ...defines,
      },
    });
  }

  /** Load the furniture and the rug (once; the garden asks when the hut is near). */
  load(): Promise<void> {
    this.loading ??= this.loadAll();
    return this.loading;
  }

  private async loadAll(): Promise<void> {
    let bytes = 0;
    // (a model used twice is fetched once)
    const fetched = new Map<string, ReturnType<typeof loadModel>>();
    const fitted = await Promise.all(
      PIECES.map(async (piece) => {
        if (!fetched.has(piece.url)) fetched.set(piece.url, loadModel(piece.url));
        const { geometry: source, map } = await fetched.get(piece.url)!;
        const geometry = source.clone();
        geometry.computeBoundingBox();
        const raw = geometry.boundingBox!.clone();
        const { matrix } = fit(piece, geometry);
        geometry.applyMatrix4(matrix);
        if (piece.mirror) rewind(geometry);
        return { piece, geometry, map, raw, matrix };
      }),
    );
    const textures = new Set<Texture>();
    for (const { piece, geometry, map, raw, matrix } of fitted) {
      const scale = piece.height / (raw.max.y - raw.min.y);
      const across = piece.width ? piece.width / (raw.max.x - raw.min.x) : scale;
      const size = new Vector3((raw.max.x - raw.min.x) * across, piece.height, (raw.max.z - raw.min.z) * scale);
      // (the handle stands as the piece faces in the room, square to the hut: not turned by what sets a model square)
      const turn = 'wall' in piece.place ? FACING[piece.place.wall] : piece.place.turn;
      this.stand(piece.name, piece, geometry, this.material(3, map, { PLACED: '' }, piece.showpiece), size, turn, raw, matrix);
      bytes += geometryBytes(geometry);
      if (map) textures.add(map);
    }
    bytes += textures.size * TEXTURE_SIZE * TEXTURE_SIZE * 4 * 1.34;
    const rug = await new TextureLoader().loadAsync(rugUrl);
    rug.colorSpace = SRGBColorSpace;
    rug.anisotropy = 8;
    const g = new BufferGeometry();
    const y = ROOM.floor + 0.02;
    const [hx, hz] = [RUG.length / 2, RUG.width / 2];
    const corner = (sx: number, sz: number): number[] => {
      const p = new Vector3(sx * hx, y, sz * hz).applyAxisAngle(new Vector3(0, 1, 0), RUG.turn);
      return [RUG.x + p.x, y, RUG.z + p.z];
    };
    g.setAttribute('position', new Float32BufferAttribute([...corner(-1, 1), ...corner(1, 1), ...corner(1, -1), ...corner(-1, 1), ...corner(1, -1), ...corner(-1, -1)], 3));
    g.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    this.stand('rug', null, g, this.material(4, rug, { RUG: '', PLACED: '' }), new Vector3(RUG.length, 0, RUG.width), RUG.turn, null, null);
    bytes += 1024 * 594 * 4 * 1.34;
    gpuMemory.set('hut', bytes);
    this.loaded = true;
    this.refresh();
  }

  /** Stand a piece (or the rug) in the room: its mesh, and its handle at its foot's middle, turned as the piece faces. */
  private stand(name: string, piece: Piece | null, geometry: BufferGeometry, material: ShaderMaterial, size: Vector3, turn: number, raw: Box3 | null, matrix: Matrix4 | null): void {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    const box = new Box3().setFromBufferAttribute(geometry.attributes.position as Float32BufferAttribute);
    const handle = new Object3D();
    handle.name = name;
    handle.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    handle.rotation.y = turn;
    handle.updateMatrix();
    this.group.add(handle);
    const home = handle.matrix.clone();
    this.placed.push({ name, piece, handle, home, homeInverse: home.clone().invert(), box, size, raw, matrix, place: material.uniforms.uPlace as IUniform<Matrix4>, placeNormal: material.uniforms.uPlaceNormal as IUniform<Matrix3> });
  }

  /**
   * Read the pieces' handles again (the layout editor moved one, or they were just stood): each piece drawn where
   * its handle has it, its light with it, its shadow on the floor, and the favourites' places on the showpiece.
   */
  refresh(): void {
    const lamps = this.uniforms.uLamps.value as Vector4[];
    let lamp = 0;
    const rests: Vector4[] = [];
    this.showpiece.length = 0;
    const corner = new Vector3();
    const box = new Box3();
    for (const p of this.placed) {
      p.handle.updateMatrix();
      const delta = p.place.value.multiplyMatrices(p.handle.matrix, p.homeInverse);
      p.placeNormal.value.getNormalMatrix(delta);
      if (!p.piece || !p.raw || !p.matrix) continue;
      const now = delta.clone().multiply(p.matrix);
      if (p.piece.rests) {
        box.makeEmpty();
        for (let k = 0; k < 8; k++) box.expandByPoint(corner.set(k & 1 ? p.box.max.x : p.box.min.x, k & 2 ? p.box.max.y : p.box.min.y, k & 4 ? p.box.max.z : p.box.min.z).applyMatrix4(delta));
        rests.push(new Vector4((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, (box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2));
      }
      if (p.piece.glow) {
        const at = onModel(p.raw, now, p.piece.glow.at, new Vector3());
        if (p.piece.glow.kind === 'fire') (this.uniforms.uFire.value as Vector4).set(at.x, at.y, at.z, p.piece.glow.strength);
        else if (lamp < lamps.length) lamps[lamp++].set(at.x, at.y, at.z, p.piece.glow.strength);
      }
      if (p.piece.showpiece) this.showpiece.push({ raw: p.raw, matrix: now });
    }
    const rest = this.uniforms.uRest.value as Vector4[];
    rests.slice(0, RESTS).forEach((r, k) => rest[k].copy(r));
    this.uniforms.uRests.value = Math.min(rests.length, RESTS);
    this.placeFavourites();
    this.layDots();
  }

  /** Where the pot on the hearth's stove is (local m), as the stove stands now; null before it is in. */
  potAt(out: Vector3): Vector3 | null {
    const p = this.placed.find((e) => e.piece?.glow?.kind === 'fire');
    if (!p?.raw || !p.matrix) return null;
    return onModel(p.raw, new Matrix4().multiplyMatrices(p.place.value, p.matrix), POT_ON_STOVE, out);
  }

  /** Where Muse lies on its bed (local m: the mattress's middle, on top) and the way to the bed's foot (a unit direction, local), as the bed stands now; null before it is in. */
  bedAt(out: Vector3): { at: Vector3; foot: Vector3 } | null {
    const p = this.placed.find((e) => e.name === 'single-bed');
    if (!p?.raw || !p.matrix) return null;
    const at = onModel(p.raw, new Matrix4().multiplyMatrices(p.place.value, p.matrix), ON_THE_BED, out);
    const yaw = p.handle.rotation.y;
    return { at, foot: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)) };
  }

  /** The pieces and the rug as they stand, for the layout editor (ui/garden/hutEditor.ts). */
  get pieces(): readonly Placed[] {
    return this.placed;
  }

  /**
   * The layout as it stands, for pasting back (the editor's Export): each piece's foot's middle in the room (m: x
   * to the right, its lift off the floor, z toward the front), its turn (° about up as it faces in the room; 0 faces
   * the front, 90 the right end), its width, height and depth (m), and its scale from as laid out.
   */
  layout(): Array<{ name: string; at: [number, number, number]; turn: number; size: [number, number, number]; scale: [number, number, number] }> {
    const r = (v: number, d = 2): number => Number(v.toFixed(d));
    return this.placed.map((p) => {
      const h = p.handle;
      return {
        name: p.name,
        at: [r(h.position.x), r(h.position.y - ROOM.floor), r(h.position.z)],
        turn: r(((((h.rotation.y * 180) / Math.PI) % 360) + 540) % 360 - 180, 1),
        size: [r(p.size.x * h.scale.x), r(p.size.y * h.scale.y), r(p.size.z * h.scale.z)],
        scale: [r(h.scale.x, 3), r(h.scale.y, 3), r(h.scale.z, 3)],
      };
    });
  }

  /** The favourites' places along the showpiece's shelves: shelf by shelf, top first, from the back of the room to the front. */
  private placeFavourites(): void {
    const places: Array<{ p: Vector3; row: number }> = [];
    for (const s of this.showpiece) {
      const front = new Vector3(0, 0, 1).transformDirection(s.matrix);
      SLOTS.forEach(([fx, fy], k) => places.push({ p: onModel(s.raw, s.matrix, [fx, fy, 1], new Vector3()).addScaledVector(front, DOT_OUT), row: Math.floor(k / COLUMNS.length) }));
    }
    places.sort((a, b) => a.row - b.row || a.p.z - b.p.z);
    this.places = places.map((s) => s.p);
  }

  /** How open the cutaway is (0 … 1), and how far it has gone to the shelf (0 … 1): the room drawn from the first moment, the showpiece's dot once it is open, the favourites' dots at the shelf. */
  open(amount: number, shelf = 0): void {
    this.amount = amount;
    this.group.visible = amount > 0;
    (this.beacon.material.uniforms.uShown as IUniform<number>).value = amount * (1 - shelf);
    (this.dots.material.uniforms.uShown as IUniform<number>).value = amount * shelf;
  }

  get shown(): boolean {
    return this.amount > 0;
  }

  /** Each frame: the fire's flicker (world time, s). */
  update(time: number): void {
    if (!this.group.visible) return;
    const fire = this.uniforms.uFire.value as Vector4;
    const flicker = 1 + 0.1 * Math.sin(time * 11.3) + 0.07 * Math.sin(time * 6.1 + 1.3) + 0.05 * Math.sin(time * 17.9 + 0.4);
    fire.w = this.loaded ? FIRE * flicker : 0;
  }

  // ---- Muse's showpiece and its favourites ------------------------------------------------------------

  /** Muse's favourites, in the shelves' order: as many as they have places for. */
  setFavourites(favourites: readonly Favourite[]): void {
    this.favourites = favourites.slice(0, this.slots);
    this.layDots();
  }

  /** How many places the shelves have. */
  get slots(): number {
    return SLOTS.length * PIECES.filter((p) => p.showpiece).length;
  }

  /** Where the i-th favourite's dot stands (local m), or null before the showpiece is in. */
  slot(i: number, out: Vector3): Vector3 | null {
    const p = this.places[i];
    return p && i < this.favourites.length ? out.copy(p) : null;
  }

  /** Where the showpiece's own dot stands (local m), or null before it is in. */
  beaconAt(out: Vector3): Vector3 | null {
    if (this.showpiece.length === 0) return null;
    const box = this.showpieceBox(new Box3());
    return out.set(box.max.x + BEACON.out, box.min.y + (box.max.y - box.min.y) * BEACON.up, (box.min.z + box.max.z) / 2);
  }

  /** The showpiece's box (local m), as the cases stand. */
  showpieceBox(out: Box3): Box3 {
    out.makeEmpty();
    const corner = new Vector3();
    for (const s of this.showpiece) for (let k = 0; k < 8; k++) out.expandByPoint(corner.set(k & 1 ? s.raw.max.x : s.raw.min.x, k & 2 ? s.raw.max.y : s.raw.min.y, k & 4 ? s.raw.max.z : s.raw.min.z).applyMatrix4(s.matrix));
    return out;
  }

  /** The favourite's dot under the pointer and the one whose card is up (-1: none); and the showpiece's dot lit (under the pointer). */
  mark(hovered: number, opened: number, beacon = false): void {
    const b = this.beacon.geometry.getAttribute('aState') as Float32BufferAttribute | undefined;
    if (b && b.getX(0) !== (beacon ? 1 : 0)) {
      b.setXY(0, beacon ? 1 : 0, 0);
      b.needsUpdate = true;
    }
    if (hovered === this.hovered && opened === this.opened) return;
    this.hovered = hovered;
    this.opened = opened;
    const state = this.dots.geometry.getAttribute('aState') as Float32BufferAttribute | undefined;
    if (!state) return;
    for (let i = 0; i < state.count; i++) state.setXY(i, i === hovered ? 1 : 0, i === opened ? 1 : 0);
    state.needsUpdate = true;
  }

  private layDots(): void {
    const n = this.loaded ? Math.min(this.favourites.length, this.places.length) : 0;
    const position: number[] = [];
    const colour: number[] = [];
    const state: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = this.places[i];
      position.push(p.x, p.y, p.z);
      colour.push(0.95, 0.94, 0.9);
      state.push(i === this.hovered ? 1 : 0, i === this.opened ? 1 : 0);
    }
    const g = this.dots.geometry;
    g.setAttribute('position', new Float32BufferAttribute(position, 3));
    g.setAttribute('aColour', new Float32BufferAttribute(colour, 3));
    g.setAttribute('aState', new Float32BufferAttribute(state, 2));
    g.setDrawRange(0, n);
    // the showpiece's own dot: warm, a find's sphere's glow
    const at = this.beaconAt(new Vector3());
    const b = this.beacon.geometry;
    b.setAttribute('position', new Float32BufferAttribute(at && this.favourites.length > 0 ? [at.x, at.y, at.z] : [], 3));
    b.setAttribute('aColour', new Float32BufferAttribute(at && this.favourites.length > 0 ? [1.0, 0.82, 0.52] : [], 3));
    b.setAttribute('aState', new Float32BufferAttribute(at && this.favourites.length > 0 ? [0, 0] : [], 2));
    b.setDrawRange(0, at && this.favourites.length > 0 ? 1 : 0);
  }

  /** The materials to compile ahead of their first use. */
  get materials(): ShaderMaterial[] {
    const out: ShaderMaterial[] = [];
    this.group.traverse((o) => {
      const m = (o as Mesh).material;
      if (m instanceof ShaderMaterial && !out.includes(m)) out.push(m);
    });
    return out;
  }
}

/** A piece (or the rug) as it stands, for the layout editor: its handle, where it stood as laid out, its box and size then, and its model's box and transform (its light and the favourites' places are read off them). */
export interface Placed {
  readonly name: string;
  readonly piece: Piece | null;
  /** In the room at the piece's foot's middle, turned as it faces: move, turn or scale it and the piece goes with it (refresh). */
  readonly handle: Object3D;
  readonly home: Matrix4;
  readonly homeInverse: Matrix4;
  /** Its box as laid out (local m), its width, height and depth then (m). */
  readonly box: Box3;
  readonly size: Vector3;
  readonly raw: Box3 | null;
  readonly matrix: Matrix4 | null;
  readonly place: IUniform<Matrix4>;
  readonly placeNormal: IUniform<Matrix3>;
}

export interface Favourite {
  /** Its colour (linear RGB): its topic's flower's. */
  colour: readonly [number, number, number];
}
