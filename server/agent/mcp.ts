// The connector as MCP at /mcp: stateless Streamable HTTP with JSON replies, a fresh server for every request, tools
// only. The SDK negotiates the protocol (2025-11-25, and 2025-06-18 or 2025-03-26 for an older client). Muse's client
// hands Muse text, so every result is text: the reply as pretty JSON, or "<status>: <reason>" when refused.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { iso } from './tools';
import type { Failure, Outcome } from './tools';
import type { ToolDef } from './types';

export const SERVER_INFO = { name: 'muses-garden', version: '1.0.0' } as const;

/** A refusal as Muse reads it: "409: <reason> Try again after <ISO time>." */
export function failureText(f: Failure): string {
  return f.retryAfter === undefined ? `${f.status}: ${f.error}` : `${f.status}: ${f.error} Try again after ${iso(f.retryAfter)}.`;
}

export function callResult(outcome: Outcome): CallToolResult {
  if (outcome.ok) return { content: [{ type: 'text', text: JSON.stringify(outcome.value, null, 2) }] };
  return { content: [{ type: 'text', text: failureText(outcome) }], isError: true };
}

/** A refusal before MCP starts (no key, too many requests), as a JSON-RPC error: what the SDK's own HTTP errors look like. */
export function rpcError(f: Failure): string {
  return JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: failureText(f) }, id: null });
}

export interface McpDeps {
  readonly tools: readonly ToolDef[];
  /** Runs one tool as the key's Muse (toolCaller with its context). */
  readonly call: (tool: ToolDef, args: unknown) => Promise<Outcome>;
  readonly origin: string;
}

function mcpServer({ tools, call, origin }: McpDeps): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: `Muse's Garden: a planet of your own that grows from what you find. Read ${origin}/garden.md for how it works. Start each check-in with letterbox; end it with checkout.`,
  });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.kind === 'read', destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args: unknown) => callResult(await call(tool, args)),
    );
  }
  return server;
}

const ACCEPT = 'application/json, text/event-stream';

/**
 * The SDK refuses (406) a client that doesn't list both JSON and event streams in Accept. Every reply here is JSON
 * either way, so a client that asks for JSON only, or sends no Accept, is answered too. (The SDK reads rawHeaders.)
 */
function widenAccept(req: IncomingMessage): void {
  const accept = req.headers.accept ?? '';
  if (accept.includes('application/json') && accept.includes('text/event-stream')) return;
  const raw = req.rawHeaders;
  const at = raw.findIndex((h, i) => i % 2 === 0 && h.toLowerCase() === 'accept');
  if (at === -1) raw.push('Accept', ACCEPT);
  else raw[at + 1] = ACCEPT;
  req.headers.accept = ACCEPT;
}

/** Answers one POST to /mcp (the caller has checked the key and the rate limit). */
export async function serveMcp(req: IncomingMessage, res: ServerResponse, deps: McpDeps): Promise<void> {
  widenAccept(req);
  const server = mcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
