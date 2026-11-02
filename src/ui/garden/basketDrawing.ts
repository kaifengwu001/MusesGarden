import { CustomBlending, Group, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, ShaderMaterial, Texture } from 'three';
import picture from '../../assets/garden/orchard-basket-warm-brown.png';
import { el } from './dom';

// The basket as the rail's icon draws it: the hand-drawn picture, flat, in two layers of the one picture. The back
// layer is its inside and far rim, the front layer its front wall and near rim, split along the near rim's top
// edge; the flowers in the basket are drawn between the two, so the front wall hides them and they rise out over
// the near rim. Its colours are the picture's own, as the icon shows them.

/**
 * The picture, measured from its pixels (its px, y down): the rim from its rope's outer and inner edges down the
 * middle column and the opening's sides, the near rim's top edge traced column by column across the opening.
 */
export const DRAWING = {
  width: 1448,
  height: 1086,
  /** Its opaque part (alpha over a half). */
  content: { left: 46, top: 118, right: 1406, bottom: 1006 },
  /** The rim, along the middle of its rope: a circle of this radius about this middle, seen from `tilt` rad above its plane. */
  rim: { x: 730, y: 391, radius: 533, tilt: 0.446 },
  /**
   * The near rim's top edge: its row at evenly spaced columns from `from` to `to`, the ends of the opening. Below it
   * is the front; beside the opening (the rope's sides and the handles) the picture is all back, since whatever of
   * a flower shows there is outside the basket.
   */
  edge: {
    from: 230,
    to: 1256,
    rows: [
      389, 444, 466, 482, 487, 502, 519, 524, 533, 531, 537, 540, 553, 553, 557, 565, 566, 569, 569, 570, 573, 580, 577, 577, 576, 576, 576, 577, 572, 569, 568, 564, 564,
      556, 554, 554, 549, 543, 540, 529, 515, 511, 503, 483, 482, 466, 444, 389,
    ],
  },
} as const;

const EDGE_ROWS = DRAWING.edge.rows.length;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Every pixel of the picture falls in one layer, so with nothing between them the two draw it exactly once.
const fragmentShader = /* glsl */ `
uniform sampler2D uPicture;
uniform float uEdge[${EDGE_ROWS}];
uniform vec2 uSpan;
uniform float uFront;
varying vec2 vUv;
void main() {
  float u = (vUv.x - uSpan.x) / (uSpan.y - uSpan.x);
  float f = clamp(u, 0.0, 1.0) * ${(EDGE_ROWS - 1).toFixed(1)};
  int i = int(min(f, ${(EDGE_ROWS - 2).toFixed(1)}));
  float front = step(0.0, u) * step(u, 1.0) * step(mix(uEdge[i], uEdge[i + 1], f - float(i)), 1.0 - vUv.y);
  gl_FragColor = texture2D(uPicture, vUv) * mix(1.0 - front, front, uFront);
}`;

/** The basket's two layers: a group whose origin is the rim's middle, in px of the picture (y up), and its picture. */
export interface DrawingLayers {
  readonly group: Group;
  readonly back: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly front: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly texture: Texture;
}

export function drawingLayers(): DrawingLayers {
  const image = el('img');
  const texture = new Texture(image);
  // premultiplied as it is uploaded, so its mipmaps blend its edges as the browser does
  texture.premultiplyAlpha = true;
  image.onload = () => (texture.needsUpdate = true);
  image.src = picture;
  const { width, height, rim, edge } = DRAWING;
  const geometry = new PlaneGeometry(width, height).translate(width / 2 - rim.x, rim.y - height / 2, 0);
  const layer = (front: boolean): Mesh<PlaneGeometry, ShaderMaterial> => {
    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uPicture: { value: texture },
          uEdge: { value: edge.rows.map((row) => row / height) },
          uSpan: { value: [edge.from / width, edge.to / width] },
          uFront: { value: front ? 1 : 0 },
        },
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      }),
    );
    mesh.frustumCulled = false;
    return mesh;
  };
  const group = new Group();
  const back = layer(false);
  const front = layer(true);
  group.add(back, front);
  return { group, back, front, texture };
}
