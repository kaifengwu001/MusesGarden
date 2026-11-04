// A body's GLB in Node: the maker's tag stripped (as tools/workflows/muse-rig/scripts/glbclean.py does), and its
// first mesh read with its paint, for rigging it here as the page's loader and worker do (museSculptLoader.ts,
// museSculpt.worker.ts).
import sharp from 'sharp';
import type { ColourAt } from '../../../src/life/museMesh';

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'

interface Gltf {
  asset: { generator?: string; [k: string]: unknown };
  nodes?: { name?: unknown }[];
  meshes?: { name?: unknown; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: { name?: unknown; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  images?: { name?: unknown; bufferView?: number; uri?: string; mimeType?: string }[];
  textures?: { source?: number }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  extensionsRequired?: string[];
}

/** The GLB's JSON and its binary chunk (empty if it has none). */
function split(glb: Buffer): { json: Gltf; bin: Buffer; version: number } {
  if (glb.length < 20 || glb.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB (no glTF header)');
  const version = glb.readUInt32LE(4);
  const length = glb.readUInt32LE(8);
  if (length !== glb.length) throw new Error(`a GLB of ${glb.length} bytes says it has ${length}`);
  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== JSON_CHUNK) throw new Error('a GLB whose first chunk is not its JSON');
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const at = 20 + jsonLength;
  const bin = at + 8 <= glb.length ? glb.subarray(at + 8, at + 8 + glb.readUInt32LE(at)) : Buffer.alloc(0);
  return { json, bin, version };
}

/**
 * The GLB's metadata cleaned as the sculpts' were: no generator in its asset, and its node, mesh, material and
 * image names tripo_* → model_*. The binary chunk is untouched (glbclean.py, ported).
 */
export function cleanGlb(glb: Buffer): Buffer {
  const { json, version } = split(glb);
  const jsonLength = glb.readUInt32LE(12);
  const rest = glb.subarray(20 + jsonLength);
  delete json.asset.generator;
  for (const key of ['nodes', 'meshes', 'materials', 'images'] as const) {
    for (const item of json[key] ?? []) {
      if (typeof item.name === 'string' && item.name.startsWith('tripo_')) item.name = `model_${item.name.slice('tripo_'.length)}`;
    }
  }
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(JSON_CHUNK, 16);
  return Buffer.concat([header, text, rest]);
}

/** Whether a GLB still names its maker (a generator, or tripo_* names). */
export function tagged(glb: Buffer): boolean {
  const { json } = split(glb);
  if (json.asset.generator !== undefined) return true;
  return (['nodes', 'meshes', 'materials', 'images'] as const).some((key) => (json[key] ?? []).some((item) => typeof item.name === 'string' && item.name.startsWith('tripo_')));
}

export interface GlbMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint16Array | Uint32Array;
  /** Its base colour image as stored (JPEG, PNG or WebP bytes), or null if it has none inside it. */
  readonly paint: Buffer | null;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** The first mesh's first primitive (the loader takes the first mesh it meets), its arrays copied out. */
export function readGlb(glb: Buffer): GlbMesh {
  const { json, bin } = split(glb);
  const unsupported = (json.extensionsRequired ?? []).filter((e) => e !== 'KHR_materials_unlit' && e !== 'KHR_texture_transform');
  if (unsupported.length) throw new Error(`the GLB needs ${unsupported.join(', ')}, which the rig can't read`);
  const prim = json.meshes?.[0]?.primitives[0];
  if (!prim) throw new Error('the GLB holds no mesh');
  const read = (i: number | undefined, what: string): Float32Array | Uint16Array | Uint32Array => {
    const a = i === undefined ? undefined : json.accessors?.[i];
    if (!a || a.bufferView === undefined) throw new Error(`the GLB's mesh has no ${what}`);
    const view = json.bufferViews?.[a.bufferView];
    if (!view) throw new Error(`the GLB's ${what} points at no data`);
    const width = COMPONENTS[a.type] ?? 1;
    const bytes = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 0;
    if (!bytes || (a.normalized && a.componentType !== 5126)) throw new Error(`the GLB's ${what} is stored in a form the rig can't read`);
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = view.byteStride && view.byteStride !== width * bytes ? view.byteStride : width * bytes;
    const n = a.count * width;
    // (byte and short indices both fit a Uint16Array)
    const out = a.componentType === 5126 ? new Float32Array(n) : a.componentType === 5125 ? new Uint32Array(n) : new Uint16Array(n);
    for (let e = 0; e < a.count; e++) {
      const at = start + e * stride;
      for (let c = 0; c < width; c++) {
        const p = at + c * bytes;
        out[e * width + c] = a.componentType === 5126 ? bin.readFloatLE(p) : a.componentType === 5125 ? bin.readUInt32LE(p) : a.componentType === 5123 ? bin.readUInt16LE(p) : bin.readUInt8(p);
      }
    }
    return out;
  };
  const position = read(prim.attributes.POSITION, 'positions');
  const normal = read(prim.attributes.NORMAL, 'normals');
  const uv = read(prim.attributes.TEXCOORD_0, 'texture coordinates');
  const index = read(prim.indices, 'triangles');
  if (!(position instanceof Float32Array) || !(normal instanceof Float32Array) || !(uv instanceof Float32Array) || index instanceof Float32Array) {
    throw new Error("the GLB's mesh is stored in a form the rig can't read");
  }
  return { position, normal, uv, index, paint: paintBytes(json, bin, prim.material) };
}

function paintBytes(json: Gltf, bin: Buffer, material: number | undefined): Buffer | null {
  const texture = material === undefined ? undefined : json.materials?.[material]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const source = texture === undefined ? 0 : json.textures?.[texture]?.source;
  const image = source === undefined ? undefined : json.images?.[source];
  if (!image || image.bufferView === undefined) return null;
  const view = json.bufferViews?.[image.bufferView];
  if (!view) return null;
  const start = view.byteOffset ?? 0;
  return Buffer.from(bin.subarray(start, start + view.byteLength));
}

/**
 * The paint as the worker samples it (museSculpt.worker.ts): drawn at most 1024 on a side, as the loader reads it
 * back (museSculptLoader.ts pixels), nearest texel, glTF's texture coordinates (v down from the top), linear.
 */
export async function paintAt(image: Buffer): Promise<ColourAt> {
  const meta = await sharp(image).metadata();
  const w = Math.min(1024, meta.width ?? 1024);
  const h = Math.min(1024, meta.height ?? 1024);
  const { data, info } = await sharp(image).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return (u, v, out) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const k = (y * info.width + x) * 4;
    out[0] = linear(data[k] / 255);
    out[1] = linear(data[k + 1] / 255);
    out[2] = linear(data[k + 2] / 255);
  };
}
