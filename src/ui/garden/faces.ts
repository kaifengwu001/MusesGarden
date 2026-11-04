import museFace from '../../assets/garden/muse-face.jpg';
import { generatedUrl, isGeneratedLook } from '../../muse/looks';

// Each Muse's face as the garden shows it, by the body it wears (a MuseLook, src/muse/contract.ts): the original
// Muse's own, one for each of the muses in clothes (src/assets/garden/faces/<look>.jpg, head and shoulders on the
// garden's warm ground, cut from the lab's front renders of each body), and for a body the workshop made, the
// portrait the engine serves with it (/api/looks/<id>.jpg).

const DRESSED = import.meta.glob<string>('/src/assets/garden/faces/*.jpg', { import: 'default', eager: true });

/** The face of a Muse in this look, or null for a look with no face of its own (the caller shows a stand-in). */
export function faceOf(look: string | undefined): string | null {
  if (!look) return null;
  if (look === 'tpose6') return museFace;
  if (isGeneratedLook(look)) return generatedUrl(look, 'jpg');
  return DRESSED[`/src/assets/garden/faces/${look}.jpg`] ?? null;
}
