import { describe, expect, it } from 'vitest';
import { castMembers, readStudio } from './studio';

// The photo studio's URL (studio.ts): whose planet, who is drawn on it, and the planet's seed, from the cast.

describe('the photo studio', () => {
  it('is only there when the URL asks for it', () => {
    expect(readStudio('golden-rye', '')).toBeNull();
    expect(readStudio('meadow', '?visit=inv-1&as=hero')).toBeNull();
  });

  it('draws each world’s own friend in its look, on its seed, with Momo beside it', () => {
    const cast = castMembers();
    const worlds = ['golden-rye', 'cherry-blossom-waterways', 'sequoia-shrine', 'violet-dunes', 'tulip-windmill-meadows', 'scarlet-sail-canyon', 'cobalt-windfields', 'lantern-reed-gardens', 'ukiyoe-pine-hamlet'] as const;
    for (const planet of worlds) {
      const own = cast.find((m) => m.planet === planet);
      expect(own, planet).toBeDefined();
      expect(readStudio(planet, '?studio')).toEqual({
        planet,
        seed: own?.worldSeed,
        host: { name: own?.name, look: own?.look },
        guest: { name: 'Momo', look: 'tpose6' },
        dressHost: true,
      });
    }
    expect(readStudio('golden-rye', '?studio')?.host).toEqual({ name: 'Kiki', look: 'muse5' });
    expect(readStudio('cobalt-windfields', '?studio')?.host).toEqual({ name: 'Dorie', look: 'muse0' });
  });

  it('takes another look for either Muse from the URL, named as the cast names whoever wears it', () => {
    const s = readStudio('lantern-reed-gardens', '?studio&host=muse5&guest=muse8');
    expect(s?.host).toEqual({ name: 'Kiki', look: 'muse5' });
    expect(s?.guest).toEqual({ name: 'Moss', look: 'muse8' });
    // (no such look: the cast's own)
    expect(readStudio('lantern-reed-gardens', '?studio&host=muse99&guest=clay')).toMatchObject({ host: { look: 'muse11' }, guest: { look: 'tpose6' } });
  });

  it('on the meadow, Momo as it is, and a friend only when the URL names one', () => {
    expect(readStudio('meadow', '?studio')).toEqual({ planet: 'meadow', seed: null, host: { name: 'Momo', look: 'tpose6' }, guest: null, dressHost: false });
    expect(readStudio('meadow', '?studio&with=muse6')).toMatchObject({ guest: { name: 'Hoji', look: 'muse6' }, dressHost: false });
  });
});
