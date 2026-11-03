import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STILLS, type PlanetStills, type StillKey } from '../../src/assets/postcards/stills';
import { isPlanetId } from '../../src/muse/planets';

// Each planet's own postcard stills, as they sit on disk: src/assets/postcards/<planet>/<key>-<n>.jpg (or .png),
// screenshots taken on that planet. Read again now and then, so stills dropped in show without a restart.

export const POSTCARDS_DIR = fileURLToPath(new URL('../../src/assets/postcards/', import.meta.url));

/** A planet's still's file name: what it shows (a StillKey) and its number. */
export const PLANET_STILL = /^([a-z]+(?:-[a-z]+)*)-(\d+)\.(?:jpe?g|png)$/;
/** How long a reading of the folders is kept (ms). */
const KEEP_MS = 5_000;

const isKey = (k: string): k is StillKey => Object.hasOwn(STILLS, k);

/** Every planet's stills in `dir` (a folder of planet folders), each kind's in the order of their numbers. */
export function readPlanetStills(dir: string = POSTCARDS_DIR): ReadonlyMap<string, PlanetStills> {
  const out = new Map<string, PlanetStills>();
  let planets: string[];
  try {
    planets = readdirSync(dir).filter((name) => isPlanetId(name) && statSync(join(dir, name)).isDirectory());
  } catch {
    return out;
  }
  for (const planet of planets.sort()) {
    const byKey = new Map<StillKey, { n: number; file: string }[]>();
    for (const file of readdirSync(join(dir, planet))) {
      const m = PLANET_STILL.exec(file);
      if (!m || !isKey(m[1])) continue;
      const list = byKey.get(m[1]) ?? [];
      list.push({ n: Number(m[2]), file: `${planet}/${file}` });
      byKey.set(m[1], list);
    }
    if (byKey.size === 0) continue;
    out.set(planet, Object.fromEntries([...byKey].map(([key, list]) => [key, list.sort((a, b) => a.n - b.n).map((s) => s.file)])));
  }
  return out;
}

let kept: { readonly at: number; readonly stills: ReadonlyMap<string, PlanetStills> } | null = null;

/** The planets' stills now, read from disk at most every few seconds. */
export function planetStills(): ReadonlyMap<string, PlanetStills> {
  const now = Date.now();
  if (!kept || now - kept.at > KEEP_MS) kept = { at: now, stills: readPlanetStills() };
  return kept.stills;
}
