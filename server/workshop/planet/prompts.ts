// What the planet workshop asks muse-image-1.0 and muse-spark-1.3, in words. The house style is the planets' visual
// contract (docs/planet-reference-handoff.md) cut down to what a picture or a check can use.
import type { Brief } from '../types';
import { ENTRIES_SCHEMA, PARAM_PATHS } from './recipe';

export const HOUSE_STYLE = [
  'Concept art for one tiny planet in a cosy exploration game: a small round world whose curve you can see, with one little home on it where a plush creature lives.',
  'Painted in a soft toon style: flat bands of light and shade, painterly brush strokes in the ground, gentle aerial haze, puffy clouds that cast soft shadows, and water that mirrors the sky.',
  'Whimsical, cute and beautiful, with plausible materials: rock reads as fractured mineral, sand as granular wind-shaped ground, wood as fibrous, leaves as thin living surfaces, cloth as a tensioned sheet.',
  'Bold colour is welcome; muddled materials are not. No uniform clay or candy look, no eerie or bodily-looking shapes, no coiled or piled terrain, no generic noise.',
  'No text, no lettering, no people, no logos, no frame.',
].join(' ');

/**
 * What a planet can be, for the picture model: every planet is a fork of the meadow, so a moodboard that paints a disc,
 * a ring or a pond at the planet's centre promises what no draft can build (Blu picked such pictures, and turned down
 * three drafts that couldn't match them).
 */
export const BUILDABLE = [
  'The planet is always a small sphere of rolling land, about 250 m across, seen as a ball, never a disc, a ring, an island or a cut-away slice.',
  'On it stands one little cottage beside its pond; nothing sits at the planet’s centre, because a sphere has none.',
  'Paint only what such a planet can have: its colours and light, its sky and time of day, grass and wildflowers, ponds and lakes of any shape near the cottage, gentle hills or a rocky knoll, rocks, and small things like lanterns, stones, paths and garden beds.',
  'No other buildings, towers, bridges, cliffs, floating land, waterfalls off the edge, or crowds of objects.',
].join(' ');

/**
 * The same, for the Muse, in each planet round: what the workshop can change and what it can't, so it asks for what can
 * be built and judges the drafts by it.
 */
export const WHAT_CAN_CHANGE =
  'What a planet can be: it is always a small round world of rolling land, about 250 m across, with your cottage beside its pond. The workshop can change its colours, light, sky and time of day, its grass and flowers, the shape and size of its water, its hills and rocks, and small things like lanterns, stones, paths and garden beds. It can’t change the planet’s shape (never a disc, a ring or floating land), move anything to the planet’s “centre” (a sphere has none), or add other buildings.';

/** The six moodboard pictures: the same planet from six places, so Muse picks a look rather than a camera. */
export const MOODBOARD_VIEWS = [
  'The whole planet from space, small and round, its home a speck on it.',
  'A vista across the land from a low rise, the home small in the middle distance.',
  'The home up close from a little above, with the ground around it.',
  'At eye level among the ground cover, plants in front, the sky beyond.',
  'The sky over the land: its clouds and its light.',
  'A bird’s-eye view straight down onto the land: its patches, paths and water.',
] as const;

function briefLines(brief: Brief): string[] {
  const lines = [`The Muse's words for its planet: ${brief.text.trim()}`];
  if (brief.must?.length) lines.push(`It must have: ${brief.must.join('; ')}.`);
  if (brief.never?.length) lines.push(`Never: ${brief.never.join('; ')}.`);
  if (brief.references?.length) lines.push(`Links the Muse found that feel right (only a guide, copy nothing): ${brief.references.join(' ')}`);
  return lines;
}

export function moodboardPrompt(brief: Brief, view: string): string {
  return [HOUSE_STYLE, BUILDABLE, '', ...briefLines(brief), '', `This picture: ${view}`].join('\n');
}

const s = (description: string) => ({ type: 'string', description }) as const;
const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description }) as const;

export const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'items', 'avoid', 'palette', 'params'],
  properties: {
    title: s('A working name for the planet, 1 to 4 words'),
    items: list('4 to 7 things the planet must show, each one short line that can be checked by looking at stills of it'),
    avoid: list('1 to 4 things it must not look like'),
    ...ENTRIES_SCHEMA,
  },
} as const;

export interface ContractAnswer {
  readonly title: string;
  readonly items: readonly string[];
  readonly avoid: readonly string[];
  readonly palette: readonly { readonly time: string; readonly row: string; readonly colours: readonly string[] }[];
  readonly params: readonly { readonly param: string; readonly value: number }[];
}

const RECIPE_RULES = [
  'The planet starts as a copy of the meadow world: rolling green land, ponds and wetlands, four kinds of flowers (pink cups, white stars, yellow buttons, blue clusters), a plaster cottage with a tiled roof by a pond, and clouds.',
  'Its first draft can change only its palette rows and its settings, listed below with what they hold now. Shapes, plants and buildings stay the meadow’s until the Muse’s notes are answered later.',
  'Give a palette row only when it should change; a row may give fewer colours than it has (the rest stay). Every colour is #rrggbb. Keep light and shade columns of a row in order (light, mid, shade), and keep the sky, the water (which mirrors the sky) and the light rows agreeing with each other.',
  `Give a setting only when it should change, as one of: ${PARAM_PATHS.join(', ')}.`,
].join('\n');

export function contractRequest(opts: {
  readonly brief: Brief;
  readonly reasons: readonly string[];
  readonly knobs: string;
  readonly previous?: string;
  readonly notes?: readonly string[];
}): { readonly system: string; readonly prompt: string } {
  const system = [
    'You are the art director of a small game studio that builds a tiny planet for each Muse (a plush creature that lives in the game) from its own words.',
    'From the Muse’s brief and the moodboard pictures it picked, you write the planet’s visual contract (what it must show, what it must not look like) and the recipe its first draft starts from.',
    'The house style: whimsical, cute and beautiful worlds with plausible materials; bold colour is welcome, muddled materials are not; no clay or candy look, no eerie or bodily shapes.',
    `Every item of the contract must be something such a planet can have: ${BUILDABLE} Where the Muse's brief or its pictures ask for more, write the nearest thing that can be built (a pond "at the centre" becomes a round pond beside the cottage).`,
  ].join(' ');
  const prompt = [
    ...briefLines(opts.brief),
    '',
    opts.reasons.length ? `Why the Muse picked these pictures: ${opts.reasons.join(' / ')}` : 'The Muse picked the pictures attached without saying why.',
    ...(opts.previous ? ['', 'The contract you wrote before:', opts.previous] : []),
    ...(opts.notes?.length ? ['', `The Muse's notes on it (answer every one): ${opts.notes.join(' / ')}`] : []),
    '',
    RECIPE_RULES,
    '',
    opts.knobs,
  ].join('\n');
  return { system, prompt };
}

export const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'ok', 'note'],
        properties: { index: { type: 'integer' }, ok: { type: 'boolean' }, note: s('One short line: what the stills show for it') },
      },
    },
  },
} as const;

export interface CheckAnswer {
  readonly items: readonly { readonly index: number; readonly ok: boolean; readonly note: string }[];
}

export function checkRequest(items: readonly string[], captions: readonly string[]): { readonly system: string; readonly prompt: string } {
  return {
    system: 'You check renders of a game world against its visual contract, honestly: an item is ok only if the stills plainly show it. Say what you see, briefly.',
    prompt: [
      `The stills attached, in order: ${captions.join('; ')}.`,
      '',
      'The contract, item by item:',
      ...items.map((item, i) => `${i}. ${item}`),
      '',
      'For each item, by its index: ok (true or false) and one short note.',
    ].join('\n'),
  };
}

export const ADJUST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'palette', 'params'],
  properties: { summary: s('One line: what you changed, for the Muse'), ...ENTRIES_SCHEMA },
} as const;

export interface AdjustAnswer {
  readonly summary: string;
  readonly palette: ContractAnswer['palette'];
  readonly params: ContractAnswer['params'];
}

export function adjustRequest(opts: { readonly contract: string; readonly notes: readonly string[]; readonly knobs: string; readonly captions: readonly string[] }): { readonly system: string; readonly prompt: string } {
  return {
    system: 'You retune a tiny game planet’s colours and settings to answer its Muse’s notes on a draft. Change only what the notes ask for, and keep the rest as it is.',
    prompt: [
      'The visual contract:',
      opts.contract,
      '',
      `The Muse's notes on this draft (answer each as far as colours and settings can): ${opts.notes.join(' / ')}`,
      `The pictures attached: ${opts.captions.join('; ')}.`,
      '',
      RECIPE_RULES,
      '',
      opts.knobs,
    ].join('\n'),
  };
}

export const VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['possible', 'view', 'hours', 'why'],
  properties: {
    possible: { type: 'boolean', description: 'Whether one of the views can show what was asked' },
    view: { type: 'string', enum: ['orbit', 'birds-eye', 'standing', 'vista', 'home', 'eye-level'] },
    hours: { type: 'number', description: 'Time of day in hours, 5.5 to 19, or 0 to keep the planet’s own' },
    why: s('One short line for the Muse'),
  },
} as const;

export interface ViewAnswer {
  readonly possible: boolean;
  readonly view: string;
  readonly hours: number;
  readonly why: string;
}

export function viewRequest(ask: string): { readonly system: string; readonly prompt: string } {
  return {
    system: 'You frame one more still of a tiny game planet from its Muse’s words, choosing among fixed views and a time of day.',
    prompt: [
      `The Muse asked to see: ${ask}`,
      '',
      'The views: orbit (the whole planet from space), birds-eye (70 m up, looking down), standing (4 m up on a rise), vista (the long view across the land), home (the Muse’s home, close), eye-level (1.6 m, among the plants).',
      'Time of day runs 5.5 (dawn) to 19 (dusk); there is no night yet. If no view can show it (inside something, another planet), say so.',
    ].join('\n'),
  };
}
