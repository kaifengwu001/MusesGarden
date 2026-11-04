import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workshopFiles } from './routes';

const JOB = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
let dataDir = '';
let server: Server;
let port = 0;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'workshop-files-'));
  const dir = join(dataDir, 'workshop', JOB);
  mkdirSync(join(dir, 'stills'), { recursive: true });
  mkdirSync(join(dataDir, 'workshop', OTHER), { recursive: true });
  mkdirSync(join(dataDir, 'workshop', 'looks'), { recursive: true });
  writeFileSync(join(dir, 'concept-1.png'), 'png bytes');
  writeFileSync(join(dir, 'stills', 'front.jpg'), 'jpg bytes');
  writeFileSync(join(dir, 'turntable.mp4'), '0123456789');
  writeFileSync(join(dir, 'run.sh'), 'echo hi');
  writeFileSync(join(dataDir, 'workshop', OTHER, 'theirs.png'), 'not yours');
  writeFileSync(join(dataDir, 'secret.txt'), 'the garden key');
  writeFileSync(join(dataDir, 'workshop.db'), 'db');
  symlinkSync(join(dataDir, 'secret.txt'), join(dir, 'link.txt'));
  writeFileSync(join(dataDir, 'workshop', 'looks', 'gen-pip-1.glb'), 'glTF');
  writeFileSync(join(dataDir, 'workshop', 'looks', 'gen-pip-1.json'), '{}');
  const handle = workshopFiles({ dataDir });
  server = createServer((req, res) => {
    if (!handle(req, res)) res.writeHead(418).end('not mine');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dataDir, { recursive: true, force: true });
});

/** A raw request: node:http sends the path as written (fetch would tidy away the dots). */
function get(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; type: string; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the workshop’s files', () => {
  it('serves a job’s own files with their types', async () => {
    expect(await get(`/w/${JOB}/concept-1.png`)).toMatchObject({ status: 200, type: 'image/png', body: 'png bytes' });
    expect(await get(`/w/${JOB}/stills/front.jpg`)).toMatchObject({ status: 200, type: 'image/jpeg', body: 'jpg bytes' });
    expect(await get(`/w/${JOB}/concept-1.png?v=2`)).toMatchObject({ status: 200 });
  });

  it('serves part of a video when asked for a range', async () => {
    const r = await get(`/w/${JOB}/turntable.mp4`, { range: 'bytes=2-5' });
    expect(r).toMatchObject({ status: 206, type: 'video/mp4', body: '2345' });
    expect(r.headers['content-range']).toBe('bytes 2-5/10');
    expect((await get(`/w/${JOB}/turntable.mp4`, { range: 'bytes=50-' })).status).toBe(416);
  });

  it('serves nothing outside that job’s folder', async () => {
    for (const path of [
      `/w/${JOB}/../secret.txt`,
      `/w/${JOB}/../../secret.txt`,
      `/w/${JOB}/%2e%2e/secret.txt`,
      `/w/${JOB}/..%2Fsecret.txt`,
      `/w/${JOB}/%2e%2e%2f%2e%2e%2fsecret.txt`,
      `/w/${JOB}/stills/../../${OTHER}/theirs.png`,
      `/w/${JOB}/link.txt`,
      `/w/${JOB}/.hidden.txt`,
      `/w/${JOB}/run.sh`,
      `/w/${JOB}/missing.png`,
      `/w/${JOB}/stills`,
      `/w/${JOB}`,
      `/w/${JOB}/`,
      `/w/../secret.txt`,
      `/w/looks/gen-pip-1.glb`,
      `/w/${JOB.slice(1)}/concept-1.png`,
      `/w/${JOB.toUpperCase()}/concept-1.png`,
    ]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).not.toContain('garden key');
    }
  });

  it('serves the bodies the workshop finished at /api/looks', async () => {
    expect(await get('/api/looks/gen-pip-1.glb')).toMatchObject({ status: 200, type: 'model/gltf-binary', body: 'glTF' });
    expect(await get('/api/looks/gen-pip-1.json')).toMatchObject({ status: 200, type: 'application/json; charset=utf-8' });
    for (const path of ['/api/looks/gen-pip-2.glb', '/api/looks/muse6.glb', '/api/looks/gen-pip-1.png', '/api/looks/../secret.txt', '/api/looks/gen-..%2F..%2Fsecret.txt']) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('answers only GET and HEAD, and leaves every other path to the app', async () => {
    expect((await get(`/w/${JOB}/concept-1.png`, {}, 'POST')).status).toBe(405);
    expect(await get(`/w/${JOB}/concept-1.png`, {}, 'HEAD')).toMatchObject({ status: 200, body: '' });
    expect((await get('/api/muses')).status).toBe(418);
    expect((await get('/wonder')).status).toBe(418);
  });
});
