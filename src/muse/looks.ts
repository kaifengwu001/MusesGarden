// Which bodies a world can draw. Every world draws the original Muse and the dressed muses; a body the workshop made
// (gen-*) loads only where src/life/muse.ts's loader has been taught it (the meadow, and planets forked after it).
import type { KnownLook, MuseLook } from './contract';

const GENERATED = /^gen-/;

export function isGeneratedLook(look: MuseLook): look is `gen-${string}` {
  return GENERATED.test(look);
}

/** The look a world without generated bodies draws instead: the original Muse. */
export function knownLook(look: MuseLook): KnownLook {
  return isGeneratedLook(look) ? 'tpose6' : look;
}
