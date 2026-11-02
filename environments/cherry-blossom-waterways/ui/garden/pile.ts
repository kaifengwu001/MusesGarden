// Where each card lies in a pile of post. The top few fan out, each a little
// lower than the one above; every deeper card lies hidden under the last of
// them, so a pile of any size covers the same ground as a pile of six.

/** A card's place: offset from the stage's centre in px, tilt in degrees, scale, and whether it shows. */
export interface Slot {
  x: number;
  y: number;
  r: number;
  s: number;
  shown: boolean;
}

/** How many cards of a pile show. */
export const PILE_SHOWN = 6;

const seed = (k: number): number => Math.sin((k + 1) * 91.7) * 0.5;

/** Card k (0 on top) of the stack on the table. */
export function stackSlot(k: number): Slot {
  const d = Math.min(k, PILE_SHOWN - 1);
  const t = seed(k);
  return { x: t * 26 + (k % 2 ? 6 : -6), y: d * 5 - 8, r: t * 7 + (k === 0 ? -1.5 : 0), s: 1 - d * 0.012, shown: k < PILE_SHOWN };
}

/** Card i of the pile under the focused card k: the cards before k lean left, those after it right. */
export function underSlot(i: number, k: number): Slot {
  const depth = i < k ? i : i - 1;
  const d = Math.min(depth, PILE_SHOWN - 1);
  const t = seed(i);
  return { x: t * 40 + (i < k ? -30 : 30), y: 150 + d * 4, r: t * 10, s: 0.62, shown: depth < PILE_SHOWN };
}
