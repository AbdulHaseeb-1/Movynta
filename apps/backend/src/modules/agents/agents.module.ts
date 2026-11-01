import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { SkillsModule } from "../skills/skills.module.js";
import { SkillsRegistry } from "../skills/skills.registry.js";
import { ToolRegistry } from "../tools/tool.registry.js";
import { ToolsModule } from "../tools/tools.module.js";
import { AgentRegistry } from "./agent.registry.js";
import { AGENT_DEFINITIONS, AGENT_RUNNER } from "./agent.tokens.js";
import { agentRuntimeProviders } from "./agent-runtime.providers.js";
import { AgentsController } from "./agents.controller.js";
import type { AgentDefinition } from "./definitions/definitions.types.js";
import { createModelingCoordinatorDefinition } from "./definitions/modeling-coordinator.agent.js";

/**
 * Startup check: every tool a skill references must exist, otherwise the
 * server refuses to start rather than letting an agent fail mid-run.
 */
@Injectable()
export class SkillToolReferenceValidator implements OnModuleInit {
  constructor(
    private readonly skills: SkillsRegistry,
    private readonly tools: ToolRegistry,
  ) {}

  onModuleInit(): void {
    for (const skill of this.skills.all()) {
      for (const toolName of skill.toolNames) {
        if (!this.tools.has(toolName)) {
          throw new Error(`Skill "${skill.id}" references unknown tool "${toolName}"`);
        }
      }
    }
  }
}

@Module({
  imports: [ToolsModule, SkillsModule],
  controllers: [AgentsController],
  providers: [
    ...agentRuntimeProviders,
    {
      provide: AGENT_DEFINITIONS,
      inject: [ToolRegistry, SkillsRegistry, APP_CONFIG],
      useFactory: (tools: ToolRegistry, skills: SkillsRegistry, config: AppConfig): AgentDefinition[] => [
        createModelingCoordinatorDefinition({ model: config.agents.model, tools, skills }),
      ],
    },
    AgentRegistry,
    SkillToolReferenceValidator,
  ],
  exports: [AgentRegistry, AGENT_RUNNER],
})
export class AgentsModule {}
