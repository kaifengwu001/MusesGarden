// The workshop's files over HTTP, with no key: GET /w/<job>/<file> serves what a job made (the 32-hex job id is the
// secret), and GET /api/looks/<id>.(glb|jpg|json) serves the bodies it finished. Mount it before the app's routes:
// it answers (and returns true) only for those two prefixes.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { isJobId, jobDir, looksDir } from './store';

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const LOOK_TYPES: readonly string[] = ['.glb', '.jpg', '.json'];
/** One path segment: starts with a letter or digit, then letters, digits, dot, dash or underscore. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_DEPTH = 4;
const LOOK_ID = /^gen-[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const HEADERS = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };

export type FileHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

function deny(res: ServerResponse, status: 404 | 405 | 416, text: string): void {
  res.writeHead(status, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' }).end(text);
}

/** `file` inside `root`, both resolved through any links; null when it's outside, missing or not a plain file. */
function inside(root: string, file: string): { readonly path: string; readonly size: number; readonly mtimeMs: number } | null {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(file);
    if (!real.startsWith(realRoot + sep)) return null;
    const st = statSync(real);
    return st.isFile() ? { path: real, size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

function send(req: IncomingMessage, res: ServerResponse, root: string, file: string): void {
  const type = TYPES[extname(file).toLowerCase()];
  const found = type === undefined ? null : inside(root, file);
  if (!found || type === undefined) return deny(res, 404, 'not found');
  const etag = `"${found.size.toString(16)}-${Math.floor(found.mtimeMs).toString(16)}"`;
  const head = { ...HEADERS, 'content-type': type, 'cache-control': 'no-cache', etag, 'accept-ranges': 'bytes' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, head).end();
    return;
  }
  let start = 0;
  let end = found.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (typeof range === 'string' && found.size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        start = Math.max(0, found.size - Number(m[2]));
      } else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= found.size) {
        res.writeHead(416, { ...head, 'content-range': `bytes */${found.size}` }).end();
        return;
      }
      status = 206;
    }
  }
  const length = found.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, {
    ...head,
    'content-length': String(length),
    ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${found.size}` } : {}),
  });
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return;
  }
  createReadStream(found.path, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}

/** The segments of a URL path, decoded; null if any is unsafe (dots, slashes, odd characters). */
function segments(rest: string): string[] | null {
  const parts = rest.split('/');
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null;
  const out: string[] = [];
  for (const raw of parts) {
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!SEGMENT.test(part) || part.includes('..')) return null;
    out.push(part);
  }
  return out;
}

export function workshopFiles(opts: { readonly dataDir: string }): FileHandler {
  return (req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const job = /^\/w\/([^/]+)\/(.+)$/.exec(path);
    const look = /^\/api\/looks\/([^/]+)$/.exec(path);
    if (!job && !look && !path.startsWith('/w/') && !path.startsWith('/api/looks/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      deny(res, 405, 'only GET');
      return true;
    }
    if (job) {
      const [, id = '', rest = ''] = job;
      const parts = segments(rest);
      if (!isJobId(id) || !parts) deny(res, 404, 'not found');
      else send(req, res, jobDir(opts.dataDir, id), join(jobDir(opts.dataDir, id), ...parts));
      return true;
    }
    const file = look?.[1] ?? '';
    const ext = extname(file).toLowerCase();
    const id = file.slice(0, file.length - ext.length);
    const lookFile = join(looksDir(opts.dataDir), `${id}${ext}`);
    if (!LOOK_TYPES.includes(ext) || !LOOK_ID.test(id)) deny(res, 404, 'not found');
    // A body with no knobs of its own: an empty set, not a 404 the browser logs as an error on every load.
    else if (ext === '.json' && !existsSync(lookFile)) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      res.end(req.method === 'HEAD' ? undefined : '{}');
    } else send(req, res, looksDir(opts.dataDir), lookFile);
    return true;
  };
}
