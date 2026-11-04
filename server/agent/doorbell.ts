// The doorbell: GET /d/<code> answers with a bare number, how many rounds are waiting for Muse (the workshop's
// count). Muse's polling hook reads it and checks in when it's above 0. It needs no key, so it says nothing else, and
// an unknown code answers "0" like a quiet one. Nothing is written.
import type { ServerResponse } from 'node:http';
import type { Workshop } from '../workshop/types';
import type { AgentStore } from './store';

const CODE = /^[A-Za-z0-9_-]{24,128}$/;

export function ringCount(code: string, store: AgentStore, workshop: Workshop): number {
  if (!CODE.test(code)) return 0;
  const museId = store.museForDoorbell(code);
  return museId === null ? 0 : workshop.pending(museId);
}

export function serveDoorbell(res: ServerResponse, method: string | undefined, code: string, store: AgentStore, workshop: Workshop): void {
  const headers = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { ...headers, allow: 'GET, HEAD' }).end('use GET');
    return;
  }
  const body = String(ringCount(code, store, workshop));
  res.writeHead(200, headers).end(method === 'HEAD' ? undefined : body);
}
