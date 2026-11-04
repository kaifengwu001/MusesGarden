import { rigSculpt, type ColourAt, type Sculpt } from './museMesh';

// A sculpt rigged on Muse's skeleton (museMesh.ts) off the main thread:
// refining, cutting and weighing it takes a moment, so no frame waits on it.
// In: how it is rigged (its entry in SCULPTS or DRESSED, or a made body's,
// museMesh.ts GENERATED with its own knobs), the sculpt's positions, normals,
// texture coordinates and triangles, and its paint's pixels (sRGB, RGBA);
// out: the rigged body's arrays.

interface Job {
  sculpt: Sculpt;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array | Uint32Array;
  paint: { width: number; height: number; data: Uint8ClampedArray } | null;
}

onmessage = (event: MessageEvent<Job>) => {
  const { sculpt, position, normal, uv, index, paint } = event.data;
  let colourAt: ColourAt | undefined;
  if (paint) {
    const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    colourAt = (u, v, out) => {
      const x = Math.min(paint.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * paint.width)));
      const y = Math.min(paint.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * paint.height)));
      const k = (y * paint.width + x) * 4;
      out[0] = linear(paint.data[k] / 255);
      out[1] = linear(paint.data[k + 1] / 255);
      out[2] = linear(paint.data[k + 2] / 255);
    };
  }
  const body = rigSculpt(position, normal, uv, index, colourAt, sculpt);
  postMessage(body, {
    transfer: [
      ...[body.position, body.normal, body.index, body.skinIndex, body.skinWeight, body.fur, body.open, body.colour].map((a) => a.buffer),
      ...[body.raise, body.raiseNormal, body.raiseOpen, body.hang, body.hangNormal, body.comb, body.cloth, body.uv].flatMap((a) => (a ? [a.buffer] : [])),
    ],
  });
};
