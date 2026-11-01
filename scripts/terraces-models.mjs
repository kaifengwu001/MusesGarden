// The terraces' models (karst mountains and houses, Tripo exports Kai sent, kept out of git under
// reference/terraces/models/) made light enough for the planet: each simplified to two levels of detail
// (meshoptimizer, keeping its normals; collapsing across its texture's seams),
// stood on its base and scaled to a unit height, its colour texture resized (the other maps dropped: the
// planet shades them its own way), and written as one GLB with a node per level (lod0, lod1) to
// src/assets/terraces/: positions, normals and texture coordinates quantized (KHR_mesh_quantization, each
// node's translation and scale undoing the positions'), the vertices and indices compressed
// (EXT_meshopt_compression; three's GLTFLoader decodes them with MeshoptDecoder).
//   node scripts/terraces-models.mjs [name…]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/** Each model: its triangles at each level of detail and its texture's size. */
const MODELS = {
  mountain1: { lods: [36000, 7000], texture: 1024 },
  mountain2: { lods: [24000, 5000], texture: 1024 },
  mountain3: { lods: [24000, 5000], texture: 1024 },
  mountain4: { lods: [30000, 6000], texture: 1024 },
  mountain5: { lods: [26000, 5000], texture: 1024 },
  house1: { lods: [12000, 3000], texture: 1024 },
  house2: { lods: [12000, 3000], texture: 1024 },
  house3: { lods: [12000, 3000], texture: 1024 },
  house4: { lods: [12000, 3000], texture: 1024 },
  house5: { lods: [12000, 3000], texture: 1024 },
};

const SOURCE = 'reference/terraces/models';
const OUT = 'src/assets/terraces';

function readGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  const view = (i) => {
    const bv = json.bufferViews[i];
    return { bytes: bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride ?? 0 };
  };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (i) => {
    const a = json.accessors[i];
    const { bytes, stride } = view(a.bufferView);
    const n = SIZE[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    const step = stride || n * size;
    const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * n);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset ?? 0));
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < n; c++) {
        const o = k * step + c * size;
        out[k * n + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true) : dv.getUint8(o);
      }
    }
    return out;
  };
  const prim = json.meshes[0].primitives[0];
  const material = json.materials[prim.material];
  const image = json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
  return {
    position: accessor(prim.attributes.POSITION),
    normal: accessor(prim.attributes.NORMAL),
    uv: accessor(prim.attributes.TEXCOORD_0),
    index: accessor(prim.indices),
    image: { bytes: view(image.bufferView).bytes, mime: image.mimeType },
  };
}

/**
 * The mesh simplified to about `target` triangles (across the texture's seams too when `permissive`),
 * its vertices in the order its triangles first use them (they compress better), the unused dropped.
 */
function simplify(m, target, permissive) {
  const count = m.position.length / 3;
  const attrs = new Float32Array(count * 5);
  for (let k = 0; k < count; k++) {
    attrs.set(m.normal.subarray(3 * k, 3 * k + 3), 5 * k);
    attrs.set(m.uv.subarray(2 * k, 2 * k + 2), 5 * k + 3);
  }
  const [simple, error] = MeshoptSimplifier.simplifyWithAttributes(m.index, m.position, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, Math.min(target * 3, m.index.length), 0.2, permissive ? ['Permissive'] : []);
  const [remap, used] = MeshoptEncoder.reorderMesh(simple, true, true);
  const out = { position: new Float32Array(used * 3), normal: new Float32Array(used * 3), uv: new Float32Array(used * 2), index: simple, error };
  for (let k = 0; k < count; k++) {
    const r = remap[k];
    if (r === 0xffffffff) continue;
    out.position.set(m.position.subarray(3 * k, 3 * k + 3), 3 * r);
    out.normal.set(m.normal.subarray(3 * k, 3 * k + 3), 3 * r);
    out.uv.set(m.uv.subarray(2 * k, 2 * k + 2), 2 * r);
  }
  return out;
}

/** The colour texture resized (sips, macOS), as JPEG bytes. */
function resize(image, size) {
  const dir = mkdtempSync(join(tmpdir(), 'terraces-models-'));
  const src = join(dir, image.mime === 'image/png' ? 'in.png' : 'in.jpg');
  const dst = join(dir, 'out.jpg');
  writeFileSync(src, image.bytes);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(size), src, '--out', dst], { stdio: 'ignore' });
  return readFileSync(dst);
}

/** A level of detail quantized: positions as shorts over its bounds (a uniform scale), normals as bytes, texture coordinates as unsigned shorts. */
function quantize(m) {
  const count = m.position.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.position.length; k += 3) for (let c = 0; c < 3; c++) (min[c] = Math.min(min[c], m.position[k + c])), (max[c] = Math.max(max[c], m.position[k + c]));
  const centre = min.map((v, c) => (v + max[c]) / 2);
  const scale = Math.max(...max.map((v, c) => (v - min[c]) / 2), 1e-6);
  const position = new Int16Array(count * 4);
  const normal = new Int8Array(count * 4);
  const uv = new Uint16Array(count * 2);
  const qmin = [32767, 32767, 32767];
  const qmax = [-32767, -32767, -32767];
  for (let k = 0; k < count; k++) {
    for (let c = 0; c < 3; c++) {
      const q = Math.round(((m.position[3 * k + c] - centre[c]) / scale) * 32767);
      position[4 * k + c] = q;
      qmin[c] = Math.min(qmin[c], q);
      qmax[c] = Math.max(qmax[c], q);
      normal[4 * k + c] = Math.round(Math.max(-1, Math.min(1, m.normal[3 * k + c])) * 127);
    }
    for (let c = 0; c < 2; c++) uv[2 * k + c] = Math.round(Math.max(0, Math.min(1, m.uv[2 * k + c])) * 65535);
  }
  return { count, position, normal, uv, index: m.position.length / 3 < 65536 ? Uint16Array.from(m.index) : m.index, centre, scale, qmin, qmax };
}

/** A GLB of the levels of detail (a node each, named lod0, lod1…) sharing one textured material, quantized and compressed. */
function writeGlb(path, lods, jpeg) {
  const packed = [];
  let packedLength = 0;
  let fallbackLength = 0;
  const bufferViews = [];
  const accessors = [];
  const align = () => {
    const pad = (4 - (packedLength % 4)) % 4;
    if (pad) packed.push(Buffer.alloc(pad));
    packedLength += pad;
  };
  // a bufferView compressed into buffer 0 (its plain bytes in the fallback buffer 1, never loaded)
  const compressed = (data, count, stride, mode, target) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const enc = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    align();
    const offset = packedLength;
    packed.push(Buffer.from(enc));
    packedLength += enc.byteLength;
    fallbackLength = Math.ceil(fallbackLength / 4) * 4;
    const bv = { buffer: 1, byteOffset: fallbackLength, byteLength: bytes.byteLength, target, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: enc.byteLength, byteStride: stride, count, mode } } };
    if (mode === 'ATTRIBUTES') bv.byteStride = stride;
    fallbackLength += bytes.byteLength;
    bufferViews.push(bv);
    return bufferViews.length - 1;
  };
  const meshes = lods.map((q, l) => {
    const pos = compressed(q.position, q.count, 8, 'ATTRIBUTES', 34962);
    const nrm = compressed(q.normal, q.count, 4, 'ATTRIBUTES', 34962);
    const tex = compressed(q.uv, q.count, 4, 'ATTRIBUTES', 34962);
    const idx = compressed(q.index, q.index.length, q.index.BYTES_PER_ELEMENT, 'TRIANGLES', 34963);
    const at = accessors.length;
    accessors.push(
      { bufferView: pos, componentType: 5122, normalized: true, count: q.count, type: 'VEC3', min: q.qmin, max: q.qmax },
      { bufferView: nrm, componentType: 5120, normalized: true, count: q.count, type: 'VEC3' },
      { bufferView: tex, componentType: 5123, normalized: true, count: q.count, type: 'VEC2' },
      { bufferView: idx, componentType: q.index.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, count: q.index.length, type: 'SCALAR' },
    );
    return { name: `lod${l}`, primitives: [{ attributes: { POSITION: at, NORMAL: at + 1, TEXCOORD_0: at + 2 }, indices: at + 3, material: 0 }] };
  });
  align();
  const imageView = bufferViews.push({ buffer: 0, byteOffset: packedLength, byteLength: jpeg.byteLength }) - 1;
  packed.push(jpeg);
  packedLength += jpeg.byteLength;
  const json = {
    asset: { version: '2.0', generator: 'Muse’s Garden scripts/terraces-models.mjs' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: lods.map((_, l) => l) }],
    nodes: lods.map((q, l) => ({ name: `lod${l}`, mesh: l, translation: q.centre, scale: [q.scale, q.scale, q.scale] })),
    meshes,
    materials: [{ name: 'painted', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imageView, mimeType: 'image/jpeg' }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: packedLength }, { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20);
  const bin = Buffer.concat(packed);
  const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
  const total = 12 + 8 + jsonBytes.length + jsonPad.length + 8 + bin.length + binPad.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBytes.length + jsonPad.length, 0);
  jh.write('JSON', 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length + binPad.length, 0);
  bh.write('BIN\0', 4);
  writeFileSync(path, Buffer.concat([header, jh, jsonBytes, jsonPad, bh, bin, binPad]));
  return total;
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS);
for (const name of names) {
  const spec = MODELS[name];
  const m = readGlb(`${SOURCE}/${name}.glb`);
  // stood on its base (its lowest point at 0), centred over its middle, one unit tall
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.position.length; k += 3) for (let c = 0; c < 3; c++) (min[c] = Math.min(min[c], m.position[k + c])), (max[c] = Math.max(max[c], m.position[k + c]));
  const s = 1 / (max[1] - min[1]);
  const mid = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (let k = 0; k < m.position.length; k += 3) for (let c = 0; c < 3; c++) m.position[k + c] = (m.position[k + c] - mid[c]) * s;
  // (across the texture's seams too: Tripo's many small islands lock the simplifier otherwise, which then
  // stops far above its target or moves the surface a fifth of the model's size to reach it)
  const lods = spec.lods.map((t) => simplify(m, t, true));
  const bytes = writeGlb(`${OUT}/${name}.glb`, lods.map(quantize), resize(m.image, spec.texture));
  const tris = lods.map((l) => `${l.index.length / 3} (error ${l.error.toFixed(3)})`).join(' / ');
  console.log(`${name}: ${m.index.length / 3} triangles → ${tris}, ${(bytes / 1e6).toFixed(2)} MB, footprint ${((max[0] - min[0]) * s).toFixed(2)} × ${((max[2] - min[2]) * s).toFixed(2)} (height 1)`);
}
