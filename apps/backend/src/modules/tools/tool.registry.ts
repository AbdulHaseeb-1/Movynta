import { Inject, Injectable } from "@nestjs/common";
import { TOOL_DEFINITIONS } from "./tool.tokens.js";
import { TOOL_NAME_PATTERN, type ToolDefinition } from "./tool.types.js";

/** Holds every registered tool, keyed by its namespaced name. */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(@Inject(TOOL_DEFINITIONS) definitions: readonly ToolDefinition[]) {
    for (const definition of definitions) {
      if (!TOOL_NAME_PATTERN.test(definition.name)) throw new Error(`Invalid tool name "${definition.name}"`);
      if (this.tools.has(definition.name)) throw new Error(`Duplicate tool "${definition.name}"`);
      this.tools.set(definition.name, definition);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
