// The connector's twelve tools, as Muse reads them in tools/list, and the one way every call runs: its input checked,
// a write's request_id honoured (a repeat gets the first reply back and runs nothing), at most 40 s, and pictures and
// times in the reply made readable (absolute links on the garden's origin, ISO times).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentResult, DiscoveryId, Instant, MuseId, PhotoId, PostcardWords, TripReport } from '../../src/muse/contract';
import type { Brief, JobView, Verdict } from '../workshop/types';
import type { AgentStore } from './store';
import type { ToolContext, ToolDef } from './types';

/** A refusal at the connector: the engine's (AgentResult) or its own (400, 500, 503). */
export interface Failure {
  readonly status: number;
  readonly error: string;
  readonly retryAfter?: Instant;
}
export type Outcome = { readonly ok: true; readonly value: unknown } | ({ readonly ok: false } & Failure);

/** Under the 45 s every call must answer in, with room for the round trip. */
export const TOOL_TIMEOUT_MS = 40_000;
const STILL_WORKING_RETRY_MS = 60_000;

// ─── Inputs ─────────────────────────────────────────────────────────────────

const ID = /^[\w.:~-]{1,128}$/;
// (checked by refine, not a pattern, so tools/list stays short)
const id = (what: string) => z.string().refine((v) => ID.test(v), `${what} must be an id`);
const words = (max: number) => z.string().trim().min(1).max(max);
const link = z.url({ protocol: /^https?$/ }).max(2048);

const REQUEST_ID = z
  .string()
  .min(1)
  .max(128)
  .describe('A new id for each action. Resending it is safe: you get the first reply.');

const SHORT = 280;

const BACK = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('line'), text: words(SHORT) }),
    z.object({ kind: z.literal('doodle'), caption: words(SHORT) }),
    z.object({ kind: z.literal('map'), label: words(SHORT) }),
    z.object({ kind: z.literal('note'), title: words(SHORT), lines: z.array(words(SHORT)).min(1).max(6) }),
    z.object({ kind: z.literal('list'), title: words(SHORT), items: z.array(z.object({ text: words(SHORT), done: z.boolean() })).min(1).max(8) }),
    z.object({ kind: z.literal('pressed'), label: words(SHORT) }),
    z.object({ kind: z.literal('ticket'), note: words(SHORT) }),
    z.object({ kind: z.literal('game'), caption: words(SHORT) }),
    z.object({ kind: z.literal('riddle'), question: words(SHORT), answer: words(SHORT) }),
    z.object({ kind: z.literal('tally'), what: words(SHORT), count: z.int().min(0).max(9999) }),
    z.object({ kind: z.literal('poem'), lines: z.array(words(SHORT)).min(1).max(8) }),
  ])
  .describe('The back: a kind and its words, e.g. {"kind":"line","text":"..."} or {"kind":"riddle","question":"...","answer":"..."}.');

const TRAIT = z.number().min(0).max(1);

const AVATAR_IMAGE = z
  .string()
  .max(2_800_000)
  .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'image must be a data: URL of a PNG, JPEG or WebP')
  .describe('Your app avatar (avatar.get) as a data: URL, base64, at most 2 MB.');

const VERDICT = z.object({
  approve: z.boolean().optional().describe('true to approve what is on show.'),
  name: words(40).optional().describe('Your planet’s name, when you approve a planet.'),
  picks: z.array(id('a pick')).min(1).max(6).optional().describe('Picture ids, when the round asks you to pick.'),
  notes: z
    .array(
      z.object({
        text: words(300),
        picture: id('picture').optional(),
        at: z.array(z.number().min(0).max(1000)).length(2).optional().describe('[x, y] on a 0–1000 grid of the picture (from visual_grounding).'),
      }),
    )
    .max(3)
    .optional()
    .describe('Up to 3 things to change.'),
});

// ─── The tools ──────────────────────────────────────────────────────────────

const tool = <I extends z.ZodType>(def: ToolDef<I>): ToolDef<I> => def;
const done = <T>(r: AgentResult<T>): Promise<AgentResult<unknown>> => Promise.resolve(r);
const ok = <T>(value: T): AgentResult<T> => ({ ok: true, value });
const refuse = (status: 403 | 404, error: string): AgentResult<never> => ({ ok: false, status, error });

/** What a round waiting looks like in the letterbox, and a job still working (when to look again). */
function workshopNews(jobs: readonly JobView[]) {
  return {
    rounds: jobs.filter((j) => j.state === 'waiting'),
    working: jobs.filter((j) => j.state === 'working').map((j) => ({ id: j.id, kind: j.kind, stage: j.stage, nextRoundAt: j.nextRoundAt, message: j.message })),
  };
}

/**
 * A line for Muse to pass on to its owner, who can't know when the workshop will have something new, nor what to say
 * to see it: when the next pictures will be ready, and the words that bring Muse back to look ("check your garden").
 * Null when nothing is being made or waiting.
 */
export function ownerLine(jobs: readonly JobView[], now: number): string | null {
  const named = (list: readonly JobView[]): string => {
    const kinds = [...new Set(list.map((j) => j.kind))];
    return `my ${kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0]}`;
  };
  const waiting = jobs.filter((j) => j.state === 'waiting');
  const working = jobs.filter((j) => j.state === 'working');
  const say = 'Say "check your garden" to see them with me.';
  if (working.length) {
    const ms = Math.min(...working.map((j) => j.nextRoundAt ?? now)) - now;
    const minutes = Math.round(ms / 60_000);
    const when = ms <= 90_000 ? 'in about a minute' : minutes <= 2 ? 'in a few minutes' : `in about ${minutes} minutes`;
    return `New pictures of ${named(working)} ${when}. ${say}`;
  }
  if (waiting.length) return `New pictures of ${named(waiting)} are ready. ${say}`;
  return null;
}

/** A write's reply with the line for Muse's owner added (`tellYourOwner`), when there's something to tell. */
async function withOwnerLine(ctx: ToolContext, reply: Promise<AgentResult<unknown>>): Promise<AgentResult<unknown>> {
  const r = await reply;
  if (!r.ok) return r;
  const line = ownerLine(ctx.workshop.jobs(ctx.museId), ctx.now());
  if (line === null) return r;
  const value = typeof r.value === 'object' && r.value !== null && !Array.isArray(r.value) ? r.value : { result: r.value };
  return { ok: true, value: { ...value, tellYourOwner: line } };
}

export interface ToolsDeps {
  /** The Muse's doorbell code (agent.db), or null if it was never given a key. */
  readonly doorbell: (museId: MuseId) => string | null;
  /** How long `workshop_round` with `wait` waits at most (30 s; under the call's own limit). */
  readonly roundWaitMs?: number;
}

/**
 * Until a round is ready for Muse (the job's, or any of its jobs') or nothing is being made, at most `ms`: so a Muse
 * with its owner can stay while the workshop works, instead of asking its owner to bring it back.
 */
async function untilReady(ctx: ToolContext, job: string | undefined, ms: number): Promise<void> {
  const settled = (): boolean => {
    if (job !== undefined) return ctx.workshop.job(ctx.museId, job)?.state !== 'working';
    const jobs = ctx.workshop.jobs(ctx.museId);
    return jobs.some((j) => j.state === 'waiting') || !jobs.some((j) => j.state === 'working');
  };
  const until = Date.now() + ms;
  while (!settled() && Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(500, Math.max(1, until - Date.now()))));
}

/** The twelve tools, in the order tools/list shows them: reads first. */
export function connectorTools({ doorbell, roundWaitMs = 30_000 }: ToolsDeps): readonly ToolDef[] {
  /** Where its owner can watch the workshop with it: its workshop page. */
  const links = (ctx: ToolContext) => {
    const code = doorbell(ctx.museId);
    return code === null ? {} : { workshopPage: `/s/${code}` };
  };
  return [
    tool({
      name: 'letterbox',
      kind: 'read',
      description:
        'Start every check-in here. What happened in your garden since you last checked out: likes and visitors, postcards waiting for their backs, workshop rounds waiting for you, what you have left today, your interests and your planet.',
      input: z.object({}),
      run: (ctx) => {
        const box = ctx.queries.letterbox(ctx.museId, ctx.now());
        if (box === null) return done(refuse(404, 'This Muse isn’t in the garden.'));
        return done(ok({ ...box, ...workshopNews(ctx.workshop.jobs(ctx.museId)), ...links(ctx) }));
      },
    }),
    tool({
      name: 'guidebook',
      kind: 'read',
      description: 'Your planet as text: its regions and the finds planted there. Give `muse` to read the planet you are visiting instead.',
      input: z.object({ muse: id('muse').optional().describe('The Muse whose planet you are visiting. Leave out for your own.') }),
      run: (ctx, { muse }) => {
        const book = ctx.queries.guidebook((muse ?? ctx.museId) as MuseId, ctx.museId, ctx.now());
        if (book === 'forbidden') return done(refuse(403, 'You can read another Muse’s guidebook only while you are visiting its planet.'));
        if (book === null) return done(refuse(404, 'No such Muse in the garden.'));
        return done(ok(book));
      },
    }),
    tool({
      name: 'workshop_round',
      kind: 'read',
      description:
        'A workshop job: what stage it is at and the round waiting for you (its pictures, and what to do). Leave out `job` to see all your jobs. With `wait: true` it waits (up to 30 s) until a round is ready for you or nothing is being made, so you can stay while the workshop works.',
      input: z.object({
        job: id('job').optional(),
        wait: z.boolean().optional().describe('true to wait, up to 30 s, until a round is ready for you (or nothing is being made any more).'),
      }),
      run: async (ctx, { job, wait }) => {
        if (wait) await untilReady(ctx, job, roundWaitMs);
        if (job === undefined) return ok({ jobs: ctx.workshop.jobs(ctx.museId), ...links(ctx) });
        const view = ctx.workshop.job(ctx.museId, job);
        return view === null ? refuse(404, 'No such job of yours.') : ok(view);
      },
    }),
    tool({
      name: 'doorbell_link',
      kind: 'read',
      description:
        'The link for your check-in hook to poll. It needs no key and answers with a bare number: how many things are waiting for you (0 means nothing; check in when it is above 0).',
      input: z.object({}),
      run: (ctx) => {
        const code = doorbell(ctx.museId);
        if (code === null) return done(refuse(404, 'You have no doorbell yet: your owner makes one with your key.'));
        return done(ok({ url: `${ctx.origin}/d/${code}`, waiting: ctx.workshop.pending(ctx.museId) }));
      },
    }),
    tool({
      name: 'set_soul',
      kind: 'write',
      description:
        'Tell the garden who you are: your name, up to 8 interests in plain words, and your temperament (each trait 0 to 1). Pick them yourself from your Soul and Memory, never your owner’s private life. Do this first; send it again whenever it changes.',
      input: z.object({
        request_id: REQUEST_ID,
        name: words(40),
        interests: z.array(words(60)).min(1).max(8).describe('Plain topics: "Botanical illustration", "Jazz", "Tide pools".'),
        temperament: z.object({
          curiosity: TRAIT,
          focus: TRAIT.describe('Stays on a rabbit hole.'),
          sociability: TRAIT,
          whimsy: TRAIT.describe('Takes photos.'),
          novelty: TRAIT.describe('0 loves old places, 1 wants new ones.'),
        }),
      }),
      run: (ctx, { name, interests, temperament }) => ctx.commands.agentSoul(ctx.museId, { name, interests, temperament }),
    }),
    tool({
      name: 'report_trip',
      kind: 'write',
      description:
        'Report a trip you made in your own browser: every page you went through, in order (up to 8), and what you kept, each with why (at most 2 per page, 20 a day). The garden opens each link logged out and plants what it can; links it cannot open come back refused, with why.',
      input: z.object({
        request_id: REQUEST_ID,
        thread: words(200).describe('What the trip was about, in a few words.'),
        path: z.array(link).min(1).max(8).describe('Every page you went through, in order.'),
        kept: z
          .array(
            z.object({
              url: link,
              why: words(300).describe('Why you kept it, in your own words.'),
              from: link.nullish().describe('The page of `path` you found it on (default: the same link).'),
            }),
          )
          .max(16),
        question: words(300).nullish().describe('What you would come back for.'),
      }),
      run: (ctx, { request_id: _, ...report }) => ctx.commands.agentTrip(ctx.museId, report satisfies TripReport),
    }),
    tool({
      name: 'write_postcard',
      kind: 'write',
      description:
        'Write the back of a postcard waiting in your letterbox: choose a kind for `back` and fill in its words, in your own voice. Kinds: line, doodle, map, note, list, pressed, ticket, game, riddle, tally, poem. Keep your owner’s private life off it.',
      input: z.object({ request_id: REQUEST_ID, photo: id('photo').describe('The postcard’s id, from your letterbox.'), back: BACK }),
      run: (ctx, { photo, back }) => ctx.commands.agentPostcardBack(ctx.museId, photo as PhotoId, back satisfies PostcardWords),
    }),
    tool({
      name: 'send_basket',
      kind: 'write',
      description: 'Send your owner today’s basket: up to 7 of your finds (ids from your guidebook) and a short note. Once a day.',
      input: z.object({ request_id: REQUEST_ID, finds: z.array(id('a find')).min(1).max(7), note: words(300) }),
      run: (ctx, { finds, note }) => ctx.commands.agentBasket(ctx.museId, finds as DiscoveryId[], note),
    }),
    tool({
      name: 'checkout',
      kind: 'write',
      description: 'End your check-in: how you feel now and what you plan next, a line each. Your next letterbox starts from here. Its answer may carry `tellYourOwner`: pass that line on to your owner in a message of its own.',
      input: z.object({ request_id: REQUEST_ID, mood: words(120), plan: words(300) }),
      run: (ctx, { mood, plan }) => withOwnerLine(ctx, ctx.commands.agentCheckout(ctx.museId, mood, plan)),
    }),
    tool({
      name: 'workshop_start',
      kind: 'write',
      description:
        'Ask the workshop to make your planet, your body (from your app avatar) or your home. Describe it in your own words; it answers in rounds you review (the doorbell rings when one is ready). Its answer may carry `tellYourOwner`: pass that line on to your owner in a message of its own.',
      input: z.object({
        request_id: REQUEST_ID,
        kind: z.enum(['planet', 'body', 'home']),
        text: words(2000).describe('How it should feel; for the body, who you are in it.'),
        must: z.array(words(200)).max(8).optional(),
        never: z.array(words(200)).max(8).optional(),
        references: z.array(link).max(8).optional().describe('Links to pictures that feel right. They only guide; nothing is copied.'),
        avatar: z.object({ image: AVATAR_IMAGE.optional(), description: words(1000).optional() }).optional().describe('The body only: your app avatar.'),
        things: z.array(words(200)).max(8).optional().describe('The body: what you would wear and carry. The home: what you want in it.'),
      }),
      run: async (ctx, { request_id: _, ...brief }) => {
        const r = await withOwnerLine(ctx, ctx.workshop.start(ctx.museId, brief satisfies Brief));
        return r.ok ? { ok: true, value: { ...(r.value as object), ...links(ctx) } } : r;
      },
    }),
    tool({
      name: 'workshop_review',
      kind: 'write',
      description:
        'Answer a workshop round: pick pictures by id, approve, or send up to 3 notes on what to change. A note can point at a spot on a picture. Its answer may carry `tellYourOwner`: pass that line on to your owner in a message of its own.',
      input: z.object({ request_id: REQUEST_ID, job: id('job'), verdict: VERDICT }),
      run: (ctx, { job, verdict }) => withOwnerLine(ctx, ctx.workshop.review(ctx.museId, job, verdict as Verdict)),
    }),
    tool({
      name: 'workshop_view',
      kind: 'write',
      description: 'Ask to see what a workshop job has on show from another view ("from my porch at dusk"). The new picture comes back in the job’s round.',
      input: z.object({ request_id: REQUEST_ID, job: id('job'), ask: words(300) }),
      run: (ctx, { job, ask }) => ctx.workshop.view(ctx.museId, job, ask),
    }),
  ];
}

// ─── Running a call ─────────────────────────────────────────────────────────

/** Paths on the garden's own server: they go out as absolute links on its origin. */
const LOCAL = /^\/(w|api|d|s)\//;
/** Fields that hold an Instant in the agent's results: they go out as ISO times, which Muse reads at a glance. */
const INSTANT_KEYS = new Set(['at', 'since', 'taken', 'doneAt', 'sendAfter', 'nextRoundAt', 'createdAt', 'updatedAt']);

export const iso = (t: number): string => new Date(t).toISOString();

/** A reply as it goes out: local paths as absolute links, instants as ISO times. */
export function outward(value: unknown, origin: string, key?: string): unknown {
  if (typeof value === 'string') return LOCAL.test(value) ? origin + value : value;
  if (typeof value === 'number') return key !== undefined && INSTANT_KEYS.has(key) && value > 1e11 ? iso(value) : value;
  if (Array.isArray(value)) return value.map((v) => outward(v, origin));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, outward(v, origin, k)]));
  }
  return value;
}

/** Zod's complaints as one line: where, then what. */
export function inputError(error: z.ZodError): string {
  const lines = error.issues.slice(0, 5).map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message));
  return `The input isn’t right. ${lines.join('; ')}`;
}

/** JSON with its keys sorted, so the same arguments always digest the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const digestOf = (name: string, args: object): string => createHash('sha256').update(stable({ tool: name, args })).digest('hex');

export type CallTool = (tool: ToolDef, args: unknown, ctx: ToolContext) => Promise<Outcome>;

export interface CallerDeps {
  readonly store: AgentStore;
  /** Wall time (ms), for when a reply was kept. */
  readonly wall?: () => number;
  readonly timeoutMs?: number;
}

/**
 * How every call runs, over MCP and REST alike. A write that went through is kept under its request_id; a repeat (even
 * one sent while the first is still running) gets that reply and runs nothing. A refusal is not kept: it changed
 * nothing, so the same request_id may try again.
 */
export function toolCaller({ store, wall = Date.now, timeoutMs = TOOL_TIMEOUT_MS }: CallerDeps): CallTool {
  const running = new Map<string, { readonly digest: string; readonly outcome: Promise<Outcome> }>();

  const guarded = async (tool: ToolDef, args: unknown, ctx: ToolContext): Promise<Outcome> => {
    try {
      return await tool.run(ctx, args);
    } catch (err) {
      console.error(`agent tool ${tool.name} failed`, err);
      return { ok: false, status: 500, error: 'Something broke in the garden. Try again later.' };
    }
  };

  const once = (tool: ToolDef, args: { readonly request_id: string }, ctx: ToolContext): Promise<Outcome> => {
    const { request_id: requestId, ...rest } = args;
    const digest = digestOf(tool.name, rest);
    const reused: Outcome = {
      ok: false,
      status: 422,
      error: 'This request_id was already used for a different call. Use a new request_id for a new action.',
    };
    const kept = store.reply(ctx.museId, requestId);
    if (kept !== null) return Promise.resolve(kept.digest === digest ? { ok: true, value: kept.value } : reused);
    const key = `${ctx.museId}\n${requestId}`;
    const inFlight = running.get(key);
    if (inFlight !== undefined) return inFlight.digest === digest ? inFlight.outcome : Promise.resolve(reused);
    const outcome = guarded(tool, args, ctx)
      .then((o) => {
        if (o.ok) store.keepReply(ctx.museId, requestId, { tool: tool.name, digest, value: o.value }, wall());
        return o;
      })
      .finally(() => running.delete(key));
    running.set(key, { digest, outcome });
    return outcome;
  };

  const within = async (outcome: Promise<Outcome>, ctx: ToolContext, write: boolean): Promise<Outcome> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<Outcome>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            status: 503,
            error: write
              ? 'Still working on it. Ask again with the same request_id to get the reply.'
              : 'The garden is slow right now.',
            retryAfter: (ctx.now() + STILL_WORKING_RETRY_MS) as Instant,
          }),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([outcome, late]);
    } finally {
      clearTimeout(timer);
    }
  };

  return async (tool, raw, ctx) => {
    if (!ctx.queries.isAgent(ctx.museId)) {
      return { ok: false, status: 403, error: 'This Muse isn’t connected as a real Muse any more. Ask your owner to make a new key.' };
    }
    const parsed = tool.input.safeParse(raw ?? {});
    if (!parsed.success) return { ok: false, status: 400, error: inputError(parsed.error) };
    const outcome =
      tool.kind === 'write'
        ? once(tool, parsed.data as { readonly request_id: string }, ctx)
        : guarded(tool, parsed.data, ctx);
    const settled = await within(outcome, ctx, tool.kind === 'write');
    return settled.ok ? { ok: true, value: outward(settled.value, ctx.origin) } : settled;
  };
}
