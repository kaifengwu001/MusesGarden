# Muse's walks from above, from probe.sh's samples: the meadow 40 m round the hut, and the porch up close.
# One run, or two side by side (the first is drawn on the left: pass the older one first).
#   python3 plot.py out.png <prefix> [<prefix> ...]      LABELS="Iteration 17,Now" names the columns
# Red: walking (walk > 0.05). Blue: anything else that moves it (hops, turns on the spot, shuffles).
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

out, prefixes = sys.argv[1], sys.argv[2:]
if not prefixes:
    sys.exit('usage: python3 plot.py out.png <prefix> [<prefix> ...]')
labels = os.environ.get('LABELS', '').split(',') if os.environ.get('LABELS') else [os.path.basename(p) for p in prefixes]
P = 760  # panel width, px
HEAD = 40


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def panel(prefix, x0, x1, z0, z1):
    geo = json.load(open(prefix + '.geo.json'))
    scale = P / (x1 - x0)
    H = int((z1 - z0) * scale)

    def px(x, z):
        return ((x - x0) * scale, H - (z - z0) * scale)

    im = Image.new('RGB', (P, H), (236, 242, 226))
    d = ImageDraw.Draw(im)
    r = 0.25 * scale + 0.5
    for x, z in geo['water']:
        a = px(x, z)
        d.rectangle([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=(150, 190, 225))

    def rect(q, col):
        if q:
            a, b = px(q['x0'], q['z1']), px(q['x1'], q['z0'])
            d.rectangle([a[0], a[1], b[0], b[1]], outline=(120, 90, 60), fill=col)

    rect(geo['pier'], (205, 185, 140))
    rect(geo['terrace'], (215, 195, 150))
    rect(geo['steps'], (200, 180, 140))
    rect(geo['walls'], (190, 160, 120))
    rect(geo.get('bench'), (140, 100, 60))
    rect(geo.get('stove'), (60, 60, 60))
    if geo.get('chair'):
        c = geo['chair']
        a = px(c['x'], c['z'])
        rr = c['r'] * scale
        d.ellipse([a[0] - rr, a[1] - rr, a[0] + rr, a[1] + rr], fill=(140, 100, 60))
    pts = [tuple(map(float, line.split()[:4])) for line in open(prefix + '.txt')]
    width = 2 if (x1 - x0) < 30 else 1
    for i in range(1, len(pts)):
        (_, xa, za, _), (_, xb, zb, walk) = pts[i - 1], pts[i]
        if (xa, za) == (xb, zb) or abs(xb - xa) > 1 or abs(zb - za) > 1:
            continue
        d.line([px(xa, za), px(xb, zb)], fill=(200, 60, 90) if walk > 0.05 else (60, 60, 200), width=width)
    return im


rows = [[panel(p, -40, 40, -40, 40) for p in prefixes], [panel(p, -10, 6, -1, 9) for p in prefixes]]
titles = ['the meadow, 80 m across', 'the porch and pier']
cols = len(prefixes)
sheet = Image.new('RGB', (cols * P + (cols - 1) * 20, sum(r[0].height + HEAD for r in rows)), 'white')
d = ImageDraw.Draw(sheet)
y = 0
for row, title in zip(rows, titles):
    for k, im in enumerate(row):
        x = k * (P + 20)
        d.text((x + 8, y + 10), f'{labels[k] if k < len(labels) else prefixes[k]}: {title}', fill=(40, 40, 40), font=font(20))
        sheet.paste(im, (x, y + HEAD))
    y += row[0].height + HEAD
sheet.save(out)
print(out, sheet.size)
