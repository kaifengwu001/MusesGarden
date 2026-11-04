# A muse's paint for the Node probe (probe.vitest.ts): the base colour image inside its GLB, decoded to raw
# RGBA as <out-dir>/<name>.rgba (width and height as little-endian uint32, then the pixels row by row from the
# top, as a GLB's texture coordinates read it).
#   python3 -I paint.py <out-dir> src/assets/muse/muses/*.glb
import io
import json
import os
import struct
import sys

from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for path in sys.argv[2:]:
    b = open(path, 'rb').read()
    clen = struct.unpack('<I', b[12:16])[0]
    js = json.loads(b[20:20 + clen])
    start = 20 + clen + 8
    try:
        texture = js['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
        image = js['images'][js['textures'][texture]['source']]
    except (KeyError, IndexError):
        image = js['images'][0]
    view = js['bufferViews'][image['bufferView']]
    blob = b[start + view.get('byteOffset', 0):start + view.get('byteOffset', 0) + view['byteLength']]
    im = Image.open(io.BytesIO(blob)).convert('RGBA')
    name = os.path.splitext(os.path.basename(path))[0]
    with open(os.path.join(out, name + '.rgba'), 'wb') as f:
        f.write(struct.pack('<II', *im.size) + im.tobytes())
    print(name, im.size)
