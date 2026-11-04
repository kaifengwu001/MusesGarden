// The muses in clothes rigged in Node, a test each: how long it took, its size, its share of cloth, its face and
// its fit as measured, and with DUMP=<dir> the rigged mesh as <kind>.json (for holes.py). A probe, not part of the
// suite: copy it into src/dev/invariants/ to run it from the repo's root, and delete the copy after (it skips
// itself without PAINT_DIR, so another session's npm test meanwhile passes over it).
//   python3 -I tools/workflows/muse-rig/scripts/paint.py <paint-dir> src/assets/muse/muses/*.glb
//   cp tools/workflows/muse-rig/scripts/probe.vitest.ts src/dev/invariants/zz-rig-probe.test.ts
//   PAINT_DIR=<paint-dir> ONLY=5,11 npx vitest run src/dev/invariants/zz-rig-probe.test.ts --silent=false
//   rm src/dev/invariants/zz-rig-probe.test.ts
// ONLY takes kinds or numbers (muse5 or 5); without it every muse in DRESSED is rigged.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { DRESSED, rigSculpt, type DressedKind } from '../../life/museMesh';

const PAINT = process.env.PAINT_DIR ?? '';
const ONLY = (process.env.ONLY ? process.env.ONLY.split(',').map((k) => (k.startsWith('muse') ? k : `muse${k}`)) : Object.keys(DRESSED)) as DressedKind[];

function readGlb(file: string) {
  const b = new Uint8Array(readFileSync(file));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength)));
  const bin = 20 + jsonLength + 8;
  const size: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const read = (i: number) => {
    const a = json.accessors[i];
    const offset = b.byteOffset + bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * size[a.type];
    const copy = b.buffer.slice(offset, offset + n * (a.componentType === 5123 ? 2 : 4));
    return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
  };
  const p = json.meshes[0].primitives[0];
  return { position: read(p.attributes.POSITION) as Float32Array, normal: read(p.attributes.NORMAL) as Float32Array, uv: read(p.attributes.TEXCOORD_0) as Float32Array, index: read(p.indices) as Uint16Array | Uint32Array };
}

/** The muse's paint as rigSculpt reads it (linear), from paint.py's <kind>.rgba. */
function paint(kind: string) {
  const raw = new Uint8Array(readFileSync(resolve(PAINT, `${kind}.rgba`)));
  const header = new DataView(raw.buffer, raw.byteOffset);
  const w = header.getUint32(0, true);
  const h = header.getUint32(4, true);
  const data = raw.subarray(8);
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return (u: number, v: number, out: number[]) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * h)));
    const q = (y * w + x) * 4;
    out[0] = linear(data[q] / 255);
    out[1] = linear(data[q + 1] / 255);
    out[2] = linear(data[q + 2] / 255);
  };
}

const r = (a: readonly number[]) => a.map((v) => v.toFixed(3)).join(',');
const turns = (o: unknown) => JSON.stringify(o, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v));

for (const kind of ONLY) {
  (PAINT ? it : it.skip)(kind, () => {
    const g = readGlb(resolve('src/assets/muse/muses', `${kind}.glb`));
    const t0 = performance.now();
    const m = rigSculpt(g.position, g.normal, g.uv, g.index, paint(kind), DRESSED[kind]);
    const ms = performance.now() - t0;
    const n = m.position.length / 3;
    let cloth = 0;
    let top = 0;
    for (let i = 0; i < n; i++) {
      cloth += (m.cloth?.[i] ?? 0) > 0.5 ? 1 : 0;
      top = Math.max(top, m.position[i * 3 + 1]);
    }
    console.log(`${kind}: ${ms.toFixed(0)} ms, ${n} vertices, ${m.index.length / 3} triangles, cloth ${((100 * cloth) / n).toFixed(0)}%, top ${top.toFixed(3)} H`);
    if (m.features) console.log(`  face: eye ${r(m.features.eye)} mouth ${r(m.features.mouth)} blush ${r(m.features.blush)} plate ${r(m.features.plate)}`);
    else console.log('  no face found: its eyes were not (look at its pieces with glbinfo.py and splat.py)');
    const f = m.fit;
    if (f) {
      console.log(`  joints: upperL ${r(f.rest[5])} foreL ${r(f.rest[6])} upperR ${r(f.rest[7])} foreR ${r(f.rest[8])} legs ${r(f.rest[9])} / ${r(f.rest[10])} hand ${f.hand ? r(f.hand) : '-'}`);
      console.log(`  turns: hang ${turns(f.hang)} wave ${turns(f.wave)}`);
    }
    if (process.env.DUMP) writeFileSync(`${process.env.DUMP}/${kind}.json`, JSON.stringify({ position: [...m.position], index: [...m.index], cloth: [...(m.cloth ?? [])], fur: [...m.fur], skinIndex: [...m.skinIndex], skinWeight: [...m.skinWeight] }));
  }, 300000);
}
