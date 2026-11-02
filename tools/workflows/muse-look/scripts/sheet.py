# A labelled contact sheet of stills, each scaled to fit a cell, its file name above it.
#   python3 sheet.py out.png <cols> file1.png file2.png ...      (CELL=420 sets the cell width in px)
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
if not files:
    sys.exit('usage: python3 sheet.py out.png <cols> files...')
ims = [Image.open(f).convert('RGB') for f in files]
W = max(i.width for i in ims)
H = max(i.height for i in ims)
scale = min(1.0, int(os.environ.get('CELL', 420)) / W)
w, h = int(W * scale), int(H * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * (h + 26)), 'white')
d = ImageDraw.Draw(sheet)
for k, (im, f) in enumerate(zip(ims, files)):
    r, c = divmod(k, cols)
    sheet.paste(im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS), (c * w, r * (h + 26) + 26))
    d.text((c * w + 6, r * (h + 26) + 4), os.path.basename(f).rsplit('.', 1)[0], fill=(40, 40, 40), font=font(16))
sheet.save(out)
print(out, sheet.size)
