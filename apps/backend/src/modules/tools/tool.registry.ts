import { Inject, Injectable } from "@nestjs/common";
import { ALL_TOOL_NAMES, TOOLSETS, type ToolsetDefinition } from "./catalog/index.js";
import { TOOL_DEFINITIONS } from "./tool.tokens.js";
import { describeTool, TOOL_NAME_PATTERN, type ToolDefinition, type ToolDescriptor } from "./tool.types.js";

/**
 * Holds every registered tool, keyed by its namespaced name.
 *
 * Startup fails if the registered tools and the catalog in `catalog/tool-names.ts`
 * disagree, or if a toolset names a missing tool. A tool can therefore never be
 * silently missing from an agent.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(@Inject(TOOL_DEFINITIONS) definitions: readonly ToolDefinition[]) {
    for (const definition of definitions) {
      if (!TOOL_NAME_PATTERN.test(definition.name)) throw new Error(`Invalid tool name "${definition.name}"`);
      if (this.tools.has(definition.name)) throw new Error(`Duplicate tool "${definition.name}"`);
      this.tools.set(definition.name, definition);
    }
    this.assertMatchesCatalog();
    for (const toolset of TOOLSETS) this.resolveToolset(toolset);
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

  /** Returns the tools of a toolset in the toolset's order. Throws if any is not registered. */
  resolveToolset(toolset: ToolsetDefinition): ToolDefinition[] {
    return toolset.toolNames.map((name) => {
      const definition = this.tools.get(name);
      if (!definition) throw new Error(`Toolset "${toolset.id}" references unregistered tool "${name}"`);
      return definition;
    });
  }

  describe(): ToolDescriptor[] {
    return this.list().map(describeTool);
  }

  private assertMatchesCatalog(): void {
    const unlisted = this.list().filter((definition) => !ALL_TOOL_NAMES.some((name) => name === definition.name));
    if (unlisted.length > 0) {
      throw new Error(`Tools missing from the catalog: ${unlisted.map((definition) => definition.name).join(", ")}`);
    }
    const unregistered = ALL_TOOL_NAMES.filter((name) => !this.tools.has(name));
    if (unregistered.length > 0) {
      throw new Error(`Catalog tools without a registration: ${unregistered.join(", ")}`);
    }
  }
}
