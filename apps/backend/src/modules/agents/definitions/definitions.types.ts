import type { Agent, AgentOutputType } from "@openai/agents";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { SkillsRegistry } from "../../skills/skills.registry.js";
import type { SkillSummary } from "../../skills/skills.types.js";
import type { ToolRegistry } from "../../tools/tool.registry.js";

/** The SDK agent type used throughout the backend. */
export type AppAgent = Agent<AgentRunContext, AgentOutputType>;

/** An agent as listed to the client: its id, name and version. */
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
  /** Internal agents are started by the run loop. They are not listed and cannot be chosen for a run. */
  readonly internal?: boolean;
  createAgent(): AppAgent;
}

/** The services the modeling coordinator agent is built from. */
export interface ModelingCoordinatorDependencies {
  readonly model: string | undefined;
  readonly tools: ToolRegistry;
  readonly skills: SkillsRegistry;
}

/** The facts an agent's instructions are written from for one run. */
export interface InstructionInputs {
  readonly skills: readonly SkillSummary[];
  readonly toolNameMap: readonly { readonly name: string; readonly providerName: string }[];
}
