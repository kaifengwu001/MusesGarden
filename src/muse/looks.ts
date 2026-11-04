// Which bodies a world can draw. Every world draws the original Muse and the dressed muses; a body the workshop made
// (gen-*) loads only where src/life/muse.ts's loader has been taught it (the meadow, and planets forked after it).
import type { GeneratedLook, KnownLook, MuseLook } from './contract';

/** The original Muse and the muses in clothes (src/life/museMesh.ts DRESSED). */
const KNOWN = /^(tpose6|muse([0-9]|1[0-2]))$/;
/** A body the workshop made: gen-<muse>-<n>, lower-case letters, digits and dashes (as server/fixtures/cast.ts reads it). */
const GENERATED = /^gen-[a-z0-9][a-z0-9-]*$/;

export function isKnownLook(look: string): look is KnownLook {
  return KNOWN.test(look);
}

export function isGeneratedLook(look: string): look is GeneratedLook {
  return GENERATED.test(look);
}

/** Any body a Muse can wear (a URL's or a server's string checked). */
export function isLook(look: unknown): look is MuseLook {
  return typeof look === 'string' && (isKnownLook(look) || isGeneratedLook(look));
}

/** Where the engine serves a made body's files: its model (.glb), its rig's overrides (.json), its portrait (.jpg). */
export function generatedUrl(look: GeneratedLook, file: 'glb' | 'json' | 'jpg'): string {
  return `/api/looks/${look}.${file}`;
}

/** The look a world without generated bodies draws instead: the original Muse. */
export function knownLook(look: MuseLook): KnownLook {
  return isKnownLook(look) ? look : 'tpose6';
}
