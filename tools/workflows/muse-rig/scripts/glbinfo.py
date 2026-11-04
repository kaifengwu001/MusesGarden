# What's in a GLB: meshes, primitives, counts, bounds, materials, images; its pieces after welding
# (connected components), each with its vertex count and box in H (height-normalised, feet at 0,
# centred in x and z as rigSculpt does). Writes the base colour image next to `out` if asked.
#   python3 -I glbinfo.py file.glb [out-prefix]
import json
import struct
import sys

import numpy as np

path = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else None
data = open(path, 'rb').read()
magic, version, length = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'not a GLB'
off = 12
js = None
bin_ = None
while off < length:
    clen, ctype = struct.unpack('<II', data[off:off + 8])
    chunk = data[off + 8:off + 8 + clen]
    if ctype == 0x4E4F534A:
        js = json.loads(chunk)
    elif ctype == 0x004E4942:
        bin_ = chunk
    off += 8 + clen

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def acc(i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(COMP[a['componentType']])
    n = NUM[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)
        arr = raw[:, : dt.itemsize * n].copy().view(dt).reshape(a['count'], n)
    else:
        arr = np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
    return arr.astype(np.float64) if dt == np.float32 else arr


print(path)
print(' asset', js.get('asset'))
print(' nodes', len(js.get('nodes', [])), [(n.get('name'), n.get('mesh'), n.get('matrix') or n.get('rotation') or n.get('scale') or n.get('translation')) for n in js.get('nodes', [])][:6])
print(' meshes', len(js.get('meshes', [])), 'materials', len(js.get('materials', [])), 'images', len(js.get('images', [])), 'textures', len(js.get('textures', [])))
for m in js.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    print('  material', m.get('name'), {k: v for k, v in pbr.items()}, 'normal' if 'normalTexture' in m else '', 'emissive' if 'emissiveTexture' in m else '')
for k, im in enumerate(js.get('images', [])):
    bv = js['bufferViews'][im['bufferView']]
    blob = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    print('  image', k, im.get('mimeType'), len(blob), 'bytes')
    if out:
        ext = 'png' if 'png' in im.get('mimeType', '') else 'jpg'
        open(f'{out}-image{k}.{ext}', 'wb').write(blob)

for mi, mesh in enumerate(js['meshes']):
    for pi, prim in enumerate(mesh['primitives']):
        attrs = prim['attributes']
        P = acc(attrs['POSITION'])
        idx = acc(prim['indices']).reshape(-1) if 'indices' in prim else np.arange(len(P))
        print(f'  mesh {mi} prim {pi}: verts {len(P)} tris {len(idx) // 3} attrs {sorted(attrs)} material {prim.get("material")}')
        lo, hi = P.min(0), P.max(0)
        print('   bounds', np.round(lo, 4), np.round(hi, 4), 'size', np.round(hi - lo, 4))
        scale = 1 / (hi[1] - lo[1])
        centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
        Q = (P - centre) * scale
        key = np.round(Q, 5)
        _, weld, = np.unique(key, axis=0, return_inverse=True)[0:2]
        weld = weld.reshape(-1)
        n = weld.max() + 1
        parent = np.arange(n)

        def find(a):
            r = a
            while parent[r] != r:
                r = parent[r]
            while parent[a] != r:
                parent[a], a = r, parent[a]
            return r
        tri = weld[idx].reshape(-1, 3)
        for a, b, c in tri:
            ra, rb, rc = find(a), find(b), find(c)
            parent[ra] = rb
            parent[rc] = rb
        roots = np.array([find(i) for i in range(n)])
        W = np.zeros((n, 3))
        W[weld] = Q
        pieces = {}
        for r in np.unique(roots):
            sel = roots == r
            pts = W[sel]
            pieces[r] = (sel.sum(), pts.min(0), pts.max(0))
        print('   welded', n, 'pieces', len(pieces))
        for r, (cnt, plo, phi) in sorted(pieces.items(), key=lambda kv: -kv[1][0])[:14]:
            print(f'    piece {cnt:6d} verts  x {plo[0]:+.3f}..{phi[0]:+.3f}  y {plo[1]:+.3f}..{phi[1]:+.3f}  z {plo[2]:+.3f}..{phi[2]:+.3f}')
        if out:
            np.savez(f'{out}-mesh.npz', P=Q, tri=tri, weld=weld, idx=idx, uv=acc(attrs['TEXCOORD_0']) if 'TEXCOORD_0' in attrs else np.zeros((0, 2)), N=acc(attrs['NORMAL']) if 'NORMAL' in attrs else np.zeros((0, 3)))
