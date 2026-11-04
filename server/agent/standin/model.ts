// The stand-in's mind: one chat-completions turn with function tools. metaModel calls Meta's Model API
// (https://dev.meta.ai/docs/tool-calling); tests pass a scripted ChatModel instead, with no network.

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string } };

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly ContentPart[] }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

export interface FunctionTool {
  readonly type: 'function';
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>> };
}

export interface ModelTurn {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
}

export type ChatModel = (req: { readonly messages: readonly ChatMessage[]; readonly tools: readonly FunctionTool[] }) => Promise<ModelTurn>;

export interface MetaModelOptions {
  readonly apiKey: string;
  /** Defaults to https://api.meta.ai/v1. */
  readonly baseUrl?: string;
  /** Defaults to muse-spark-1.3-contributor: cheap, and it only ever sees test fixtures. */
  readonly model?: string;
  readonly effort?: 'minimal' | 'low' | 'medium' | 'high';
  readonly fetch?: typeof fetch;
  /** Per call. Defaults to 120 s. */
  readonly timeoutMs?: number;
}

export const DEFAULT_STANDIN_MODEL = 'muse-spark-1.3-contributor';

/** A ChatModel on Meta's chat completions. Retries once on a network error, a 429 or a 5xx; throws otherwise. */
export function metaModel(opts: MetaModelOptions): ChatModel {
  const url = `${(opts.baseUrl ?? 'https://api.meta.ai/v1').replace(/\/+$/, '')}/chat/completions`;
  const send = opts.fetch ?? fetch.bind(globalThis);
  const model = opts.model ?? DEFAULT_STANDIN_MODEL;
  return async ({ messages, tools }) => {
    const body = JSON.stringify({ model, messages, tools, tool_choice: 'auto', reasoning_effort: opts.effort ?? 'medium' });
    let last = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await send(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
      } catch (e) {
        last = `network: ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      const text = await res.text();
      if (res.ok) return parseTurn(text);
      last = `${res.status} ${text.slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) break;
    }
    throw new Error(`model call failed: ${last}`);
  };
}

export function parseTurn(text: string): ModelTurn {
  const json = JSON.parse(text) as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] };
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error(`model reply had no message: ${text.slice(0, 300)}`);
  const calls = Array.isArray(message.tool_calls) ? (message.tool_calls as ToolCall[]) : [];
  return {
    content: typeof message.content === 'string' && message.content !== '' ? message.content : null,
    toolCalls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } })),
  };
}
