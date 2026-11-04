// The pose check: a concept must stand exactly as the base Muse does (base.jpg), because the 3D step and the rig
// are tuned for that T-pose. Both pictures are segmented ("plush toy", and "face" for its plate) and compared.
import sharp from 'sharp';
import type { Box, Segment, Segmenter } from '../clients';

/** The limits, as shares of the picture's width (x) or height (y). */
export const POSE = {
  /** Of the base's plush, at least this much is still covered by the concept's (when the segmenter gives masks). */
  cover: 0.9,
  /** Each arm's tip (the plush's leftmost and rightmost extent) within this of where it was. */
  arms: 0.03,
  /** The feet (the plush's lowest extent) within this. */
  feet: 0.03,
  /** The top may rise this far for ears or a hat, but not sink more than `feet`. */
  ears: 0.15,
  /** With boxes only: the plush's area within this of the base's, before ears (measured below the base's top). */
  area: 0.05,
  /** Each edge of the face plate's box within this. */
  face: 0.03,
} as const;

/** What the segmenter saw in one picture, kept so the base is segmented once per job. */
export interface Seen {
  readonly width: number;
  readonly height: number;
  readonly plush: Box | null;
  /** The plush's mask as 0/1 bytes, row by row, or null if the segmenter gave only a box. */
  readonly mask: Uint8Array | null;
  readonly face: Box | null;
}

export interface PoseCheck {
  readonly ok: boolean;
  /** Of the base's mask, how much the concept's covers (null without masks). */
  readonly cover: number | null;
  /** How far the arms' tips moved (left, right), the feet and the top, the face's furthest edge: shares of the picture. */
  readonly arms: readonly [number, number] | null;
  readonly feet: number | null;
  readonly top: number | null;
  readonly face: number | null;
  /** Why it failed, in plain words (empty when it passed). */
  readonly reasons: readonly string[];
}

const area = (b: Box): number => Math.max(0, b[2] - b[0] + 1) * Math.max(0, b[3] - b[1] + 1);
const largest = (segments: readonly Segment[]): Segment | null => segments.reduce<Segment | null>((best, s) => (!best || area(s.box) > area(best.box) ? s : best), null);

/** Segments the picture: its plush (the largest found, with its mask if any) and its face plate. */
export async function see(image: Buffer, segmenter: Segmenter, signal?: AbortSignal): Promise<Seen> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const plush = largest(await segmenter.find(image, 'plush toy', signal));
  const face = largest(await segmenter.find(image, 'face', signal));
  let mask: Uint8Array | null = null;
  if (plush?.mask) {
    const { data, info } = await sharp(plush.mask).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * info.channels] >= 128 ? 1 : 0;
  }
  return { width, height, plush: plush?.box ?? null, mask, face: face?.box ?? null };
}

/** The mask's extents as a box (corners inclusive), or null if it's empty. */
function extents(mask: Uint8Array, width: number): Box | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  return Number.isFinite(x1) ? [x1, y1, x2, y2] : null;
}

const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;

/** Whether `concept` keeps `base`'s pose (both the same size: concepts are resized to the base's). */
export function comparePose(base: Seen, concept: Seen): PoseCheck {
  const reasons: string[] = [];
  if (!base.plush) return { ok: false, cover: null, arms: null, feet: null, top: null, face: null, reasons: ['the base Muse itself was not found (the segmenter saw no plush toy)'] };
  if (!concept.plush) return { ok: false, cover: null, arms: null, feet: null, top: null, face: null, reasons: ['no plush toy was found in it'] };
  if (concept.width !== base.width || concept.height !== base.height) reasons.push(`it is ${concept.width}×${concept.height}, not the base's ${base.width}×${base.height}`);
  const masks = base.mask && concept.mask && base.mask.length === concept.mask.length ? { base: base.mask, concept: concept.mask } : null;
  const b = (masks ? extents(masks.base, base.width) : null) ?? base.plush;
  const c = (masks ? extents(masks.concept, concept.width) : null) ?? concept.plush;
  const W = base.width;
  const H = base.height;

  let cover: number | null = null;
  if (masks) {
    let inBase = 0;
    let both = 0;
    for (let i = 0; i < masks.base.length; i++) {
      if (!masks.base[i]) continue;
      inBase++;
      if (masks.concept[i]) both++;
    }
    cover = inBase ? both / inBase : 0;
    if (cover < POSE.cover) reasons.push(`it covers only ${pct(cover)} of the base's body (needs ${pct(POSE.cover)})`);
  }

  const arms = [Math.abs(c[0] - b[0]) / W, Math.abs(c[2] - b[2]) / W] as const;
  if (arms[0] > POSE.arms) reasons.push(`its right arm's tip moved ${pct(arms[0])} of the width (at most ${pct(POSE.arms)})`);
  if (arms[1] > POSE.arms) reasons.push(`its left arm's tip moved ${pct(arms[1])} of the width (at most ${pct(POSE.arms)})`);
  const feet = Math.abs(c[3] - b[3]) / H;
  if (feet > POSE.feet) reasons.push(`its feet moved ${pct(feet)} of the height (at most ${pct(POSE.feet)})`);
  // (the top may rise for ears or a hat, never sink: positive is higher than the base's)
  const top = (b[1] - c[1]) / H;
  if (top < -POSE.feet) reasons.push(`its head sank ${pct(-top)} of the height`);
  if (top > POSE.ears) reasons.push(`its top rose ${pct(top)} of the height (ears or a hat may add at most ${pct(POSE.ears)})`);
  if (!masks) {
    // (boxes only: compare the area below the base's top, so ears don't count against it)
    const below: Box = [c[0], Math.max(c[1], b[1]), c[2], c[3]];
    const change = Math.abs(area(below) - area(b)) / area(b);
    if (change > POSE.area) reasons.push(`its body's box changed ${pct(change)} in area (at most ${pct(POSE.area)})`);
  }

  let face: number | null = null;
  if (base.face) {
    if (!concept.face) reasons.push('its face plate was not found');
    else {
      const f = base.face;
      const g = concept.face;
      face = Math.max(Math.abs(g[0] - f[0]) / W, Math.abs(g[2] - f[2]) / W, Math.abs(g[1] - f[1]) / H, Math.abs(g[3] - f[3]) / H);
      if (face > POSE.face) reasons.push(`its face plate moved ${pct(face)} (at most ${pct(POSE.face)})`);
    }
  }
  return { ok: reasons.length === 0, cover, arms, feet, top, face, reasons };
}

/** One line for Muse's checklist: what the check measured. */
export function describe(check: PoseCheck): string {
  if (!check.ok) return check.reasons.join('; ');
  const parts: string[] = [];
  if (check.cover !== null) parts.push(`covers ${pct(check.cover)} of the base's body`);
  if (check.arms) parts.push(`arms within ${pct(Math.max(...check.arms))}`);
  if (check.face !== null) parts.push(`face plate within ${pct(check.face)}`);
  return parts.join(', ');
}
