import type { Agent, AgentOutputType } from "@openai/agents";
import type { AgentRunContext } from "../../agent-runs/agent-run.context.js";

/** The SDK agent type used throughout the backend. */
export type AppAgent = Agent<AgentRunContext, AgentOutputType>;

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
}

/**
 * Describes one agent. Definitions hold only instructions, tool wiring, and
 * guardrails; they do not perform I/O.
 */
export interface AgentDefinition extends AgentSummary {
  createAgent(): AppAgent;
}
