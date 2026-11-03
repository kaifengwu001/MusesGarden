import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CastFile, CastMember, KnownOn, MemberInfo, MuseId, MuseLook } from '../../src/muse/contract';
import { isPlanetId } from '../../src/muse/planets';
import { arr, num, obj, str } from '../adapters/sources/json';

export const FIXTURES_DIR = fileURLToPath(new URL('./', import.meta.url));

const ROLES: readonly CastMember['role'][] = ['hero', 'friend', 'known', 'stranger'];
const NETWORKS: readonly KnownOn[] = ['instagram', 'facebook'];
/** Every body a Muse can wear: a record, so the compiler holds it to MuseLook exactly. */
const LOOKS: Readonly<Record<MuseLook, true>> = {
  tpose6: true,
  muse0: true,
  muse1: true,
  muse2: true,
  muse3: true,
  muse4: true,
  muse5: true,
  muse6: true,
  muse7: true,
  muse8: true,
  muse9: true,
  muse10: true,
  muse11: true,
  muse12: true,
};
const isLook = (v: unknown): v is MuseLook => typeof v === 'string' && Object.hasOwn(LOOKS, v);

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
    if (!isPlanetId(member.planet)) throw new Error(`${at}.planet: ${String(member.planet)}`);
    if (!isLook(member.look)) throw new Error(`${at}.look: ${String(member.look)}`);
    return {
      id: str(member.id, `${at}.id`) as MuseId,
      name: str(member.name, `${at}.name`),
      worldSeed,
      timezone: timezone(member.timezone, `${at}.timezone`),
      dir: str(member.dir, `${at}.dir`),
      role,
      planet: member.planet,
      look: member.look,
    };
  });
  const ids = new Set(members.map((m) => m.id));
  if (ids.size !== members.length) throw new Error('cast: duplicate member id');
  const pair = (a: MuseId, b: MuseId, at: string): void => {
    if (!ids.has(a) || !ids.has(b) || a === b) throw new Error(`${at}: ${a} and ${b} must be two cast members`);
  };
  const introductions = arr(o.introductions, 'introductions').map((p, i): readonly [MuseId, MuseId] => {
    const [a, b] = arr(p, `introductions[${i}]`).map((id) => str(id, `introductions[${i}]`) as MuseId);
    pair(a, b, `introductions[${i}]`);
    return [a, b];
  });
  const knownOn = arr(o.knownOn ?? [], 'knownOn').map((k, i) => {
    const at = `knownOn[${i}]`;
    const edge = obj(k, at);
    const [a, b] = [str(edge.a, `${at}.a`) as MuseId, str(edge.b, `${at}.b`) as MuseId];
    pair(a, b, at);
    const on = NETWORKS.find((n) => n === edge.on);
    if (on === undefined) throw new Error(`${at}.on: ${String(edge.on)}`);
    return { a, b, on };
  });
  return { members, introductions, knownOn };
}

export function loadCast(path = join(FIXTURES_DIR, 'cast.json')): CastFile {
  return parseCastFile(JSON.parse(readFileSync(path, 'utf8')));
}

/** What the views know of each member beyond its seed: its role, its planet and its look. */
export function membersOf(cast: CastFile): ReadonlyMap<MuseId, MemberInfo> {
  return new Map(cast.members.map(({ id, role, planet, look }) => [id, { role, planet, look }]));
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
