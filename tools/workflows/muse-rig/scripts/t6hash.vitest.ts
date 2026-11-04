// The original Muse's rig (tpose6: the meadow's Muse, Momo's body) as one hash of every array rigSculpt returns,
// to prove a change to museMesh.ts leaves it byte for byte as it was. Run it before the change and after on the
// same machine, and compare the two TPOSE6 lines (at 0a177a8 the hash began 7417347f). A probe, not part of the
// suite: copy it into src/dev/invariants/ to run it from the repo's root, and delete the copy after.
//   cp tools/workflows/muse-rig/scripts/t6hash.vitest.ts src/dev/invariants/zz-t6hash.test.ts
//   npx vitest run src/dev/invariants/zz-t6hash.test.ts --silent=false | grep TPOSE6
//   rm src/dev/invariants/zz-t6hash.test.ts
import { createHash } from 'node:crypto';
import { it } from 'vitest';
import { rigSculpt, SCULPTS } from '../../life/museMesh';

const found = import.meta.glob<string>('/src/assets/muse/sculpt-tpose6.glb', { query: '?inline', import: 'default', eager: true });

it('tpose6 hash', () => {
  const url = found['/src/assets/muse/sculpt-tpose6.glb'];
  const text = atob(url.slice(url.indexOf(',') + 1));
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  const view = new DataView(b.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength)));
  const bin = 20 + jsonLength + 8;
  const size: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const read = (i: number) => {
    const a = json.accessors[i];
    const offset = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * size[a.type];
    const copy = b.buffer.slice(offset, offset + n * (a.componentType === 5123 ? 2 : 4));
    return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
  };
  const p = json.meshes[0].primitives[0];
  // a stand-in paint (a gradient), so the colours are exercised too
  const colourAt = (u: number, v: number, out: number[]) => {
    out[0] = 0.5 + 0.3 * (u % 1);
    out[1] = 0.4 + 0.2 * (v % 1);
    out[2] = 0.3;
  };
  const m = rigSculpt(read(p.attributes.POSITION) as Float32Array, read(p.attributes.NORMAL) as Float32Array, read(p.attributes.TEXCOORD_0) as Float32Array, read(p.indices) as Uint16Array, colourAt, SCULPTS.tpose6) as unknown as Record<string, ArrayLike<number> | undefined>;
  const h = createHash('sha256');
  for (const k of Object.keys(m).sort()) {
    const a = m[k];
    if (!a || typeof a !== 'object' || !('length' in a)) continue;
    h.update(k);
    h.update(new Uint8Array((a as Float32Array).buffer, (a as Float32Array).byteOffset, (a as Float32Array).byteLength));
  }
  console.log('TPOSE6', Object.keys(m).sort().join(','), h.digest('hex'));
}, 300000);
