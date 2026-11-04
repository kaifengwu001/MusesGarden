# A GLB's metadata cleaned as the sculpts' were upstream (9cf8b7c): no generator in its asset, and its node,
# mesh, material and image names tripo_* → model_*; its binary chunk untouched. In place.
#   python3 -I glbclean.py file.glb ...
import json
import struct
import sys

for path in sys.argv[1:]:
    b = open(path, 'rb').read()
    magic, version, length = struct.unpack('<III', b[:12])
    assert magic == 0x46546C67 and length == len(b)
    clen, ctype = struct.unpack('<II', b[12:20])
    assert ctype == 0x4E4F534A
    js = json.loads(b[20:20 + clen])
    rest = b[20 + clen:]
    js['asset'].pop('generator', None)
    for key in ('nodes', 'meshes', 'materials', 'images'):
        for item in js.get(key, []):
            if isinstance(item.get('name'), str) and item['name'].startswith('tripo_'):
                item['name'] = 'model_' + item['name'][len('tripo_'):]
    text = json.dumps(js, separators=(',', ':')).encode()
    text += b' ' * ((4 - len(text) % 4) % 4)
    out = struct.pack('<III', magic, version, 12 + 8 + len(text) + len(rest)) + struct.pack('<II', len(text), ctype) + text + rest
    open(path, 'wb').write(out)
    print(path.split('/')[-1], len(b), '->', len(out), json.dumps(js['asset']))
