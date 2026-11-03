import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPlanetStills } from './planetStills';

describe('each planet’s own postcard stills, from its folder', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function folder(files: Record<string, readonly string[]>): string {
    dir = mkdtempSync(join(tmpdir(), 'planet-stills-'));
    for (const [planet, names] of Object.entries(files)) {
      mkdirSync(join(dir, planet));
      for (const name of names) writeFileSync(join(dir, planet, name), '');
    }
    return dir;
  }

  it('lists each kind’s stills by their numbers, jpg or png, under the planet’s folder', () => {
    const stills = readPlanetStills(folder({ 'violet-dunes': ['friend-10.jpg', 'friend-2.png', 'selfie-1.jpeg', 'new-friend-1.jpg', 'scenery-1.jpg'] }));
    expect(stills.get('violet-dunes')).toEqual({
      friend: ['violet-dunes/friend-2.png', 'violet-dunes/friend-10.jpg'],
      selfie: ['violet-dunes/selfie-1.jpeg'],
      'new-friend': ['violet-dunes/new-friend-1.jpg'],
      scenery: ['violet-dunes/scenery-1.jpg'],
    });
  });

  it('passes over what isn’t a planet’s still: other folders, other kinds, other files, an empty planet', () => {
    const stills = readPlanetStills(
      folder({ 'mossy-hollow': ['friend-1.jpg'], 'golden-rye': ['portrait-1.jpg', 'friend.jpg', 'friend-1.gif', 'notes.txt'], 'cherry-blossom-waterways': [] }),
    );
    expect([...stills.keys()]).toEqual([]);
  });

  it('is none where there is no folder', () => {
    expect(readPlanetStills('/nowhere/at/all').size).toBe(0);
  });
});
