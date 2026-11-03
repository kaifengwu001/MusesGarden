import { salt } from '../../core/hash';
import type { PhotoSubject } from '../../muse/contract';

/** What a postcard's photo shows: one of the subjects of Muse's photos, the whole planet from beyond it, or an invitation. */
export type StillKey = PhotoSubject | 'beyond' | 'invitation';

/**
 * The photos a postcard can show, by what each shows: file names in this folder. The numbered ones are stills of the
 * meadow, rendered by tools/workflows/drive-app/scripts/postcard-stills.mjs (npm run postcard-stills); the five named
 * ones are the first stand-ins, each of two Muses.
 */
export const STILLS: Readonly<Record<StillKey, readonly string[]>> = {
  scenery: ['scenery-1.jpg', 'scenery-2.jpg', 'scenery-3.jpg', 'scenery-4.jpg', 'scenery-5.jpg', 'scenery-6.jpg'],
  sky: ['sky-1.jpg', 'sky-2.jpg', 'sky-3.jpg', 'sky-4.jpg'],
  closeup: ['closeup-1.jpg', 'closeup-2.jpg', 'closeup-3.jpg'],
  creature: ['creature-1.jpg', 'creature-2.jpg', 'creature-3.jpg', 'creature-4.jpg'],
  find: ['find-1.jpg', 'find-2.jpg', 'find-3.jpg'],
  selfie: ['selfie-1.jpg', 'selfie-2.jpg', 'selfie-3.jpg', 'selfie-4.jpg', 'selfie-5.jpg'],
  work: ['work-1.jpg', 'work-2.jpg', 'work-3.jpg'],
  home: ['home-1.jpg', 'home-2.jpg', 'home-3.jpg', 'home-4.jpg'],
  friend: ['friend-1.jpg', 'friend-2.jpg', 'terrace.jpg', 'close.jpg', 'cottage.jpg'],
  'new-friend': ['new-friend-1.jpg', 'pier.jpg', 'meadow.jpg'],
  beyond: ['beyond-1.jpg', 'beyond-2.jpg', 'beyond-3.jpg'],
  invitation: ['invitation-1.jpg', 'invitation-2.jpg', 'pier.jpg'],
};

/** The still a photo shows: one of its key's, picked by the photo's id, so the photo always shows the same one. */
export function stillFor(key: StillKey, id: string): string {
  const stills = STILLS[key];
  return stills[salt(id) % stills.length];
}
