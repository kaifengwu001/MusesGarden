# How fur-like each part of a muse's paint is: the fur's colour taken at the arms' ends (|x| > 0.47 of the
# model's half-width... in bbox H, past 0.85 of the widest), then each splat coloured by its ΔE (CIELAB) to it:
# white 0 … red 30+. Also prints the fur colour.
#   python3 -I furmap.py <prefix> out.png
import glob
import sys

import numpy as np
from PIL import Image

prefix, out = sys.argv[1], sys.argv[2]
m = np.load(prefix + '-mesh.npz')
P, idx, uv = m['P'], m['idx'], m['uv']
T = idx.reshape(-1, 3)
tex = np.asarray(Image.open(glob.glob(prefix + '-image0.*')[0]).convert('RGB'), dtype=np.float64) / 255


def lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


h, w = tex.shape[:2]
def sample(UV):
    px = np.clip((UV[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    py = np.clip((UV[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
    return tex[py, px]
rng = np.random.default_rng(1)
A, B, C = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
area = np.linalg.norm(np.cross(B - A, C - A), axis=1)
k = np.clip((area * 0.5 * 1.5e6).astype(int), 2, 3000)
ti = np.repeat(np.arange(len(T)), k)
r1, r2 = rng.random(len(ti)), rng.random(len(ti))
s = np.sqrt(r1)
w0, w1, w2 = 1 - s, s * (1 - r2), s * r2
pts = A[ti] * w0[:, None] + B[ti] * w1[:, None] + C[ti] * w2[:, None]
UV = uv[T[ti, 0]] * w0[:, None] + uv[T[ti, 1]] * w1[:, None] + uv[T[ti, 2]] * w2[:, None]
col = sample(UV)
L = lab(col)
wide = np.abs(P[:, 0]).max()
tip = np.abs(pts[:, 0]) > 0.88 * wide
ref = np.median(L[tip], axis=0)
refrgb = np.median(col[tip], axis=0)
dE = np.linalg.norm(L - ref, axis=1)
print(prefix.split('/')[-1], 'fur at the arms\' ends sRGB', (refrgb * 255).round().astype(int).tolist(), 'Lab', ref.round(1).tolist(), 'ΔE p50/p90 there', np.percentile(dE[tip], [50, 90]).round(1).tolist())
heat = np.clip(dE / 30, 0, 1)
c2 = np.stack([np.ones_like(heat), 1 - heat, 1 - heat], -1)
nrm = np.cross(B - A, C - A)
nrm /= np.maximum(np.linalg.norm(nrm, axis=1)[:, None], 1e-12)
nn = nrm[ti]
S = 300
tiles = []
for deg in (0, 60, 180):
    a = np.radians(deg)
    cc, sn = np.cos(a), np.sin(a)
    x = pts[:, 0] * cc - pts[:, 2] * sn
    z = pts[:, 0] * sn + pts[:, 2] * cc
    y = pts[:, 1]
    lam = np.abs((nn[:, 0] * cc - nn[:, 2] * sn) * 0.25 + nn[:, 1] * 0.45 + (nn[:, 0] * sn + nn[:, 2] * cc) * 1.0) / 1.12
    u = ((x + 0.6) / 1.2 * S).astype(int)
    v = ((1.05 - y) / 1.2 * S).astype(int)
    ok = (u >= 0) & (u < S) & (v >= 0) & (v < S)
    key = (v * S + u)[ok]
    o = np.lexsort((-z[ok], key))
    key = key[o]
    first = np.ones(len(key), bool)
    first[1:] = key[1:] != key[:-1]
    img = np.ones((S * S, 3))
    img[key[first]] = (c2[ok][o][first] * (0.55 + 0.45 * lam[ok][o][first, None]))
    tiles.append(Image.fromarray((img.reshape(S, S, 3) * 255).astype(np.uint8)))
sheet = Image.new('RGB', (S * 3, S), 'white')
for i, t in enumerate(tiles):
    sheet.paste(t, (i * S, 0))
sheet.save(out)
