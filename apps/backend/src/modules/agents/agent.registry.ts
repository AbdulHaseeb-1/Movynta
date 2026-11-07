import { Inject, Injectable } from "@nestjs/common";
import { NotFoundError } from "../../common/errors/app-error.js";
import { AGENT_DEFINITIONS } from "./agent.tokens.js";
import type { AgentDefinition, AgentSummary, AppAgent } from "./definitions/definitions.types.js";

/**
 * Registers agent definitions and creates each SDK agent on first use, so a
 * server with agents disabled does not need a model. Add agents here, not in services.
 */
@Injectable()
export class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();
  private readonly instances = new Map<string, AppAgent>();

  constructor(@Inject(AGENT_DEFINITIONS) definitions: readonly AgentDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent id "${definition.id}"`);
      this.definitions.set(definition.id, definition);
    }
  }

  list(): AgentSummary[] {
    return [...this.definitions.values()].filter((definition) => definition.internal !== true).map(({ id, name, description, version }) => ({
      id,
      name,
      description,
      version,
    }));
  }

  /** The public description of an agent. Internal agents do not exist as far as clients can tell. */
  summary(agentId: string): AgentSummary {
    const definition = this.definitions.get(agentId);
    if (!definition || definition.internal === true) throw new NotFoundError("Agent not found");
    return { id: definition.id, name: definition.name, description: definition.description, version: definition.version };
  }

  /** Returns the shared SDK agent for an id. Throws NotFound for unknown ids. */
  agent(agentId: string): AppAgent {
    const existing = this.instances.get(agentId);
    if (existing) return existing;
    const definition = this.definitions.get(agentId);
    if (!definition) throw new NotFoundError("Agent not found");
    const agent = definition.createAgent();
    this.instances.set(agentId, agent);
    return agent;
  }
}
