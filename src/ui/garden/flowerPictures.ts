import { BufferAttribute, BufferGeometry, CustomBlending, DynamicDrawUsage, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Texture } from 'three';
import blueCluster from '../../assets/garden/flowers/blue-cluster-v1.png';
import pinkCup from '../../assets/garden/flowers/pink-cup-v1.png';
import whiteStar from '../../assets/garden/flowers/white-star-v1.png';
import yellowButton from '../../assets/garden/flowers/yellow-button-v1.png';
import { el } from './dom';

// The finds' flowers as the basket shows them: each species' hand-drawn picture, flat, drawn as the basket's own
// picture is (basketDrawing.ts). A picture stands on its flower's stem as the screen shows it: its stem's foot on the
// foot, its bloom on the head. Its head is drawn smaller than its stem's length alone would make it, so the fan's
// heads keep to their places, and its stem below the head is drawn longer to reach the foot.

/** A picture, measured from its alpha (its px, y down). */
export interface FlowerPicture {
  readonly src: string;
  /** Its visible part (alpha 8 of 255 and over) with a margin of nothing round it: left, top, right, bottom. */
  readonly box: readonly [number, number, number, number];
  /** The middle of its stem's end. */
  readonly foot: readonly [number, number];
  /** The row its head starts at: below it, only its stem. */
  readonly neck: number;
  /** Its head's middle (the centroid of its pixels), and its radius (nine tenths of them lie within it). */
  readonly bloom: readonly [number, number];
  readonly head: number;
}

/** By species, in flowerMeshes.ts's order. */
export const FLOWER_PICTURES: readonly FlowerPicture[] = [
  { src: pinkCup, box: [319, 41, 989, 1221], foot: [690.5, 1198], neck: 548, bloom: [656.8, 280.7], head: 262.6 },
  { src: whiteStar, box: [295, 58, 998, 1221], foot: [725, 1197], neck: 680, bloom: [652.3, 391.4], head: 262.9 },
  { src: yellowButton, box: [473, 215, 826, 1148], foot: [696.5, 1124], neck: 490, bloom: [649.3, 349.1], head: 146 },
  { src: blueCluster, box: [341, 69, 986, 1225], foot: [648.5, 1203], neck: 648, bloom: [657.2, 378.4], head: 288.6 },
];

/** A picture's head is drawn this much of the size its stem's length would give it. */
export const HEAD_SCALE = 0.7;
/** The least its stem is drawn of its length (a stem seen nearly end on). */
const LEAST_STRETCH = 0.2;
/** Its texture's longer side (px): about what the screen shows of it at its largest. */
const TEXTURE_SIDE = 512;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A picture standing on a stem from `foot` to `head` (screen px, y down) whose full length, unforeshortened, is
 * `stem` px, its head `scale` of the size that length would give it: where each of its points (its px) goes on the
 * screen.
 */
export function standPicture(p: FlowerPicture, foot: Point, head: Point, stem: number, scale = HEAD_SCALE): (x: number, y: number) => Point {
  const [fx, fy] = p.foot;
  // its own frame: from its foot, y up
  const bx = p.bloom[0] - fx;
  const by = fy - p.bloom[1];
  const ny = fy - p.neck;
  const k = (scale * stem) / Math.hypot(bx, by);
  const dx = head.x - foot.x;
  const dy = foot.y - head.y;
  const reach = Math.hypot(dx, dy) / Math.max(k, 1e-9);
  const rise = Math.sqrt(Math.max(reach * reach - bx * bx, 0));
  const stretch = Math.max(LEAST_STRETCH, (rise - (by - ny)) / ny);
  const lift = (y: number): number => (y < ny ? y * stretch : ny * stretch + y - ny);
  const turn = (reach > 1e-6 ? Math.atan2(dy, dx) : Math.PI / 2) - Math.atan2(lift(by), bx);
  const c = Math.cos(turn) * k;
  const s = Math.sin(turn) * k;
  return (x, y) => {
    const X = x - fx;
    const Y = lift(fy - y);
    return { x: foot.x + c * X - s * Y, y: foot.y - (s * X + c * Y) };
  };
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uPicture;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uPicture, vUv) * uAlpha;
}`;

/** The pictures' textures, empty until loadPictures fills them. */
export function pictureTextures(): Texture[] {
  return FLOWER_PICTURES.map(() => {
    const texture = new Texture();
    // premultiplied as it is uploaded, so its mipmaps blend its edges as the browser does
    texture.premultiplyAlpha = true;
    return texture;
  });
}

/** Each picture into its texture: its box only, scaled down once to what the screen shows of it; `loaded` as each is in. */
export function loadPictures(textures: readonly Texture[], loaded: (texture: Texture) => void): void {
  FLOWER_PICTURES.forEach((p, i) => {
    const image = el('img');
    image.onload = () => {
      const [left, top, right, bottom] = p.box;
      const w = right - left;
      const h = bottom - top;
      const k = Math.min(1, TEXTURE_SIDE / Math.max(w, h));
      const canvas = el('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      const g = canvas.getContext('2d');
      if (!g) return;
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, left, top, w, h, 0, 0, canvas.width, canvas.height);
      textures[i].image = canvas;
      textures[i].needsUpdate = true;
      loaded(textures[i]);
    };
    image.src = p.src;
  });
}

/** A flower's picture: a quad over its box, in two parts at its neck (its stem below is drawn longer), drawn flat. */
export function pictureMesh(p: FlowerPicture, texture: Texture): Mesh<BufferGeometry, ShaderMaterial> {
  const [, top, , bottom] = p.box;
  const neck = (bottom - p.neck) / (bottom - top);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(18), 3).setUsage(DynamicDrawUsage));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, neck, 1, neck, 0, 1, 1, 1]), 2));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uPicture: { value: texture }, uAlpha: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Stand a picture's mesh on its stem (standPicture): its corners on the screen (y up, as the stage's camera has it). */
export function standMesh(mesh: Mesh<BufferGeometry, ShaderMaterial>, p: FlowerPicture, foot: Point, head: Point, stem: number, scale = HEAD_SCALE): void {
  const at = standPicture(p, foot, head, stem, scale);
  const [left, top, right, bottom] = p.box;
  const position = mesh.geometry.getAttribute('position') as BufferAttribute;
  [bottom, p.neck, top].forEach((y, row) => {
    const a = at(left, y);
    const b = at(right, y);
    position.setXYZ(row * 2, a.x, -a.y, 0);
    position.setXYZ(row * 2 + 1, b.x, -b.y, 0);
  });
  position.needsUpdate = true;
}
