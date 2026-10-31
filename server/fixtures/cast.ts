import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CastFile, CastMember, MuseId } from '../../src/muse/contract';
import { arr, num, obj, str } from '../adapters/sources/json';

export const FIXTURES_DIR = fileURLToPath(new URL('./', import.meta.url));

const ROLES: readonly CastMember['role'][] = ['hero', 'friend', 'stranger'];

function timezone(v: unknown, what: string): string {
  const zone = str(v, what);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new Error(`${what}: ${zone} is not an IANA time zone`);
  }
  return zone;
}

/** The parse boundary for cast.json: the only place fixture strings become MuseId. */
export function parseCastFile(raw: unknown): CastFile {
  const o = obj(raw, 'cast');
  const members = arr(o.members, 'members').map((m, i): CastMember => {
    const at = `members[${i}]`;
    const member = obj(m, at);
    const role = ROLES.find((r) => r === member.role);
    if (role === undefined) throw new Error(`${at}.role: ${String(member.role)}`);
    const worldSeed = num(member.worldSeed, `${at}.worldSeed`);
    if (!Number.isInteger(worldSeed) || worldSeed < 0 || worldSeed > 9999) throw new Error(`${at}.worldSeed: ${worldSeed}`);
    return {
      id: str(member.id, `${at}.id`) as MuseId,
      name: str(member.name, `${at}.name`),
      worldSeed,
      timezone: timezone(member.timezone, `${at}.timezone`),
      dir: str(member.dir, `${at}.dir`),
      role,
    };
  });
  const ids = new Set(members.map((m) => m.id));
  if (ids.size !== members.length) throw new Error('cast: duplicate member id');
  const introductions = arr(o.introductions, 'introductions').map((p, i): readonly [MuseId, MuseId] => {
    const [a, b] = arr(p, `introductions[${i}]`).map((id) => str(id, `introductions[${i}]`) as MuseId);
    if (!ids.has(a) || !ids.has(b) || a === b) throw new Error(`introductions[${i}]: ${a} and ${b} must be two cast members`);
    return [a, b];
  });
  return { members, introductions };
}

export function loadCast(path = join(FIXTURES_DIR, 'cast.json')): CastFile {
  return parseCastFile(JSON.parse(readFileSync(path, 'utf8')));
}

export interface MemberDocs {
  readonly soul: string;
  readonly memory: string;
}

/** A member's SOUL.md and MEMORY.md. The hero's real files, once added, win over its placeholders. */
export function readMemberDocs(member: Pick<CastMember, 'dir'>, root = FIXTURES_DIR): MemberDocs {
  const read = (doc: 'SOUL' | 'MEMORY') => {
    const real = join(root, member.dir, `${doc}.md`);
    return readFileSync(existsSync(real) ? real : join(root, member.dir, `${doc}.placeholder.md`), 'utf8');
  };
  return { soul: read('SOUL'), memory: read('MEMORY') };
}
