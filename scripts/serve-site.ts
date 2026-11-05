// The garden's pages, built, for a garden served through a public tunnel (an open one, MUSE_OPEN_GARDEN=1 in
// server/http.ts): the meadow's build (dist/) at /, and each world's own build (dist-environments/<name>/, by its
// vite.config.ts) at /environments/<name>/, where a visit's ticket takes you. Plain files only: the tunnel sends /api
// and /visit to the garden.
//
//   npx tsx scripts/serve-site.ts [port]        (127.0.0.1, 5175 by default)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 5175);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The file a path names: under the world's own build for /environments/<name>/…, else under the meadow's. */
function fileFor(path: string): string | null {
  const world = /^\/environments\/([a-z0-9-]+)(\/.*)?$/.exec(path);
  const root = world ? join(repo, 'dist-environments', world[1]) : join(repo, 'dist');
  const rest = world ? (world[2] ?? '/') : path;
  const file = normalize(join(root, decodeURIComponent(rest)));
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) return join(file, 'index.html');
  return file;
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  // (a world's page without its trailing slash: its files are relative to the folder)
  if (/^\/environments\/[a-z0-9-]+$/.test(path)) {
    const q = (req.url ?? '').slice(path.length);
    res.writeHead(301, { location: `${path}/${q}` }).end();
    return;
  }
  let file: string | null;
  try {
    file = fileFor(path);
  } catch {
    file = null;
  }
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  // (built files named by their hash keep; pages are asked for again each time)
  const cache = /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'cache-control': cache });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.info(`The garden's pages on http://127.0.0.1:${port}/ (dist/, and dist-environments/ at /environments/)`));
