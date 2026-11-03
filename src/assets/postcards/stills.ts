import { salt } from '../../core/hash';
import type { PhotoSubject } from '../../muse/contract';

/** What a postcard's photo shows: one of the subjects of Muse's photos, the whole planet from beyond it, or an invitation. */
export type StillKey = PhotoSubject | 'beyond' | 'invitation';

/**
 * The photos a postcard can show, by what each shows: file names in this folder. The numbered ones are stills of the
 * meadow, rendered by tools/workflows/drive-app/scripts/postcard-stills.mjs (npm run postcard-stills). (The named
 * ones beside them, the first stand-ins, are kept for the placeholder post only.)
 */
export const STILLS: Readonly<Record<StillKey, readonly string[]>> = {
  scenery: ['scenery-1.jpg', 'scenery-2.jpg', 'scenery-3.jpg', 'scenery-4.jpg', 'scenery-5.jpg', 'scenery-6.jpg', 'scenery-7.jpg', 'scenery-8.jpg'],
  sky: ['sky-1.jpg', 'sky-2.jpg', 'sky-3.jpg', 'sky-4.jpg'],
  closeup: ['closeup-1.jpg', 'closeup-2.jpg', 'closeup-3.jpg', 'closeup-4.jpg', 'closeup-5.jpg', 'closeup-6.jpg'],
  creature: ['creature-1.jpg', 'creature-2.jpg', 'creature-3.jpg', 'creature-4.jpg', 'creature-5.jpg'],
  find: ['find-1.jpg', 'find-2.jpg', 'find-3.jpg'],
  selfie: ['selfie-1.jpg', 'selfie-2.jpg', 'selfie-3.jpg', 'selfie-4.jpg', 'selfie-5.jpg', 'selfie-6.jpg', 'selfie-7.jpg', 'selfie-8.jpg', 'selfie-9.jpg', 'selfie-10.jpg', 'selfie-11.jpg', 'selfie-12.jpg', 'selfie-13.jpg', 'selfie-14.jpg'],
  work: ['work-1.jpg', 'work-2.jpg', 'work-3.jpg', 'work-4.jpg', 'work-5.jpg', 'work-6.jpg'],
  home: ['home-1.jpg', 'home-2.jpg', 'home-3.jpg', 'home-4.jpg', 'home-5.jpg', 'home-6.jpg', 'home-7.jpg', 'home-8.jpg'],
  friend: ['friend-1.jpg', 'friend-2.jpg', 'friend-3.jpg', 'friend-4.jpg', 'friend-5.jpg', 'friend-6.jpg'],
  'new-friend': ['new-friend-1.jpg', 'new-friend-2.jpg', 'new-friend-3.jpg'],
  beyond: ['beyond-1.jpg', 'beyond-2.jpg', 'beyond-3.jpg'],
  invitation: ['invitation-1.jpg', 'invitation-2.jpg', 'invitation-3.jpg'],
};

/** The still a photo shows: one of its key's, picked by the photo's id, so the photo always shows the same one. */
export function stillFor(key: StillKey, id: string): string {
  const stills = STILLS[key];
  return stills[salt(id) % stills.length];
}
