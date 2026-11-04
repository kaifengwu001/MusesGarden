# Median CIELAB of a muse's paint in boxes (bbox-H as made), against its fur at the arms' ends.
#   python3 -I regions.py <prefix> 'name:x0,x1,y0,y1,z0,z1;...'
import glob, sys
import numpy as np
from PIL import Image
prefix, spec = sys.argv[1], sys.argv[2]
m = np.load(prefix + '-mesh.npz')
P, idx, uv = m['P'], m['idx'], m['uv']
T = idx.reshape(-1, 3)
tex = np.asarray(Image.open(glob.glob(prefix + '-image0.*')[0]).convert('RGB'), dtype=np.float64) / 255
h, w = tex.shape[:2]
def lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
C = (P[T[:, 0]] + P[T[:, 1]] + P[T[:, 2]]) / 3
UV = (uv[T[:, 0]] + uv[T[:, 1]] + uv[T[:, 2]]) / 3
col = tex[np.clip((UV[:, 1] % 1 * (h - 1)).astype(int), 0, h - 1), np.clip((UV[:, 0] % 1 * (w - 1)).astype(int), 0, w - 1)]
L = lab(col)
wide = np.abs(P[:, 0]).max()
ref = np.median(L[np.abs(C[:, 0]) > 0.88 * wide], 0)
print(prefix.split('/')[-1], 'fur at the arms', ref.round(1).tolist())
for part in spec.split(';'):
    name, b = part.split(':')
    x0, x1, y0, y1, z0, z1 = map(float, b.split(','))
    sel = (C[:, 0] > x0) & (C[:, 0] < x1) & (C[:, 1] > y0) & (C[:, 1] < y1) & (C[:, 2] > z0) & (C[:, 2] < z1)
    if sel.sum() == 0:
        print(' ', name, 'none'); continue
    med = np.median(L[sel], 0)
    d = L[sel] - ref
    dE = np.sqrt((d ** 2).sum(1))
    dEh = np.sqrt((0.5 * d[:, 0]) ** 2 + d[:, 1] ** 2 + d[:, 2] ** 2)
    print(f'  {name:10s} n {sel.sum():5d} Lab {med.round(1).tolist()}  ΔE p25/50/75 {np.percentile(dE, [25, 50, 75]).round(1).tolist()}  ΔE(L/2) {np.percentile(dEh, [25, 50, 75]).round(1).tolist()}')
