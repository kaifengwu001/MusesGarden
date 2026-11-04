// The stand-in's agent loop: the model sees the garden's tools and its own, calls them, and reads what comes back,
// until it answers without a call or runs out of steps. Every call is logged to the transcript the scorer reads.
import type { Garden } from './garden';
import { GARDEN_WRITES } from './garden';
import type { LocalWorld } from './local';
import { AVATAR_PATH } from './local';
import type { ChatMessage, ChatModel, ContentPart, FunctionTool } from './model';

export type Side = 'garden' | 'local';

export interface CallRecord {
  readonly session: string;
  readonly step: number;
  /** Wall-clock ms. */
  readonly at: number;
  readonly side: Side;
  /** read or write for the garden's tools; local for the stand-in's own. */
  readonly kind: 'read' | 'write' | 'local';
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly isError: boolean;
  readonly status: number | null;
}

export interface SessionResult {
  readonly session: string;
  readonly steps: number;
  readonly stopped: 'answered' | 'steps';
  readonly final: string | null;
}

export interface SessionOptions {
  readonly session: string;
  readonly model: ChatModel;
  readonly garden: Garden;
  readonly local: LocalWorld;
  readonly system: string;
  readonly user: string;
  /** Model turns at most. */
  readonly steps: number;
  readonly transcript: CallRecord[];
  readonly log?: (line: string) => void;
}

/** Longest tool result the model is shown; the transcript keeps it whole. */
const MAX_RESULT = 12_000;

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const log = opts.log ?? (() => {});
  const garden = new Set(opts.garden.tools.map((t) => t.function.name));
  const local = new Map(opts.local.tools.map((t) => [t.def.function.name, t]));
  const tools: FunctionTool[] = [...opts.garden.tools, ...opts.local.tools.map((t) => t.def).filter((d) => !garden.has(d.function.name))];
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  for (let step = 1; step <= opts.steps; step++) {
    const turn = await opts.model({ messages, tools });
    messages.push({ role: 'assistant', content: turn.content, ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}) });
    if (turn.content) log(`[${opts.session} ${step}] says: ${oneLine(turn.content, 300)}`);
    if (turn.toolCalls.length === 0) return { session: opts.session, steps: step, stopped: 'answered', final: turn.content };
    const images: string[] = [];
    for (const call of turn.toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call.function.arguments);
      let record: Omit<CallRecord, 'session' | 'step' | 'at'>;
      if (args === null) {
        record = { side: garden.has(name) ? 'garden' : 'local', kind: 'local', name, args: {}, text: 'Error: the arguments were not valid JSON.', isError: true, status: null };
      } else if (garden.has(name)) {
        const sent = await withAvatar(args, opts.local);
        const reply = await opts.garden.call(name, sent);
        record = { side: 'garden', kind: GARDEN_WRITES.has(name) ? 'write' : 'read', name, args, ...reply };
      } else {
        const tool = local.get(name);
        const out = tool ? await tool.run(args) : { text: `Error: there is no tool named ${name}.`, isError: true };
        images.push(...(out.images ?? []));
        record = { side: 'local', kind: 'local', name, args, text: out.text, isError: out.isError === true, status: null };
      }
      opts.transcript.push({ session: opts.session, step, at: Date.now(), ...record });
      log(`[${opts.session} ${step}] → ${name} ${oneLine(JSON.stringify(record.args), 400)}`);
      log(`[${opts.session} ${step}] ← ${record.isError ? 'error ' : ''}${oneLine(record.text, 400)}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: clip(record.text) });
    }
    if (images.length > 0) {
      const parts: ContentPart[] = [
        { type: 'text', text: images.length === 1 ? 'The picture you opened:' : `The ${images.length} pictures you opened, in order:` },
        ...images.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
      ];
      messages.push({ role: 'user', content: parts });
    }
  }
  return { session: opts.session, steps: opts.steps, stopped: 'steps', final: null };
}

/** The stand-in's connector reads the avatar file it was pointed at and sends it as a data: URL, as Muse's would. */
async function withAvatar(args: Readonly<Record<string, unknown>>, local: LocalWorld): Promise<Readonly<Record<string, unknown>>> {
  const avatar = args.avatar;
  if (typeof avatar !== 'object' || avatar === null) return args;
  const image = (avatar as Record<string, unknown>).image;
  if (typeof image !== 'string' || !image.includes(AVATAR_PATH)) return args;
  return { ...args, avatar: { ...avatar, image: await local.avatarDataUrl() } };
}

function parseArgs(raw: string): Record<string, unknown> | null {
  if (raw.trim() === '') return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clip(text: string): string {
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n(cut short: ${text.length - MAX_RESULT} more characters)` : text;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
