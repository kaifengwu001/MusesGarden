# A quick look at a GLB without a browser: its triangles sampled densely, splatted into a z-buffer,
# textured from its base colour (or each connected piece in its own colour), lit from the front-left.
#   python3 -I splat.py <prefix-from-glbinfo> out.png [views=0,45,90,180] [mode=paint|pieces] [size=420]
import sys

import numpy as np
from PIL import Image, ImageDraw

prefix, out = sys.argv[1], sys.argv[2]
views = [float(v) for v in (sys.argv[3] if len(sys.argv) > 3 else '0,45,90,180').split(',')]
mode = sys.argv[4] if len(sys.argv) > 4 else 'paint'
size = int(sys.argv[5]) if len(sys.argv) > 5 else 420
m = np.load(prefix + '-mesh.npz')
P, tri, weld, idx, uv = m['P'], m['tri'], m['weld'], m['idx'], m['uv']
corner = idx.reshape(-1, 3)  # the unwelded corners (for uv)
Pc = np.zeros((weld.max() + 1, 3))
Pc[weld] = P if len(P) == len(weld) else P
# P in the npz is per original vertex (normalised); triangles by original index
V = P
T = corner
tex = None
if mode == 'paint':
    import glob
    ims = sorted(glob.glob(prefix + '-image0.*'))
    tex = np.asarray(Image.open(ims[0]).convert('RGB'), dtype=np.float32) / 255
# pieces: union-find over welded ids
n = weld.max() + 1
parent = np.arange(n)


def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for a, b, c in weld[T]:
    ra, rb, rc = find(a), find(b), find(c)
    parent[ra] = rb
    parent[rc] = rb
root = np.array([find(i) for i in range(n)])
roots, piece = np.unique(root, return_inverse=True)
counts = np.bincount(piece)
order = np.argsort(-counts)
rank = np.empty_like(order)
rank[order] = np.arange(len(order))
tri_piece = rank[piece[weld[T[:, 0]]]]
rng = np.random.default_rng(3)
palette = rng.uniform(0.25, 0.95, (len(order), 3))
palette[0] = [0.85, 0.82, 0.78]

# dense samples per triangle
A, B, C = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
nrm = np.cross(B - A, C - A)
area = np.linalg.norm(nrm, axis=1)
nrm = nrm / np.maximum(area[:, None], 1e-12)
density = 2.2e6
k = np.maximum(3, (area * 0.5 * density).astype(int))
k = np.minimum(k, 4000)
ti = np.repeat(np.arange(len(T)), k)
r1 = rng.random(len(ti))
r2 = rng.random(len(ti))
s = np.sqrt(r1)
w0, w1, w2 = 1 - s, s * (1 - r2), s * r2
pts = A[ti] * w0[:, None] + B[ti] * w1[:, None] + C[ti] * w2[:, None]
if mode == 'paint':
    UV = uv[T[ti, 0]] * w0[:, None] + uv[T[ti, 1]] * w1[:, None] + uv[T[ti, 2]] * w2[:, None]
    h, w = tex.shape[:2]
    px = np.clip((UV[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    py = np.clip((UV[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
    col = tex[py, px]
else:
    col = palette[tri_piece[ti]]
nn = nrm[ti]
light = np.array([0.25, 0.45, 1.0])
light /= np.linalg.norm(light)
tiles = []
for deg in views:
    a = np.radians(deg)
    # turn the model so the camera (on +z) sees it from `deg` round to its left
    c, sn = np.cos(a), np.sin(a)
    x = pts[:, 0] * c - pts[:, 2] * sn
    z = pts[:, 0] * sn + pts[:, 2] * c
    y = pts[:, 1]
    nx = nn[:, 0] * c - nn[:, 2] * sn
    nz = nn[:, 0] * sn + nn[:, 2] * c
    ny = nn[:, 1]
    lam = np.abs(nx * light[0] + ny * light[1] + nz * light[2])
    shade = 0.45 + 0.6 * lam
    S = size
    u = ((x + 0.6) / 1.2 * S).astype(int)
    v = ((1.05 - y) / 1.2 * S).astype(int)
    ok = (u >= 0) & (u < S) & (v >= 0) & (v < S)
    u, v, z2, cc, sh = u[ok], v[ok], z[ok], col[ok], shade[ok]
    key = v * S + u
    o = np.lexsort((-z2, key))
    key, z2, cc, sh = key[o], z2[o], cc[o], sh[o]
    first = np.ones(len(key), bool)
    first[1:] = key[1:] != key[:-1]
    img = np.ones((S * S, 3))
    img[key[first]] = np.clip(cc[first] * sh[first, None], 0, 1)
    tile = Image.fromarray((img.reshape(S, S, 3) * 255).astype(np.uint8))
    ImageDraw.Draw(tile).text((6, 4), f'{deg:g}°', fill=(80, 80, 80))
    tiles.append(tile)
sheet = Image.new('RGB', (size * len(tiles), size), 'white')
for i, t in enumerate(tiles):
    sheet.paste(t, (i * size, 0))
sheet.save(out)
print(out, 'pieces', len(order), 'largest', counts[order][:8].tolist())
