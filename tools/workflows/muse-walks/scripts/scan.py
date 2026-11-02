# What to look at in Muse's walks, from probe.sh's samples (sample at 1/60 s to judge turns frame by frame):
#   python3 scan.py <prefix> [top=8]
# Prints its fastest turns (rad/s) and moves (m/s), each with the part of its day it falls in and how far
# into it (film that moment with muse-look), any time in a pond or inside the house's walls, how far it
# strays from the hut, and how its time splits between the parts of its day.
import bisect
import json
import math
import sys

prefix = sys.argv[1]
top = int(sys.argv[2]) if len(sys.argv) > 2 else 8
rows = [tuple(map(float, line.split())) for line in open(prefix + '.txt')]
names = [(float(s), n) for s, n in (line.rstrip('\n').split(' ', 1) for line in open(prefix + '.names.txt'))]
geo = json.load(open(prefix + '.geo.json'))
starts = [s for s, _ in names]


def part(t):
    k = bisect.bisect_right(starts, t) - 1
    return (names[k][1], t - names[k][0]) if k >= 0 else ('?', t)


def inside(q, x, z, pad=0.0):
    return q and q['x0'] - pad <= x <= q['x1'] + pad and q['z0'] - pad <= z <= q['z1'] + pad


def spaced(events):
    """The worst first, none within a second of a worse one."""
    kept = []
    for e in sorted(events, reverse=True):
        if all(abs(e[1] - k[1]) > 1 for k in kept):
            kept.append(e)
        if len(kept) == top:
            break
    return kept


dt = rows[1][0] - rows[0][0]
turns, moves = [], []
for (t0, x0, z0, _, h0, _), (t1, x1, z1, _, h1, _) in zip(rows, rows[1:]):
    dh = (h1 - h0 + math.pi) % (2 * math.pi) - math.pi
    turns.append((abs(dh) / dt, t1))
    moves.append((math.hypot(x1 - x0, z1 - z0) / dt, t1))
span = rows[-1][0] + dt
print(f'{len(rows)} samples every {dt:.4f} s over {span / 60:.1f} min (seed {geo["seed"]}, R {geo["R"]})')

print('\nfastest turns (rad/s; a half turn on the spot peaks near 4.1, so much above ~5 is a snap):')
for rate, t in spaced(turns):
    name, s = part(t)
    print(f'  {rate:6.2f}  at {t:8.2f} s   {name} + {s:.2f} s')
print('\nfastest moves (m/s; its walk is about 0.54, hops a little more; well above 2 is a jump):')
for v, t in spaced(moves):
    name, s = part(t)
    print(f'  {v:6.2f}  at {t:8.2f} s   {name} + {s:.2f} s')

deck = [geo['terrace'], geo['pier'], geo['steps']]
# (the pond runs under the pier, and sitting on its front edge to fish puts Muse's feet a few cm past it)
wet = [r for r in rows if r[5] < 0 and not any(inside(q, r[1], r[2], 0.3) for q in deck)]
housed = [r for r in rows if inside(geo['walls'], r[1], r[2])]
print(f'\nin a pond (off the deck): {len(wet) * dt:.1f} s' + ''.join(f'\n  at {r[0]:.2f} s {part(r[0])[0]}' for r in wet[:5]))
print(f'inside the walls: {len(housed) * dt:.1f} s' + ''.join(f'\n  at {r[0]:.2f} s {part(r[0])[0]}' for r in housed[:5]))

far = sorted(math.hypot(r[1], r[2]) for r in rows)
q = lambda f: far[min(len(far) - 1, int(f * len(far)))]
walking = sum(1 for r in rows if r[3] > 0.05) / len(rows)
print(f'\nfrom the hut (m): median {q(0.5):.1f}, 90% within {q(0.9):.1f}, farthest {far[-1]:.1f}; walking {100 * walking:.0f}% of the time')

spent = {}
for k, (s, n) in enumerate(names):
    if s >= span:
        break
    end = min(names[k + 1][0] if k + 1 < len(names) else span, span)
    total, count = spent.get(n, (0.0, 0))
    spent[n] = (total + end - s, count + 1)
print('\ntime by part of its day (minutes, times, mean s each):')
for n, (total, count) in sorted(spent.items(), key=lambda kv: -kv[1][0])[:22]:
    print(f'  {n:16} {total / 60:6.1f} min  ×{count:<4} {total / count:6.1f} s')
