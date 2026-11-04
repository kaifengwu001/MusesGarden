# Each arm of a muse from its tip inward: sections across |x| = c (every triangle edge crossing it), the
# crossings clustered in (y, z) and the arm's cluster followed in from the tip, until the section grows past
# 1.6x the arm's own height (the body, or a garment's side): the arm's root, centreline and tip, in Muse's H
# (scaled so the eyes are at 0.7666, museMesh.ts EYES). Prints a suggested fit (joints) and cut.
#   python3 -I arms.py <prefix> <scale>
import sys

import numpy as np

prefix, s = sys.argv[1], float(sys.argv[2])
m = np.load(prefix + '-mesh.npz')
P, idx = m['P'] * s, m['idx']
T = idx.reshape(-1, 3)
E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
out = {}
for side in (1, -1):
    X = side * P[:, 0]
    tipx = X.max()
    rows = []
    prev = None
    heights = []
    for c in np.arange(tipx - 0.012, 0.12, -0.01):
        a, b = E[:, 0], E[:, 1]
        sa, sb = X[a] - c, X[b] - c
        ok = (sa < 0) != (sb < 0)
        f = sa[ok] / (sa[ok] - sb[ok])
        y = P[a[ok], 1] + f * (P[b[ok], 1] - P[a[ok], 1])
        z = P[a[ok], 2] + f * (P[b[ok], 2] - P[a[ok], 2])
        if len(y) == 0:
            continue
        # cluster: crossings within 0.03 of one another (single linkage on a grid)
        pts = np.stack([y, z], 1)
        order = np.argsort(y)
        lab = -np.ones(len(pts), int)
        k = 0
        for i in order:
            if lab[i] >= 0:
                continue
            stack = [i]
            lab[i] = k
            while stack:
                j = stack.pop()
                d = np.hypot(pts[:, 0] - pts[j, 0], pts[:, 1] - pts[j, 1])
                nb = np.where((d < 0.03) & (lab < 0))[0]
                lab[nb] = k
                stack.extend(nb.tolist())
            k += 1
        # the arm's cluster: nearest the last centre (at the tip: the biggest)
        best = None
        for q in range(k):
            sel = lab == q
            yc = (y[sel].min() + y[sel].max()) / 2
            zc = (z[sel].min() + z[sel].max()) / 2
            score = sel.sum() if prev is None else -np.hypot(yc - prev[0], zc - prev[1])
            if best is None or score > best[0]:
                best = (score, q, yc, zc, y[sel].max() - y[sel].min(), z[sel].max() - z[sel].min())
        _, q, yc, zc, hy, hz = best
        if len(heights) >= 4 and hy > 1.6 * np.median(heights):
            rows.append((c, yc, zc, hy, hz, 'root'))
            break
        heights.append(hy)
        rows.append((c, yc, zc, hy, hz, ''))
        prev = (yc, zc)
    out[side] = rows
    name = 'L' if side > 0 else 'R'
    print(f'  {name} tip {tipx:.3f} ' + ' '.join(f'{c:.2f}:{y:.3f},{z:+.3f}/{h:.3f}{"*" if t else ""}' for c, y, z, h, _, t in rows[::2]))
# suggested fit from the left (the right mirrored): root where the arm meets what it grows from
rows = out[1]
root = rows[-1][0] + 0.01 if rows[-1][5] else rows[-1][0]
arm = [r for r in rows if not r[5]]
xs = np.array([r[0] for r in arm])
ys = np.array([r[1] for r in arm])
zs = np.array([r[2] for r in arm])
tip = out[1][0][0] + 0.012
at = lambda x: (np.interp(x, xs[::-1], ys[::-1]), np.interp(x, xs[::-1], zs[::-1]))
piv = root - 0.02
py, pz = at(root)
ex = root + 0.5 * (tip - root)
ey, ez = at(ex)
hx = tip - 0.07
hy, hz = at(hx)
slope = np.degrees(np.arctan2(ey - py, ex - piv))
print(f'  root {root:.3f} tip {tip:.3f} height {np.median([r[3] for r in arm]):.3f} slope {slope:.1f}°')
print(f'  fit: upper [{piv:.3f}, {py:.3f}, {pz:.3f}] fore [{ex:.3f}, {ey:.3f}, {ez:.3f}] hand [{hx:.3f}, {hy:.3f}, {hz:.3f}]')
