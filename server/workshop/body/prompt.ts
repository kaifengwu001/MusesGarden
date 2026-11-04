// What the concepts are asked for. Every concept is an edit of the base Muse (base.jpg) that keeps its pose,
// proportions, silhouette, framing, face plate and white background, and changes only the fur's colour and texture,
// plus what the avatar suggests (ears, one garment, one or two small things) and what Muse asked to wear.
import type { Brief, Verdict } from '../types';

/** What the body is to be, read off Muse's avatar and brief (by the judge, or from the brief alone). */
export interface Design {
  readonly fur: string;
  /** Ears on top of its hood, or null to keep it round. */
  readonly ears: string | null;
  readonly garment: string | null;
  /** At most two small things it wears or carries. */
  readonly things: readonly string[];
}

export const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fur', 'ears', 'garment', 'things'],
  properties: {
    fur: { type: 'string', description: "The plush fur's colour and texture, e.g. 'warm chestnut brown, short and velvety, a beige belly patch'." },
    ears: { type: ['string', 'null'], description: "Ears on top of the hood, e.g. 'two small round bear ears', or null." },
    garment: { type: ['string', 'null'], description: "One garment, e.g. 'a mustard knitted scarf', or null." },
    things: { type: 'array', maxItems: 2, items: { type: 'string' }, description: 'At most two small things it wears or carries.' },
  },
} as const;

export const DESIGN_SYSTEM = [
  "You design a plush toy's look from a character's avatar. The plush's body is fixed: a round, chunky, furry",
  'mascot standing in a T-pose with a smooth pale face plate (two small black eyes, pink cheeks, a small smile).',
  'You choose only: the colour and texture of its fur; ears on top of its hood, if the avatar has ears; at most one',
  'garment; at most two small things. Take them from the avatar and from what the character asked to wear. Never',
  'change the face plate (no snout, muzzle, nose or new eyes), the pose, or the body shape. Keep each answer short',
  'and concrete: colours, materials, sizes.',
].join(' ');

/** The judge's prompt: the brief and notes in words (the avatar picture goes with it). */
export function designPrompt(brief: Brief, notes: readonly string[]): string {
  const lines = [
    `Who it is: ${brief.text}`,
    brief.avatar?.description ? `Its avatar, as described: ${brief.avatar.description}` : null,
    brief.avatar?.image ? 'Its avatar picture is attached.' : 'There is no avatar picture.',
    brief.things?.length ? `What it asked to wear or carry: ${brief.things.join('; ')}` : null,
    brief.must?.length ? `It must have: ${brief.must.join('; ')}` : null,
    brief.never?.length ? `Never: ${brief.never.join('; ')}` : null,
    notes.length ? `Its notes on earlier drafts (follow them): ${notes.join(' / ')}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

/** A design from the brief alone, when no judge answers: the fur from the avatar picture itself. */
export function designFromBrief(brief: Brief): Design {
  const [garment, ...things] = brief.things ?? [];
  return {
    fur: brief.avatar?.image ? "the colours and texture of the avatar's (the second picture)" : brief.avatar?.description ?? brief.text,
    ears: null,
    garment: garment ?? null,
    things: things.slice(0, 2),
  };
}

/** The design held to the rules: one garment, at most two things, short lines. */
export function tidyDesign(d: Design): Design {
  const short = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    fur: short(d.fur) || 'cream',
    ears: d.ears && short(d.ears) ? short(d.ears) : null,
    garment: d.garment && short(d.garment) ? short(d.garment) : null,
    things: d.things.map(short).filter(Boolean).slice(0, 2),
  };
}

const KEEP = [
  'Keep everything else exactly as it is in the first picture:',
  'the same pose, both arms held out to the sides at the same angle and the same length, the same short legs and feet in the same places;',
  'the same chunky rounded proportions and the same silhouette;',
  'the same size and position in the frame, the same straight-on camera, the same framing, nothing cropped;',
  'the same smooth pale face plate set in the hood, with the same two small black eyes, pink cheeks and small smile, the same size and in the same place (no snout, muzzle or nose on it);',
  'the same soft studio light, and the same plain white background with no floor, shadow or props.',
  'A photo of a real plush toy, like the first picture. No text.',
].join(' ');

/** Where a note points, in words (`at` is a spot on a 0–1000 grid of the picture). */
function where(at: readonly [number, number] | undefined): string {
  if (!at) return '';
  const [x, y] = at;
  const col = x < 333 ? 'left' : x > 666 ? 'right' : 'middle';
  const row = y < 333 ? 'top' : y > 666 ? 'bottom' : 'middle';
  return row === col ? ` (at the ${row} of the picture)` : ` (at the ${row} ${col} of the picture)`;
}

/** Muse's notes as lines for a prompt. */
export function noteLines(notes: Verdict['notes']): string[] {
  return (notes ?? []).map((n) => `${n.text.replace(/\s+/g, ' ').trim()}${where(n.at)}`).filter((t) => t.length > 0);
}

/** The edit of base.jpg (images[0]) into one concept; images[1] is the avatar when there is one. */
export function conceptPrompt(design: Design, hasAvatar: boolean, notes: readonly string[]): string {
  const changes = [
    `its fur: ${design.fur}`,
    design.ears ? `add ${design.ears} on top of its hood` : null,
    design.garment ? `dress it in ${design.garment}, fitted to its body without hiding its arms' shape or its face` : null,
    ...design.things.map((t) => `add ${t}, small, worn or held without moving its arms`),
  ].filter((l): l is string => l !== null);
  return [
    "Edit the first picture, a cream plush toy standing in a T-pose. Change only these things:",
    changes.map((c) => `- ${c}`).join('\n'),
    hasAvatar ? "The second picture is the character's avatar: take its colours, fur texture and ears from it, never its pose, body shape, face or style." : null,
    notes.length ? `Also follow these notes: ${notes.join(' / ')}` : null,
    KEEP,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/** One refinement of the picked concept (images[0]), with base.jpg (images[1]) as the pose to hold. */
export function refinePrompt(notes: readonly string[]): string {
  return [
    'Edit the first picture, a plush toy standing in a T-pose. Change only what these notes ask:',
    notes.map((n) => `- ${n}`).join('\n'),
    'The second picture shows the exact pose, proportions, framing and face plate to keep: the plush must stand exactly as it does there, at the same size and in the same place.',
    KEEP,
  ].join('\n');
}
