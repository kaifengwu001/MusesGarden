# A mesh's open edges, gathered into holes: each one's edge count, middle and extent. Reads glbinfo.py's
# <prefix>-mesh.npz (the sculpt as made, height-normalised) or a rigged mesh the probe dumped (DUMP=<dir>:
# <kind>.json, in Muse's H), welded by position first, since a rigged muse in clothes is split along its paint's
# seams. Two holes meeting at a vertex (a pinch) count as one here. Edges of more than two triangles are counted
# too. A closed sculpt prints nothing but its totals.
#   python3 -I holes.py <prefix>-mesh.npz | <kind>.json [min-edges=3]
import collections
import json
import sys

import numpy as np

path = sys.argv[1]
least = int(sys.argv[2]) if len(sys.argv) > 2 else 3
if path.endswith('.npz'):
    m = np.load(path)
    weld, tri = m['weld'], m['tri']
    W = np.zeros((weld.max() + 1, 3))
    W[weld] = m['P']
else:
    d = json.load(open(path))
    P = np.array(d['position'], float).reshape(-1, 3)
    W, inverse = np.unique(np.round(P, 5), axis=0, return_inverse=True)
    tri = inverse.reshape(-1)[np.array(d['index'], int)].reshape(-1, 3)

edges = collections.Counter()
for a, b, c in tri:
    for u, v in ((a, b), (b, c), (c, a)):
        if u != v:
            edges[(min(u, v), max(u, v))] += 1
open_ = [e for e, n in edges.items() if n == 1]
crowded = sum(1 for n in edges.values() if n > 2)

parent = {}


def find(a):
    parent.setdefault(a, a)
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for u, v in open_:
    parent[find(u)] = find(v)
holes = collections.defaultdict(list)
for u, v in open_:
    holes[find(u)].append((u, v))

print(f'{len(tri)} triangles, {len(open_)} open edges in {len(holes)} holes, {crowded} edges of more than two triangles')
for hole in sorted(holes.values(), key=len, reverse=True):
    if len(hole) < least:
        continue
    ids = sorted({i for e in hole for i in e})
    pts = W[ids]
    lo, hi = pts.min(0), pts.max(0)
    mid = pts.mean(0)
    print(f'  {len(hole):5d} edges  middle {mid[0]:+.3f} {mid[1]:.3f} {mid[2]:+.3f}  '
          f'x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:.3f}..{hi[1]:.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}')
