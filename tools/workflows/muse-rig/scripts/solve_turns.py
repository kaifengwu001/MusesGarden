# The hang and wave turns for a sculpt's arm, with the rig's shoulder share: the shoulder turns by a share
# of the upper arm's Euler angles (three.js 'YXZ'), the upper arm by the rest, the forearm bends about its own z.
# Fit a new sculpt's arms with it: the axis its arm runs along at rest (as it was sculpted), and the directions its
# upper arm should point hung and waving and its forearm waving, read off the references (reference 1 for the hang,
# 6 for the wave), all in Muse's frame (x to its left, y up, z forward). It prints the turns for MuseFit's hang and
# wave. tpose6's were found by scanning such directions against the references' silhouettes (idle IoU 0.962).
#   python3 -I solve_turns.py '{"axis":[0.964,-0.248,-0.099],"hang":[0.2,-0.95,0.2],"wave":[0.4,0.85,0.2],"fore":[0,1,0.1],"share":0.35}'
import sys, json
import numpy as np
from scipy.optimize import minimize
def Rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def Ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def Rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def E(x, y, z): return Ry(y) @ Rx(x) @ Rz(z)
cfg = json.loads(sys.argv[1])
n = lambda v: np.array(v, float) / np.linalg.norm(v)
a = n(cfg['axis']); share = cfg.get('share', 0.35)
def arm(p):
    x, y, z = p[:3]
    return E(share * x, share * y, share * z) @ E((1 - share) * x, (1 - share) * y, (1 - share) * z)
dh = n(cfg['hang'])
r = minimize(lambda p: np.sum((arm([p[0], 0, p[1]]) @ a - dh) ** 2) + 0.001 * (p[0] ** 2 + p[1] ** 2), [0, 0])
print('hang x %.3f z %.3f ->' % tuple(r.x), (arm([r.x[0], 0, r.x[1]]) @ a).round(3))
dw, df = n(cfg['wave']), n(cfg['fore'])
best = None
for x0 in (-1, 0, 1):
    for y0 in (-1, 0, 1):
        for z0 in (0, 1, 2):
            g = lambda p: np.sum((arm(p) @ a - dw) ** 2) + np.sum((arm(p) @ Rz(p[3]) @ a - df) ** 2) + 0.001 * np.sum(np.array(p) ** 2)
            rr = minimize(g, [x0, y0, z0, 0.5])
            if best is None or rr.fun < best.fun: best = rr
x, y, z, fo = best.x
print('wave x %.3f y %.3f z %.3f fore %.3f err %.5f -> upper' % (x, y, z, fo, best.fun), (arm(best.x) @ a).round(3), 'fore', (arm(best.x) @ Rz(fo) @ a).round(3))
