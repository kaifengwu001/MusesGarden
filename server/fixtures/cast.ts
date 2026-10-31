import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CastFile, CastMember, MuseId, Temperament } from '../../src/muse/contract';
import { arr, num, obj, str } from '../adapters/sources/json';

export const FIXTURES_DIR = fileURLToPath(new URL('./', import.meta.url));

const ROLES: readonly CastMember['role'][] = ['hero', 'friend', 'stranger'];
export const TRAITS: readonly (keyof Temperament)[] = ['curiosity', 'focus', 'sociability', 'whimsy', 'novelty'];

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

export interface Soul {
  readonly name?: string;
  /** Only the traits the frontmatter states; the Mind estimates the rest. */
  readonly temperament: Partial<Temperament>;
  /** The prose after the frontmatter. */
  readonly body: string;
}

/** SOUL.md: optional flat `key: value` frontmatter between `---` fences, then prose. */
export function parseSoul(text: string): Soul {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fence === null) return { temperament: {}, body: text.trim() };
  const fields = new Map(
    fence[1].split(/\r?\n/).flatMap((line) => {
      const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
      return m === null ? [] : [[m[1].toLowerCase(), m[2]] as const];
    }),
  );
  const temperament: Partial<Record<keyof Temperament, number>> = {};
  for (const trait of TRAITS) {
    const raw = fields.get(trait);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (raw === '' || !(value >= 0 && value <= 1)) throw new Error(`SOUL.md ${trait}: ${raw} is not in [0, 1]`);
    temperament[trait] = value;
  }
  const name = fields.get('name');
  return { ...(name ? { name } : {}), temperament, body: text.slice(fence[0].length).trim() };
}

/** The bullet items under a `## heading` of a Markdown document, without their markers. */
export function sectionBullets(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const bullet = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (bullet !== null) out.push(bullet[1]);
  }
  return out;
}
