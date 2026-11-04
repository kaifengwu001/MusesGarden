// The stand-in's connector: the garden's MCP tools at <server>/mcp, through the SDK client, as the Muse the key
// belongs to. Each MCP tool becomes a function tool for the model, under its own name.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FunctionTool } from './model';

/** The connector's writes (server/agent/types.ts ToolKind). Anything else is a read. */
export const GARDEN_WRITES: ReadonlySet<string> = new Set([
  'set_soul',
  'report_trip',
  'write_postcard',
  'send_basket',
  'checkout',
  'workshop_start',
  'workshop_review',
  'workshop_view',
]);

export const GARDEN_TOOLS: readonly string[] = ['letterbox', 'guidebook', 'workshop_round', 'doorbell_link', ...GARDEN_WRITES];

export interface GardenReply {
  readonly text: string;
  readonly isError: boolean;
  /** The status a refusal starts with ("409: ..."), if any. */
  readonly status: number | null;
}

export interface Garden {
  readonly tools: readonly FunctionTool[];
  call(name: string, args: Readonly<Record<string, unknown>>): Promise<GardenReply>;
  close(): Promise<void>;
}

export async function connectGarden(opts: { readonly server: string; readonly key: string; readonly fetch?: typeof fetch }): Promise<Garden> {
  const url = new URL(`${opts.server.replace(/\/+$/, '')}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${opts.key}` } },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const client = new Client({ name: 'muse-standin', version: '0.6.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  const tools: FunctionTool[] = listed.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? t.name, parameters: cleanSchema(t.inputSchema) },
  }));
  return {
    tools,
    async call(name, args) {
      try {
        const result = await client.callTool({ name, arguments: { ...args } }, undefined, { timeout: 45_000 });
        const blocks = Array.isArray(result.content) ? (result.content as { type: string; text?: string }[]) : [];
        const text = blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('\n');
        const isError = result.isError === true;
        return { text, isError, status: isError ? statusOf(text) : null };
      } catch (e) {
        // 401 and 429 come before MCP starts, as HTTP errors: the SDK throws with the HTTP status as its code.
        const text = rpcMessage(e instanceof Error ? e.message : String(e));
        const code = e instanceof StreamableHTTPError ? e.code : undefined;
        return { text, isError: true, status: code !== undefined && code >= 400 && code < 600 ? code : statusOf(text) };
      }
    },
    close: () => client.close(),
  };
}

/** "409: Over today's finds. Try again after ..." → 409; the SDK's "MCP error -32602: Input validation error" → 400. */
export function statusOf(text: string): number | null {
  const m = /^\s*(?:Error:\s*)?(\d{3}):/.exec(text);
  if (m) return Number(m[1]);
  return /MCP error -32602\b/.test(text) ? 400 : null;
}

/** "Streamable HTTP error: Error POSTing to endpoint: {json-rpc error}" → the error's own message, when it has one. */
function rpcMessage(text: string): string {
  const at = text.indexOf('{');
  if (at < 0) return text;
  try {
    const body = JSON.parse(text.slice(at)) as { error?: { message?: unknown } };
    return typeof body.error?.message === 'string' ? body.error.message : text;
  } catch {
    return text;
  }
}

/** Function parameters accept plain JSON Schema; drop the keys that only describe the schema itself. */
function cleanSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (k !== '$schema') out[k] = v;
  if (out.type === undefined) out.type = 'object';
  return out;
}
