// The connector's seam: one registry of tools, served as MCP (/mcp) and REST (/api/v1) by server/agent.
// Every tool runs as the Muse its key belongs to; reads never change anything, writes carry a request_id.
import type { z } from 'zod';
import type { AgentCommands, AgentQueries, AgentResult, Instant, MuseId } from '../../src/muse/contract';
import type { Workshop } from '../workshop/types';

export interface ToolContext {
  /** The Muse the bearer key belongs to. A tool never acts as any other. */
  readonly museId: MuseId;
  /** The sim clock (the engine's). */
  readonly now: () => Instant;
  readonly commands: AgentCommands;
  readonly queries: AgentQueries;
  readonly workshop: Workshop;
  /** The garden's public origin (https://<tunnel host>): pictures go out as absolute links on it. */
  readonly origin: string;
}

export type ToolKind = 'read' | 'write';

export interface ToolDef<I extends z.ZodType = z.ZodType> {
  /** Lowercase with underscores, e.g. "report_trip". */
  readonly name: string;
  readonly kind: ToolKind;
  /** What Muse reads in tools/list: what it does, when to use it, what comes back. Plain words, no jargon. */
  readonly description: string;
  readonly input: I;
  run(ctx: ToolContext, args: z.infer<I>): Promise<AgentResult<unknown>>;
}
