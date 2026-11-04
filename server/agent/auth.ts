// Who is calling: a real Muse's API key (Authorization: Bearer mg_...), 60 requests a minute each, and the admin
// token that lets `npm run agent:key` on this laptop make a key. Keys are shown once and kept only as sha256.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import type { AgentCommands, MuseId, MuseLook } from '../../src/muse/contract';
import { isPlanetId } from '../../src/muse/planets';
import type { AgentStore } from './store';

export const KEY_PREFIX = 'mg_';
const KEY = /^mg_[A-Za-z0-9_-]{43}$/;
const PER_MINUTE = 60;
const MINUTE_MS = 60_000;

/** A new API key: 32 random bytes, base64url, after "mg_". */
export function mintKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** 32 url-safe characters: the doorbell's link needs no key, so the code itself must be unguessable. */
export function mintDoorbellCode(): string {
  return randomBytes(24).toString('base64url');
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The bearer token of a request, or null. */
export function bearer(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
  return m === null ? null : m[1];
}

/** The Muse a request's key belongs to, or null for no key, a malformed one or one this garden never made. */
export function museOfRequest(req: IncomingMessage, store: AgentStore): { readonly museId: MuseId; readonly keyHash: string } | null {
  const key = bearer(req);
  if (key === null || !KEY.test(key)) return null;
  const keyHash = hashKey(key);
  const museId = store.museForKey(keyHash);
  return museId === null ? null : { museId, keyHash };
}

export interface RateLimit {
  /** Counts one request by `key` at wall time `nowMs`: null if it may go ahead, else when (wall ms) the next one may. */
  take(key: string, nowMs: number): number | null;
}

/** At most 60 requests in any minute per key (a sliding window, in memory: a restart forgives everyone). */
export function rateLimit(perMinute = PER_MINUTE): RateLimit {
  const seen = new Map<string, number[]>();
  return {
    take(key, nowMs) {
      const recent = (seen.get(key) ?? []).filter((t) => t > nowMs - MINUTE_MS);
      if (recent.length >= perMinute) {
        seen.set(key, recent);
        return recent[0] + MINUTE_MS;
      }
      recent.push(nowMs);
      seen.set(key, recent);
      return null;
    },
  };
}

// ─── The admin route: npm run agent:key ─────────────────────────────────────

export const ADMIN_TOKEN_FILE = 'admin.token';

/** A fresh admin token for this boot, written to <dataDir>/admin.token for the CLI (readable by this user only). */
export function writeAdminToken(dataDir: string): string {
  const token = randomBytes(32).toString('base64url');
  const path = join(dataDir, ADMIN_TOKEN_FILE);
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

export function sameToken(given: string | null, token: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A request that came in through the tunnel rather than from this laptop: tunnels say who they forwarded for. */
export function forwarded(req: IncomingMessage): boolean {
  return ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some((h) => req.headers[h] !== undefined);
}

const LOOK = /^(tpose6|muse([0-9]|1[0-2])|gen-[a-z0-9][a-z0-9-]{0,63})$/;

export const AdminKeyRequest = z.object({
  muse: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'muse must be lowercase letters, digits and hyphens'),
  name: z.string().trim().min(1).max(40).optional(),
  planet: z.string().refine(isPlanetId, 'no such planet').optional(),
  look: z.string().regex(LOOK, 'no such look').optional(),
  timezone: z.string().min(1).max(64).optional(),
});
export type AdminKeyRequest = z.infer<typeof AdminKeyRequest>;

export interface MintedKey {
  readonly muse: MuseId;
  readonly added: boolean;
  /** Shown once: only its hash is kept. */
  readonly key: string;
  readonly doorbell: string;
}

/** A seed for a Muse added by the CLI: the same every time for the same id, so its world doesn't change between tries. */
function seedOf(museId: string): number {
  return createHash('sha256').update(museId).digest().readUInt32BE(0) >>> 1;
}

function validTimezone(tz: string | undefined): string {
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'America/Los_Angeles';
  }
}

/** Makes the Muse a real one (adding it if the garden doesn't have it), then gives it a new key and its doorbell. */
export async function mintAgentKey(
  ask: AdminKeyRequest,
  commands: AgentCommands,
  store: AgentStore,
  at: number,
): Promise<{ readonly ok: true; readonly value: MintedKey } | { readonly ok: false; readonly status: number; readonly error: string }> {
  const museId = ask.muse as MuseId;
  const name = ask.name ?? ask.muse.charAt(0).toUpperCase() + ask.muse.slice(1);
  const added = await commands.addAgentMuse(museId, {
    name,
    planet: (ask.planet ?? 'meadow'),
    look: (ask.look ?? 'tpose6') as MuseLook,
    worldSeed: seedOf(ask.muse),
    timezone: validTimezone(ask.timezone),
  });
  if (!added.ok) return { ok: false, status: added.status, error: added.error };
  const key = mintKey();
  const { doorbell } = store.setKey(museId, hashKey(key), mintDoorbellCode(), at);
  return { ok: true, value: { muse: museId, added: added.value.added, key, doorbell } };
}
