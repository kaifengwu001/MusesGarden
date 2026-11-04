// A GLB as the home needs it: how big its model is as made (for its proportions on the floor), and its pictures
// drawn at most 512² so a new piece stays within the hut's GPU ledger (hut.ts books each picture at its TEXTURE_SIZE).
import sharp from 'sharp';

interface Json {
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
  buffers?: { byteLength: number; uri?: string }[];
}

const GLTF = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** The largest side a new piece's pictures keep (texels). */
export const PIECE_TEXTURE = 512;

function parse(glb: Buffer): { json: Json; bin: Buffer } {
  if (glb.length < 20 || glb.readUInt32LE(0) !== GLTF) throw new Error('not a GLB');
  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== JSON_CHUNK) throw new Error('a GLB without its JSON chunk');
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Json;
  const at = 20 + jsonLength;
  const bin = at + 8 <= glb.length && glb.readUInt32LE(at + 4) === BIN_CHUNK ? glb.subarray(at + 8, at + 8 + glb.readUInt32LE(at)) : Buffer.alloc(0);
  return { json, bin };
}

type M4 = number[];
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major, as glTF writes it. */
function multiply(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function local(node: NonNullable<Json['nodes']>[number]): M4 {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** The model's size as made (its scene's nodes' transforms applied to its meshes' position bounds). */
export function glbSize(glb: Buffer): { x: number; y: number; z: number } {
  const { json } = parse(glb);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: M4): void => {
    const node = json.nodes?.[index];
    if (!node) return;
    const m = multiply(parent, local(node));
    for (const p of node.mesh === undefined ? [] : (json.meshes?.[node.mesh]?.primitives ?? [])) {
      const a = json.accessors?.[p.attributes.POSITION];
      if (!a?.min || !a.max) continue;
      for (let k = 0; k < 8; k++) {
        const c = [k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]];
        for (let i = 0; i < 3; i++) {
          const v = m[i] * c[0] + m[4 + i] * c[1] + m[8 + i] * c[2] + m[12 + i];
          min[i] = Math.min(min[i], v);
          max[i] = Math.max(max[i], v);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, m);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENTITY);
  if (!Number.isFinite(min[0])) throw new Error('a GLB with no mesh bounds');
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** The GLB with every picture it holds drawn at most `size` a side (JPEG stays JPEG, the rest PNG); unchanged if none is larger. */
export async function shrinkTextures(glb: Buffer, size = PIECE_TEXTURE): Promise<Buffer> {
  const { json, bin } = parse(glb);
  const views = json.bufferViews ?? [];
  const replaced = new Map<number, Buffer>();
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) continue;
    const view = views[image.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const meta = await sharp(bytes).metadata();
    if ((meta.width ?? 0) <= size && (meta.height ?? 0) <= size) continue;
    const resized = sharp(bytes).resize(size, size, { fit: 'inside' });
    const jpeg = image.mimeType === 'image/jpeg';
    replaced.set(image.bufferView, await (jpeg ? resized.jpeg({ quality: 88 }) : resized.png()).toBuffer());
    if (!jpeg) image.mimeType = 'image/png';
  }
  if (replaced.size === 0) return glb;
  // lay the binary chunk out again, each view where it now falls (4-byte aligned, as accessors need)
  const parts: Buffer[] = [];
  let offset = 0;
  views.forEach((view, index) => {
    const bytes = replaced.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    parts.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length));
    offset += pad4(bytes.length);
  });
  if (json.buffers?.[0]) json.buffers[0].byteLength = offset;
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonChunk = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const binChunk = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLTF, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, body: Buffer): Buffer => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(body.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, body]);
  };
  return Buffer.concat([header, chunk(JSON_CHUNK, jsonChunk), chunk(BIN_CHUNK, binChunk)]);
}
