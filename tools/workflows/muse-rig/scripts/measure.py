# Landmarks of a Tripo muse (from glbinfo's npz): its eyes, mouth and face plate, the scale that sets its
# eyes at Muse's height (0.7666 H, museMesh.ts EYES), its arms' centrelines (sections across x), its legs, its hood's top,
# and its fur's colour round the face (texture, sRGB).
#   python3 -I measure.py <prefix>
import glob
import sys

import numpy as np
from PIL import Image

prefix = sys.argv[1]
m = np.load(prefix + '-mesh.npz')
P, weld, idx, uv = m['P'], m['weld'], m['idx'], m['uv']
T = idx.reshape(-1, 3)
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
root = np.array([find(i) for i in range(n)])[weld]  # per original vertex
pieces = {}
for r in np.unique(root):
    sel = root == r
    pts = P[sel]
    pieces[r] = dict(n=int(sel.sum()), lo=pts.min(0), hi=pts.max(0), c=(pts.min(0) + pts.max(0)) / 2)
# eyes: two pieces mirrored in x, small, in front, high
cands = [r for r, p in pieces.items() if (p['hi'] - p['lo']).max() < 0.08 and p['c'][1] > 0.55 and p['hi'][2] > 0.1 and abs(p['c'][0]) > 0.04]
best = None
for i, a in enumerate(cands):
    for b in cands[i + 1:]:
        pa, pb = pieces[a], pieces[b]
        if pa['c'][0] * pb['c'][0] >= 0:
            continue
        d = abs(pa['c'][0] + pb['c'][0]) + abs(pa['c'][1] - pb['c'][1]) + abs(pa['c'][2] - pb['c'][2]) + 0.002 * abs(pa['n'] - pb['n'])
        if best is None or d < best[0]:
            best = (d, a, b)
eyes = [pieces[best[1]], pieces[best[2]]]
eye_y = (eyes[0]['c'][1] + eyes[1]['c'][1]) / 2
eye_x = (abs(eyes[0]['c'][0]) + abs(eyes[1]['c'][0])) / 2
eye_r = np.mean([(e['hi'][0] - e['lo'][0]) / 2 for e in eyes])
eye_z = max(e['hi'][2] for e in eyes)
# mouth: a small piece in the middle below the eyes
mouths = [p for r, p in pieces.items() if abs(p['c'][0]) < 0.03 and eye_y - 0.09 < p['c'][1] < eye_y - 0.01 and p['hi'][2] > eye_z - 0.05 and (p['hi'] - p['lo']).max() < 0.1]
mouth = max(mouths, key=lambda p: p['hi'][0] - p['lo'][0]) if mouths else None
# face plate: the piece behind the eyes, its box round them
plates = [p for r, p in pieces.items() if p['lo'][0] < -eye_x and p['hi'][0] > eye_x and p['lo'][1] < eye_y - 0.05 and p['hi'][1] > eye_y + 0.04 and abs(p['hi'][2] - eye_z) < 0.08 and (p['hi'][0] - p['lo'][0]) < 0.5]
plate = min(plates, key=lambda p: (p['hi'][0] - p['lo'][0]) * (p['hi'][1] - p['lo'][1])) if plates else None
s = 0.7666 / eye_y  # museMesh.ts EYES: tpose6's own eyes
print(f'{prefix.split("/")[-1]}: eyes ±{eye_x:.4f} y {eye_y:.4f} r {eye_r:.4f} z {eye_z:.3f} | scale to Muse {s:.4f} (top {s:.3f} H)')
if mouth:
    print(f'  mouth x {mouth["c"][0]:+.4f} y {mouth["c"][1]:.4f} half {(mouth["hi"][0] - mouth["lo"][0]) / 2:.4f} tall {mouth["hi"][1] - mouth["lo"][1]:.4f}  (H as made)')
if plate:
    print(f'  plate x {plate["lo"][0]:+.3f}..{plate["hi"][0]:+.3f} y {plate["lo"][1]:.3f}..{plate["hi"][1]:.3f} z {plate["lo"][2]:.3f}..{plate["hi"][2]:.3f} verts {plate["n"]}')
Q = P * s  # in Muse's H (feet at 0)
# arms: sections across |x| = c, every vertex's triangle edges crossing it, from 0.2 out
for side in (1, -1):
    rows = []
    for c in np.arange(0.20, 0.75, 0.02):
        xs = side * Q[T][:, :, 0] - c
        ys = Q[T][:, :, 1]
        zs = Q[T][:, :, 2]
        cross_y, cross_z = [], []
        for e in range(3):
            a, b = e, (e + 1) % 3
            sa, sb = xs[:, a], xs[:, b]
            ok = (sa < 0) != (sb < 0)
            f = sa[ok] / (sa[ok] - sb[ok])
            cross_y.append(ys[ok, a] + f * (ys[ok, b] - ys[ok, a]))
            cross_z.append(zs[ok, a] + f * (zs[ok, b] - zs[ok, a]))
        cy = np.concatenate(cross_y)
        cz = np.concatenate(cross_z)
        if len(cy) == 0:
            break
        # the arm: the crossings in the band between 0.25 and 0.75 H high, its extent
        band = (cy > 0.2) & (cy < 0.8)
        if band.sum() == 0:
            break
        rows.append((c, cy[band].min(), cy[band].max(), cz[band].min(), cz[band].max()))
    print('  arm', 'L' if side > 0 else 'R', ' '.join(f'{c:.2f}:{(y0 + y1) / 2:.3f}/{y1 - y0:.3f}' for c, y0, y1, z0, z1 in rows))
# legs: the soles' blobs at y < 0.05
low = Q[:, 1] < 0.05
for side in (1, -1):
    sel = low & (side * Q[:, 0] > 0.02)
    if sel.sum():
        print(f'  leg {"L" if side > 0 else "R"} x {Q[sel, 0].mean():+.3f} z {Q[sel, 2].mean():+.3f}  (x {Q[sel, 0].min():+.3f}..{Q[sel, 0].max():+.3f} z {Q[sel, 2].min():+.3f}..{Q[sel, 2].max():+.3f})')
# the hood's top over the face: the highest point within |x| < 0.05 of any piece that is not a hat (the hood is the
# piece the plate sits in front of: the top of whatever surface is just above the plate's top, behind it)
print(f'  total top {Q[:, 1].max():.3f} H; width ±{np.abs(Q[:, 0]).max():.3f} H')
# fur colour: texels at vertices just outside the plate's rim, round its sides
ims = glob.glob(prefix + '-image0.*')
if plate and ims:
    tex = np.asarray(Image.open(ims[0]).convert('RGB'), dtype=np.float32)
    h, w = tex.shape[:2]
    pc = (plate['lo'] + plate['hi']) / 2
    half = (plate['hi'] - plate['lo']) / 2
    rad = np.hypot((P[:, 0] - pc[0]) / half[0], (P[:, 1] - pc[1]) / half[1])
    ring = (rad > 1.08) & (rad < 1.35) & (P[:, 2] > pc[2] - 0.15) & (root != [r for r, p in pieces.items() if p is plate][0])
    px = np.clip((uv[ring, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    py = np.clip((uv[ring, 1] % 1) * (h - 1), 0, h - 1).astype(int)
    col = tex[py, px]
    med = np.median(col, axis=0)
    print(f'  fur round the face: sRGB {med.round().astype(int).tolist()} ({ring.sum()} verts; spread {np.percentile(col, 25, axis=0).round().astype(int).tolist()} .. {np.percentile(col, 75, axis=0).round().astype(int).tolist()})')
