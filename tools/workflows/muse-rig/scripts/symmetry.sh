#!/bin/bash
# The two arms against each other: a muse with its arms hung (pose=hang), in clay, seen from ±a; each view from
# its right mirrored onto the matching view from its left, and slid onto it by their heads and legs (the lab
# doesn't centre Muse in its frame). Grey where both have it, blue only the left arm's side, red only the right's.
# Prints the pixels that differ over the arms' heights at each angle and in all, and writes <out>/<model>-sym.png.
# Run it before and after a change to the arms, from anywhere in the repo, against the dev server (muse-look's
# poses.mjs).
#   symmetry.sh <out-dir> [model=tpose6] ["0 30 60 90 120 150"]
set -e
OUT=$1
M=${2:-tpose6}
ANGLES=${3:-"0 30 60 90 120 150"}
[ -n "$OUT" ] || { echo "usage: symmetry.sh <out-dir> [model] [angles]"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/$M"
LIST=$(python3 -c "import json, sys; print(json.dumps([['hang', 0, f'turn:{s}{a}'] for a in sys.argv[1].split() for s in ('', '-')]))" "$ANGLES")
node "$HERE/../../muse-look/scripts/poses.mjs" "$OUT/$M" "$LIST" "$M" clay > /dev/null
python3 -I - "$OUT/$M" "$M" "$ANGLES" "$OUT" <<'PY'
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

d, model, angles, out = sys.argv[1], sys.argv[2], sys.argv[3].split(), sys.argv[4]


def mask(a):
    im = np.asarray(Image.open(f'{d}/hang-0-turn{a}-clay.png').convert('RGB')).astype(float)
    bg = np.median(np.array([im[0, 0], im[0, -1], im[-1, 0], im[-1, -1]]), 0)
    return ndimage.binary_fill_holes(np.sqrt(((im - bg) ** 2).sum(-1)) > 22)


def aligned(A, B, top, h):
    # the lab doesn't centre Muse in the frame: slide the mirrored view onto the other by its head and legs
    keep = np.zeros(A.shape[0], bool)
    keep[top:int(top + 0.35 * h)] = True
    keep[int(top + 0.88 * h):] = True
    shifts = range(-90, 91)
    best = min(shifts, key=lambda s: int((A[keep] ^ np.roll(B, s, axis=1)[keep]).sum()))
    return np.roll(B, best, axis=1)


tiles, total = [], 0
for a in angles:
    A = mask(a)
    B = np.fliplr(mask(f'-{a}'))
    ys = np.where(A.any(1))[0]
    top, bottom = ys.min(), ys.max()
    h = bottom - top
    B = aligned(A, B, top, h)
    rows = slice(int(bottom - 0.62 * h), int(bottom - 0.12 * h))
    diff = int((A ^ B)[rows].sum())
    total += diff
    pic = np.full(A.shape + (3,), 255, np.uint8)
    pic[A & B] = (205, 205, 205)
    pic[A & ~B] = (40, 80, 220)
    pic[~A & B] = (220, 40, 40)
    xs = np.where((A | B).any(0))[0]
    im = Image.fromarray(pic).crop((max(0, xs.min() - 20), max(0, top - 20), xs.max() + 20, bottom + 20))
    im = im.resize((420, int(420 * im.height / im.width)))
    ImageDraw.Draw(im).text((6, 4), f'±{a}°  {diff} px', fill=(0, 0, 0))
    tiles.append(im)
    print(f'±{a}°: {diff} px differ')
th = max(t.height for t in tiles)
sheet = Image.new('RGB', (420 * 3, th * ((len(tiles) + 2) // 3)), 'white')
for k, t in enumerate(tiles):
    sheet.paste(t, ((k % 3) * 420, (k // 3) * th))
sheet.save(f'{out}/{model}-sym.png')
print(model, 'pixels where the arms differ, all views:', total, f'({out}/{model}-sym.png)')
PY
